import { app, Datastore } from 'codehooks-js';
import { signToken, verifyRequest, passwordMatches } from '#lib/auth';
import { defaultForm, getFormByUuid } from '#lib/forms';
import type { FormDoc } from '#lib/forms';
import { parseBody } from '#lib/body';
import { validateFields } from '#lib/validation';
import { saveUploads } from '#lib/files';
import { originOf, corsHeaders, safeRedirect } from '#lib/security';
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

app.post('/admin/login', (req, res) => {
  if (!passwordMatches(req.body?.password)) {
    return res.status(401).json({ ok: false, error: 'Invalid password' });
  }
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
  const allowed: Array<keyof FormDoc> = [
    'name', 'enabled', 'fields', 'strict', 'redirectUrl',
    'allowRedirectOverride', 'allowedDomains', 'honeypot', 'retentionDays',
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

    if (!form.enabled) {
      return res.status(403).json({ ok: false, error: 'This form is not accepting submissions' });
    }

    const list: string[] = form.allowedDomains || [];
    if (list.length > 0 && !list.includes(originOf(req))) {
      return res.status(403).json({ ok: false, error: 'Origin not allowed' });
    }

    if (parseErr) {
      if (parseErr.message === 'PAYLOAD_TOO_LARGE') {
        return res.status(413).json({ ok: false, error: 'Submission too large' });
      }
      throw parseErr;
    }

    const wantsJson = String(req.headers['content-type'] || '').includes('application/json');
    const data = { ...parsed.fields };
    const requestedRedirect = data._redirect || '';
    for (const key of ['_gotcha', '_redirect', '_subject', '_next']) delete data[key];

    const check = validateFields(form.fields || [], parsed.fields, form.strict);
    if (!check.ok) {
      return res.status(400).json({ ok: false, error: 'Validation failed', errors: check.errors });
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

    await conn.updateOne('forms', form._id as string, {
      $inc: { 'stats.total': 1 },
      $set: { 'stats.lastSubmissionAt': new Date().toISOString() },
    });

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
  res.send(
    `<!doctype html><meta charset="utf-8"><title>Thank you</title>` +
    `<div style="font-family:system-ui;max-width:32rem;margin:20vh auto;text-align:center">` +
    `<h1>Thank you</h1><p>Your submission to ${name.replace(/[<>&]/g, '')} was received.</p></div>`
  );
});

export default app.init();
