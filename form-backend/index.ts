import { app, Datastore, filestore } from 'codehooks-js';
import { signToken, verifyRequest, passwordMatches } from '#lib/auth';
import { defaultForm, getFormByUuid, resolveForm } from '#lib/forms';
import { checkLoginAttempt, clearLoginAttempts } from '#lib/throttle';
import type { FormDoc } from '#lib/forms';
import { parseBody } from '#lib/body';
import { validateFields } from '#lib/validation';
import { saveUploads } from '#lib/files';
import { originOf, corsHeaders, safeRedirect } from '#lib/security';
import { toCsv, collectColumns } from '#lib/csv';
import { thanksPage, errorPage } from '#lib/pages';
import { filterAndPaginate, clampInt } from '#lib/search';
import { randomUUID } from 'crypto';

// Boot-time guard — a missing JWT_SECRET would make admin sessions forgeable.
(function checkConfig() {
  const missing: string[] = [];
  if (!process.env.JWT_SECRET) missing.push('JWT_SECRET (admin sessions would be forgeable)');
  if (!process.env.ADMIN_PASSWORD) missing.push('ADMIN_PASSWORD (admin login unprotected)');
  if (missing.length) {
    console.error('⚠️  form-backend: missing required env var(s): ' + missing.join(', '));
  }
})();

app.auth('/health', (req, res, next) => next());
app.auth('/admin/login', (req, res, next) => next());
app.auth('/admin/logout', (req, res, next) => next());
app.auth('/f/*', (req, res, next) => next());
app.auth('/thanks/*', (req, res, next) => next());

// Admin API — bypass the platform API key, require our JWT cookie instead.
app.auth('/admin/api/*', (req, res, next) => {
  if (verifyRequest(req)) return next();
  res.status(401).json({ error: 'Not authenticated' });
  res.end();
});

app.get('/health', (req, res) => {
  res.json({ ok: true, service: 'form-backend' });
});

app.post('/admin/login', async (req, res) => {
  // Throttle BEFORE checking the password: this endpoint is unauthenticated and
  // public, so without a limit it is an unlimited password oracle.
  const conn = await Datastore.open();
  const throttle = await checkLoginAttempt(conn, req);
  if (!throttle.allowed) {
    res.set('Retry-After', String(throttle.retryAfterSeconds));
    return res.status(429).json({ ok: false, error: 'Too many login attempts. Try again later.' });
  }

  if (!passwordMatches(req.body?.password)) {
    return res.status(401).json({ ok: false, error: 'Invalid password' });
  }

  // Successful login clears the counter so a legitimate admin is not penalised
  // by earlier typos.
  await clearLoginAttempts(conn, req);
  // SameSite=Strict is a SECURITY CONTROL here, not a preference. The platform
  // injects `Access-Control-Allow-Origin: <echoed origin>` together with
  // `Access-Control-Allow-Credentials: true` on every response and our code
  // cannot override it, so SameSite=Strict is the ONLY thing stopping any web
  // page from reading /admin/api/* with the admin's cookie. Relaxing it to Lax
  // (the usual fix when a login link in an email stops working) would expose
  // every submission and allow PATCH/DELETE. Do not relax it.
  res.set('Set-Cookie', `token=${signToken()}; HttpOnly; Secure; Path=/; SameSite=Strict; Max-Age=604800`);
  res.json({ ok: true });
});

app.post('/admin/logout', (req, res) => {
  res.set('Set-Cookie', 'token=; HttpOnly; Secure; Path=/; SameSite=Strict; Max-Age=0');
  res.json({ ok: true });
});

app.get('/admin/api/forms', async (req, res) => {
  const conn = await Datastore.open();
  const forms = await conn.getMany('forms', {}, { sort: { created: -1 } }).toArray();
  res.json({ ok: true, data: forms });
});

app.post('/admin/api/forms', async (req, res) => {
  const conn = await Datastore.open();
  const form = await conn.insertOne('forms', defaultForm(req.body?.name));
  res.status(201).json({ ok: true, data: form });
});

app.get('/admin/api/forms/:id', async (req, res) => {
  const conn = await Datastore.open();
  const form = await conn.findOneOrNull('forms', req.params.id);
  if (!form) return res.status(404).json({ ok: false, error: 'Form not found' });
  res.json({ ok: true, data: form });
});

