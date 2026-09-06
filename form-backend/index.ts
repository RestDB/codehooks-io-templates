import { app, Datastore, filestore } from 'codehooks-js';
import { signToken, verifyRequest, passwordMatches } from '#lib/auth';
import { defaultForm, getFormByUuid, resolveForm } from '#lib/forms';
import { checkLoginAttempt, clearLoginAttempts } from '#lib/throttle';
import type { FormDoc } from '#lib/forms';
import { parseBody } from '#lib/body';
import { validateFields } from '#lib/validation';
import { isHoneypotFilled, controlFieldsFor, checkSubmitRate } from '#lib/spam';
import { saveUploads } from '#lib/files';
import { originOf, corsHeaders, safeRedirect } from '#lib/security';
import { toCsv, collectColumns } from '#lib/csv';
import { thanksPage, errorPage } from '#lib/pages';
import { filterAndPaginate, clampInt } from '#lib/search';
import { randomUUID } from 'crypto';
import { emailChannel } from '#lib/channels/email';
import type { Channel } from '#lib/channels/types';
import type { SendResult } from '#lib/providers/types';
import { classify } from '#lib/delivery';
import { verifyFileToken } from '#lib/signed-links';
import { buildSnippet } from '#lib/snippet';

// Boot-time guard — a missing JWT_SECRET would make admin sessions forgeable.
(function checkConfig() {
  const missing: string[] = [];
  if (!process.env.JWT_SECRET) missing.push('JWT_SECRET (admin sessions would be forgeable)');
  if (!process.env.ADMIN_PASSWORD) missing.push('ADMIN_PASSWORD (admin login unprotected)');
  if (missing.length) {
    console.error('⚠️  form-backend: missing required env var(s): ' + missing.join(', '));
  }
})();

app.auth('/status', (req, res, next) => next());
app.auth('/admin/login', (req, res, next) => next());
app.auth('/admin/logout', (req, res, next) => next());
app.auth('/f/*', (req, res, next) => next());
app.auth('/thanks/*', (req, res, next) => next());
app.auth('/files/*', (req, res, next) => next());
app.auth('/setup/*', (req, res, next) => next());

// Admin API — bypass the platform API key, require our JWT cookie instead.
app.auth('/admin/api/*', (req, res, next) => {
  if (verifyRequest(req)) return next();
  res.status(401).json({ error: 'Not authenticated' });
  res.end();
});

