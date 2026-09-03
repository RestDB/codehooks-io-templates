import { app, Datastore } from 'codehooks-js';
import { signToken, verifyRequest, passwordMatches } from '#lib/auth';
import { defaultForm, getFormByUuid } from '#lib/forms';
import type { FormDoc } from '#lib/forms';

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
  res.set('Set-Cookie', `token=${signToken()}; HttpOnly; Path=/; SameSite=Strict; Max-Age=604800`);
  res.json({ ok: true });
});

app.post('/admin/logout', (req, res) => {
  res.set('Set-Cookie', 'token=; HttpOnly; Path=/; SameSite=Strict; Max-Age=0');
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

export default app.init();