app.patch('/admin/api/forms/:id', async (req, res) => {
  const conn = await Datastore.open();
  const existing = await conn.findOneOrNull('forms', req.params.id);
  if (!existing) return res.status(404).json({ ok: false, error: 'Form not found' });

  // uuid, created and stats are server-owned and never client-writable.
  // `honeypot` is deliberately NOT editable yet: the submit endpoint and
  // lib/validation still hardcode `_gotcha`, so changing it here would store and
  // export bot values and, under strict, reject real users with "Unknown field".
  // It becomes editable when the plan that enforces the honeypot lands.
  // `honeypot` and `retentionDays` are deliberately NOT writable: nothing enforces
  // either one yet, and a knob that silently does nothing is worse than no knob —
  // someone could set retentionDays expecting deletion that never happens.
  const allowed: Array<keyof FormDoc> = [
    'name', 'enabled', 'fields', 'strict', 'redirectUrl',
    'allowRedirectOverride', 'allowedDomains',
  ];
  const patch: any = { updated: new Date().toISOString() };
  for (const key of allowed) {
    if (req.body && key in req.body) patch[key] = req.body[key];
  }
  const updated = await conn.updateOne('forms', req.params.id, { $set: patch });
  res.json({ ok: true, data: updated });
});

app.delete('/admin/api/forms/:id', async (req, res) => {
  const conn = await Datastore.open();
  const form: any = await conn.findOneOrNull('forms', req.params.id);
  if (!form) return res.status(404).json({ ok: false, error: 'Form not found' });
  // Delete the uploads before the rows that point at them: dropping the
  // submissions first would leave every stored file unreachable forever.
  const rows = await conn.getMany('submissions', { formId: form.uuid }).toArray();
  for (const row of rows as any[]) {
    for (const f of row.files || []) {
      // Log rather than swallow, exactly as the submission delete does — the
      // rows go either way, so a silent failure leaks an orphan invisibly.
      try {
        await filestore.deleteFile(f.path);
      } catch (err: any) {
        console.error('Failed to delete uploaded file', f.path, err.message);
      }
    }
  }
  await conn.removeMany('submissions', { formId: form.uuid });
  await conn.removeOne('forms', req.params.id);
  res.json({ ok: true, deleted: true });
});

function maxUploadBytes(): number {
  return (Number(process.env.MAX_UPLOAD_MB) || 5) * 1024 * 1024;
}