// NOT /health: the platform serves its own `/health` (returning "Alive") and it
// shadows any route an app registers there, so an app-level /health never runs.
app.get('/status', (req, res) => {
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

app.get('/admin/api/forms/:id/snippet', async (req, res) => {
  const form = await resolveForm(req.params.id);
  if (!form) return res.status(404).json({ ok: false, error: 'Form not found' });
  res.json({ ok: true, snippet: buildSnippet(form, resolveBaseUrl(req)) });
});

// Setup diagnostics: the last few delivery attempts for one form, so a customer can
// see WHY a notification did not arrive without dropping to curl. Deliberately not a
// submissions view — this reports on the thing being configured, nothing more.
app.get('/admin/api/forms/:id/deliveries', async (req, res) => {
  const form = await resolveForm(req.params.id);
  if (!form) return res.status(404).json({ ok: false, error: 'Form not found' });

  const conn = await Datastore.open();
  const rows = await conn
    .getMany('deliveries', { formId: form.uuid }, { sort: { created: -1 }, limit: 5 })
    .toArray();

  res.json({
    ok: true,
    data: (rows as any[]).map((r) => ({
      channel: r.channel,
      target: r.target,
      status: r.status,
      attempts: r.attempts,
      lastError: r.lastError,
      created: r.created,
      sentAt: r.sentAt,
    })),
  });
});

app.patch('/admin/api/forms/:id', async (req, res) => {
  const conn = await Datastore.open();
  const existing = await conn.findOneOrNull('forms', req.params.id);
  if (!existing) return res.status(404).json({ ok: false, error: 'Form not found' });

  // uuid, created and stats are server-owned and never client-writable.
  // `retentionDays` is deliberately NOT writable: no purge job enforces it, and a
  // knob that silently does nothing could be mistaken for a retention guarantee.
  // `honeypot` IS writable now that the submit endpoint enforces it.
  const allowed: Array<keyof FormDoc> = [
    'name', 'enabled', 'fields', 'strict', 'redirectUrl',
    'allowRedirectOverride', 'allowedDomains', 'honeypot', 'notify',
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
  await conn.removeMany('deliveries', { formId: form.uuid });
  await conn.removeOne('forms', req.params.id);
  res.json({ ok: true, deleted: true });
});

function maxUploadBytes(): number {
  return (Number(process.env.MAX_UPLOAD_MB) || 5) * 1024 * 1024;
}

function submitRateLimit(): number {
  return Number(process.env.SUBMIT_RATE_LIMIT) || 30;
}

// Route handlers have a real request with forwarded-host headers; a QUEUE WORKER
// does not, so this fallback only ever fires for a route. The `deliver` worker
// below reads process.env.BASE_URL directly and treats it as required — see the
// comment there.
function resolveBaseUrl(req: any): string {
  const configured = process.env.BASE_URL;
  if (configured) return configured.replace(/\/+$/, '');
  const proto = req?.headers?.['x-forwarded-proto'] || 'https';
  const host = req?.headers?.['x-forwarded-host'] || req?.headers?.host;
  return host ? `${proto}://${host}` : '';
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

    // Rate limit AFTER parsing: parseBody must remain the first await (the platform
    // consumes the request stream once a handler yields). A flood therefore still
    // costs one buffered body each; the limit protects the database, the queue and
    // the owner's inbox rather than raw bandwidth.
    const conn = await Datastore.open();
    const rate = await checkSubmitRate(conn, form.uuid, req, submitRateLimit());
    if (!rate.allowed) {
      res.set('Retry-After', String(rate.retryAfterSeconds));
      return fail(429, 'Too many submissions. Please try again later.');
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
    for (const key of controlFieldsFor(form.honeypot || '')) delete data[key];

    // A filled honeypot means a bot. Store it, mark it spam, answer with an ordinary
    // success, and never enqueue: telling a bot it was detected only helps it adapt,
    // and storing rather than dropping means a false positive is recoverable from the
    // inbox instead of silently lost.
    const isSpam = isHoneypotFilled(parsed.fields, form.honeypot || '');

    const check = validateFields(
      form.fields || [],
      parsed.fields,
      form.strict,
      // Empty parts are discarded by saveUploads, so they must not satisfy `required`
      // either — otherwise an empty upload passes validation and stores files: [].
      parsed.files.filter((f) => f.content.length > 0).map((f) => f.field),
      controlFieldsFor(form.honeypot || '')
    );
    if (!check.ok) {
      return fail(400, 'Validation failed', check.errors);
    }

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
      status: isSpam ? 'spam' : 'new',
      starred: false,
      notes: [],
      spam: { score: isSpam ? 100 : 0, reasons: isSpam ? ['honeypot'] : [] },
      ai: null,
    });

    // A filled honeypot must never produce a delivery row or an email — the whole
    // notification feature hinges on this guard, so the `deliver` worker ALSO
    // checks submission.status === 'spam' independently (belt and braces).
    if (!isSpam) {
      await conn.enqueue('processSubmission', { submissionId: (submission as any)._id });
    }

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

const CHANNELS: Channel[] = [emailChannel];
const MAX_SEND_ATTEMPTS = 5;

// Fan out one deliveries row per channel target, then enqueue a deliver task each.
app.worker('processSubmission', async (req, res) => {
  const { submissionId } = req.body.payload;
  const conn = await Datastore.open();
  const submission: any = await conn.findOneOrNull('submissions', submissionId);
  // Belt and braces: the submit handler already guards the enqueue on `!isSpam`,
  // but a spam row must never produce a delivery or an email even if that guard
  // is ever bypassed (a redrive, a future caller, a bug) — check it again here.
  if (!submission || submission.status === 'spam') return res.end();

  const form = await getFormByUuid(submission.formId);
  if (!form) return res.end();

  for (const channel of CHANNELS) {
    for (const target of channel.targets(form)) {
      // codehooks-js retries workers automatically, so `processSubmission` can run
      // more than once for the same submission. Without this check a retry would
      // insert a second row for the same (submission, channel, target) and send a
      // duplicate email to the same recipient.
      const existing = await conn.findOneOrNull('deliveries', {
        submissionId, channel: channel.name, target,
      });
      if (existing) continue;

      const row = await conn.insertOne('deliveries', {
        submissionId, formId: submission.formId, channel: channel.name, target,
        status: 'pending', attempts: 0, lastError: null, lastAttemptAt: null,
        retryAfter: null, created: new Date().toISOString(), sentAt: null,
      });
      await conn.enqueue('deliver', { deliveryId: (row as any)._id });
    }
  }
  res.end();
});

// All retry logic lives here, so channels stay simple adapters.
app.worker('deliver', async (req, res) => {
  const { deliveryId } = req.body.payload;
  const conn = await Datastore.open();
  const row: any = await conn.findOneOrNull('deliveries', deliveryId);
  if (!row || row.status === 'sent' || row.status === 'skipped') return res.end();

  const channel = CHANNELS.find((c) => c.name === row.channel);
  const submission: any = await conn.findOneOrNull('submissions', row.submissionId);
  const form = submission ? await getFormByUuid(submission.formId) : null;
  if (!channel || !submission || !form) {
    await conn.updateOne('deliveries', deliveryId, { $set: { status: 'skipped' } });
    return res.end();
  }

  // resolveBaseUrl(req) is NOT usable here: a worker's `req` carries no
  // x-forwarded-host or host header, so it would resolve to '' and every signed
  // download link in the email would come out relative and broken. BASE_URL is
  // therefore required for notifications, not merely a nice-to-have fallback.
  const configuredBaseUrl = process.env.BASE_URL;
  if (!configuredBaseUrl) {
    console.error('Cannot deliver notification: BASE_URL is not configured');
    await conn.updateOne('deliveries', deliveryId, {
      $set: {
        status: 'failed',
        attempts: (row.attempts || 0) + 1,
        lastError: 'BASE_URL is not configured',
        lastAttemptAt: new Date().toISOString(),
      },
    });
    return res.end();
  }

  // A channel is expected to catch its own errors and resolve a SendResult, but a
  // provider misconfiguration (e.g. no EMAIL_PROVIDER credentials) throws
  // SYNCHRONOUSLY by design (see lib/providers/index.ts, Task 5: "a misconfiguration
  // must fail loudly"). Caught here so it reaches `classify` as a result with no
  // statusCode — the SAME transient bucket as a network error. A fixable
  // misconfiguration (the operator sets the missing key) then self-heals through
  // the hourly redrive instead of permanently discarding every queued
  // notification; a genuinely permanent one still terminates once attempts run out.
  let result: SendResult;
  try {
    result = await channel.deliver({
      form, submission, target: row.target, baseUrl: configuredBaseUrl.replace(/\/+$/, ''),
    });
  } catch (err: any) {
    result = { ok: false, error: err.message };
  }

  const outcome = classify(result, row.attempts || 0, MAX_SEND_ATTEMPTS);
  await conn.updateOne('deliveries', deliveryId, {
    $set: {
      status: outcome.status,
      attempts: outcome.attempts,
      lastError: result.ok ? null : (result.error || null),
      lastAttemptAt: new Date().toISOString(),
      sentAt: outcome.status === 'sent' ? new Date().toISOString() : (row.sentAt ?? null),
      // A 429 is the provider asking to slow down, not refusing the message —
      // record what it asked for so an operator can see why a row is still pending.
      retryAfter: result.ok ? null : (result.retryAfter ?? null),
    },
  });
  res.end();
});

// Re-drive anything still pending. The initial enqueue happens immediately, so
// this only picks up transient failures.
app.job('0 * * * *', async (req, res) => {
  const conn = await Datastore.open();
  await conn.enqueueFromQuery(
    'deliveries',
    { status: 'pending', attempts: { $lt: MAX_SEND_ATTEMPTS } },
    'deliver',
    { limit: 1000 }
  );
  res.end();
});

// Public, token-scoped file download for links in notification emails. The admin
// route needs a session cookie, which an email cannot carry.
//
// The token grants ONE file and expires, so a leaked email exposes those files
// until exp rather than forever. The response is still attachment + nosniff,
// because the bytes are attacker-supplied.
app.get('/files/:token', async (req, res) => {
  const claims = verifyFileToken(req.params.token);
  if (!claims) return res.status(404).json({ ok: false, error: 'Link is invalid or has expired' });

  const conn = await Datastore.open();
  const row: any = await conn.findOneOrNull('submissions', claims.sid);
  if (!row) return res.status(404).json({ ok: false, error: 'File not found' });
  const file = (row.files || []).find((f: any) => f.id === claims.fid);
  if (!file) return res.status(404).json({ ok: false, error: 'File not found' });

  // Obtain the stream BEFORE writing headers: once they are flushed, a failure
  // would reach the client as a misleading 200 with an error body.
  let stream: any;
  try {
    stream = await filestore.getReadStream(file.path);
  } catch (err: any) {
    console.error('Signed download error:', err.message);
    return res.status(404).json({ ok: false, error: 'File not found' });
  }

  res.set('x-content-type-options', 'nosniff');
  res.set('content-type', file.contentType || 'application/octet-stream');
  res.set('content-disposition', `attachment; filename="${String(file.filename).replace(/["\r\n\\]/g, '')}"`);

  // The platform's stream has no .pipe(); this matches codehooks-js's own app.static.
  stream
    .on('data', (buf: any) => res.write(buf, 'buffer'))
    .on('end', () => res.end())
    .on('error', (err: any) => {
      console.error('Signed download stream error:', err.message);
      res.end();
    });
});

// The setup page is a static file. Everything it does goes through /admin/api/*,
// which requires the session cookie, so serving the page itself is not sensitive.
app.static({ route: '/setup', directory: '/public', default: 'index.html' });

export default app.init();