// codehooks-js exposes get/post/put/patch/delete/all — there is no app.options —
// so the CORS preflight is handled inside one app.all() dispatcher.
app.all('/f/:formId', async (req, res) => {
  try {
    // The raw multipart body must be drained before any other `await` — once this
    // handler yields to the event loop (e.g. for the form lookup below), the
    // platform has already finished consuming the request stream and a later
    // `req.on('data', ...)` never fires, silently producing an empty body. See
    // task-6-report.md for the reproduction. JSON/urlencoded are pre-parsed by the
    // platform onto req.body regardless of ordering, but this fix is written to
    // cover multipart uniformly rather than special-case one content type.
    let parsed;
    let parseErr: any = null;
    if (req.method === 'POST') {
      try {
        parsed = await parseBody(req, maxUploadBytes());
      } catch (err: any) {
        parseErr = err;
      }
    }

    const form = await getFormByUuid(req.params.formId);
    if (!form) return res.status(404).json({ ok: false, error: 'Form not found' });

    res.headers(corsHeaders(form, req));

    if (req.method === 'OPTIONS') return res.status(204).end();
    if (req.method !== 'POST') {
      return res.status(405).json({ ok: false, error: 'Method not allowed' });
    }

    // A browser form post must not land on a white page of JSON. JSON clients
    // keep byte-identical bodies; everything else gets the branded error page.
    const wantsJson = String(req.headers['content-type'] || '').includes('application/json');
    const fail = (
      status: number,
      message: string,
      errors: Array<{ field: string; message: string }> = []
    ) => {
      if (wantsJson) {
        const body: any = { ok: false, error: message };
        if (errors.length) body.errors = errors;
        return res.status(status).json(body);
      }
      res.set('content-type', 'text/html');
      return res.status(status).send(errorPage(message, errors));
    };

    if (!form.enabled) {
      return fail(403, 'This form is not accepting submissions');
    }

    const list: string[] = form.allowedDomains || [];
    if (list.length > 0 && !list.includes(originOf(req))) {
      return fail(403, 'Origin not allowed');
    }

    if (parseErr) {
      if (parseErr.message === 'PAYLOAD_TOO_LARGE') {
        return fail(413, 'Submission too large');
      }
      if (parseErr.message === 'MALFORMED_BODY') {
        // An unparseable multipart body would otherwise store a blank
        // submission and redirect to the thank-you page — silent data loss.
        return fail(400, 'Could not read the submitted form data');
      }
      throw parseErr;
    }

    const data = { ...parsed.fields };
    const requestedRedirect = data._redirect || '';
    for (const key of ['_gotcha', '_redirect', '_subject', '_next']) delete data[key];

    const check = validateFields(
      form.fields || [],
      parsed.fields,
      form.strict,
      // Empty parts are discarded by saveUploads, so they must not satisfy `required`
      // either — otherwise an empty upload passes validation and stores files: [].
      parsed.files.filter((f) => f.content.length > 0).map((f) => f.field)
    );
    if (!check.ok) {
      return fail(400, 'Validation failed', check.errors);
    }

    const conn = await Datastore.open();
    const submissionId = randomUUID();
    const files = await saveUploads(form.uuid, submissionId, parsed.files, maxUploadBytes());

    const submission = await conn.insertOne('submissions', {
      submissionId,
      formId: form.uuid,
      created: new Date().toISOString(),
      data,
      files,
      meta: {
        ip: String(req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || ''),
        userAgent: String(req.headers['user-agent'] || ''),
        referer: String(req.headers.referer || ''),
        origin: String(req.headers.origin || ''),
      },
      status: 'new',
      starred: false,
      notes: [],
      spam: { score: 0, reasons: [] },
      ai: null,
    });

    // The submission is already durable at this point. A stats failure must not
    // 500 the request — the visitor would hit back and resubmit, creating
    // duplicates with no explanation.
    try {
      await conn.updateOne('forms', form._id as string, {
        $inc: { 'stats.total': 1 },
        $set: { 'stats.lastSubmissionAt': new Date().toISOString() },
      });
    } catch (err: any) {
      console.error('Failed to update form stats for', form.uuid, err.message);
    }

    if (wantsJson) {
      return res.json({ ok: true, id: (submission as any)._id, submissionId });
    }
    const target = safeRedirect(form, requestedRedirect) || form.redirectUrl || `/thanks/${form.uuid}`;
    return res.redirect(302, target);
  } catch (err: any) {
    console.error('Submit error:', err.message);
    res.status(500).json({ ok: false, error: 'Could not accept submission' });
  }
});

app.get('/thanks/:formId', async (req, res) => {
  const form = await getFormByUuid(req.params.formId);
  const name = form ? form.name : 'the form';
  res.set('content-type', 'text/html');
  res.send(thanksPage(name));
});

// Upper bound on rows scanned for an in-memory search, so a large collection cannot
// turn one request into an unbounded read.
const SEARCH_SCAN_CAP = 1000;

app.get('/admin/api/forms/:formId/submissions', async (req, res) => {
  // Accepts either the _id used by /admin/api/forms/:id or the uuid.
  const form = await resolveForm(req.params.formId);
  if (!form) return res.status(404).json({ ok: false, error: 'Form not found' });

  const conn = await Datastore.open();
  const { search, status, from, to, limit, offset } = req.query as any;
  const lim = clampInt(limit, 50, 1, 500);
  const off = clampInt(offset, 0, 0, 1000000);

  const query: any = { formId: form.uuid };
  if (status) query.status = status;
  if (from || to) {
    query.created = {};
    if (from) query.created.$gte = from;
    if (to) query.created.$lte = to;
  }

  // Search scans a bounded window from the DB, then filters and pages it in
  // lib/search.ts. One row beyond the cap is fetched so `truncated` is exact.
  if (search) {
    const scanned = await conn
      .getMany('submissions', query, { sort: { created: -1 }, limit: SEARCH_SCAN_CAP + 1 })
      .toArray();
    const page = filterAndPaginate(scanned as any[], String(search), off, lim, SEARCH_SCAN_CAP);
    return res.json({ ok: true, ...page });
  }

  const rows = await conn
    .getMany('submissions', query, { sort: { created: -1 }, limit: lim, offset: off })
    .toArray();

  res.json({ ok: true, data: rows });
});

app.get('/admin/api/submissions/:id', async (req, res) => {
  const conn = await Datastore.open();
  const row = await conn.findOneOrNull('submissions', req.params.id);
  if (!row) return res.status(404).json({ ok: false, error: 'Submission not found' });
  res.json({ ok: true, data: row });
});

app.patch('/admin/api/submissions/:id', async (req, res) => {
  const conn = await Datastore.open();
  const existing = await conn.findOneOrNull('submissions', req.params.id);
  if (!existing) return res.status(404).json({ ok: false, error: 'Submission not found' });

  const patch: any = {};
  if (req.body?.status && ['new', 'read', 'archived', 'spam'].includes(req.body.status)) {
    patch.status = req.body.status;
  }
  if (typeof req.body?.starred === 'boolean') patch.starred = req.body.starred;

  const update: any = {};
  if (Object.keys(patch).length) update.$set = patch;
  if (req.body?.note) {
    update.$push = { notes: { text: String(req.body.note).slice(0, 2000), at: new Date().toISOString() } };
  }
  if (!Object.keys(update).length) {
    return res.status(400).json({ ok: false, error: 'Nothing to update' });
  }

  const updated = await conn.updateOne('submissions', req.params.id, update);
  res.json({ ok: true, data: updated });
});

app.delete('/admin/api/submissions/:id', async (req, res) => {
  const conn = await Datastore.open();
  const row: any = await conn.findOneOrNull('submissions', req.params.id);
  if (!row) return res.status(404).json({ ok: false, error: 'Submission not found' });
  for (const f of row.files || []) {
    // Log rather than swallow: the row is deleted either way, so a silent failure
    // would leak an orphaned file in storage with no operator visibility.
    try {
      await filestore.deleteFile(f.path);
    } catch (err: any) {
      console.error('Failed to delete uploaded file', f.path, err.message);
    }
  }
  await conn.removeOne('submissions', req.params.id);
  res.json({ ok: true, deleted: true });
});

// Uploads are attacker-supplied, so they are served only to an authenticated
// admin and never through a public app.storage() route.
app.get('/admin/api/submissions/:id/files/:fileId', async (req, res) => {
  const conn = await Datastore.open();
  const row: any = await conn.findOneOrNull('submissions', req.params.id);
  if (!row) return res.status(404).json({ ok: false, error: 'Submission not found' });
  const file = (row.files || []).find((f: any) => f.id === req.params.fileId);
  if (!file) return res.status(404).json({ ok: false, error: 'File not found' });

  // Obtain the stream BEFORE writing headers: once they are flushed, a failure here
  // would reach the client as a misleading 200 with an error body instead of a 404.
  let stream: any;
  try {
    stream = await filestore.getReadStream(file.path);
  } catch (err: any) {
    console.error('File download error:', err.message);
    return res.status(404).json({ ok: false, error: 'File not found' });
  }

  // file.contentType is attacker-supplied and echoed back, so forbid sniffing:
  // without it, serving an uploaded SVG inline (which the admin UI will want for
  // image previews) would let it run script on the admin origin.
  res.set('x-content-type-options', 'nosniff');
  res.set('content-type', file.contentType || 'application/octet-stream');
  // Quotes AND CR/LF: the multipart parser's filename="[^"]*" permits newlines,
  // which would let a filename inject extra response headers.
  const downloadName = String(file.filename || 'download').replace(/["\r\n]/g, '');
  res.set('content-disposition', `attachment; filename="${downloadName}"`);

  // The platform's stream has no .pipe(); codehooks-js serves its own static files
  // with this listener pattern (webserver.mjs), so match it.
  stream
    .on('data', (buf: any) => res.write(buf, 'buffer'))
    .on('end', () => res.end())
    .on('error', (err: any) => {
      console.error('File stream error:', err.message);
      res.end();
    });
});

app.get('/admin/api/forms/:formId/export.csv', async (req, res) => {
  // Accepts either the _id used by /admin/api/forms/:id or the uuid.
  const form = await resolveForm(req.params.formId);
  if (!form) return res.status(404).json({ ok: false, error: 'Form not found' });

  const conn = await Datastore.open();
  const rows = await conn
    .getMany('submissions', { formId: form.uuid }, { sort: { created: -1 } })
    .toArray();

  const dataColumns = collectColumns(rows as any);
  const columns = ['created', 'status', ...dataColumns];
  const flat = (rows as any[]).map((r) => ({
    created: r.created,
    status: r.status,
    ...r.data,
  }));

  res.set('content-type', 'text/csv; charset=utf-8');
  // Neutralise the interpolated identifier — never trust a path param in a header.
  const slug = String(form.uuid).replace(/[^A-Za-z0-9._-]/g, '');
  res.set('content-disposition', `attachment; filename="submissions-${slug}.csv"`);
  res.send(toCsv(flat, columns));
});

export default app.init();
