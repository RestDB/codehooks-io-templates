import { app, Datastore, filestore } from 'codehooks-js';
import { PassThrough } from 'stream';
import * as jwt from 'jsonwebtoken';
import { subscribeSchema } from './lib/validation';
import { generateToken, generateTokenExpiry, isTokenExpired } from './lib/tokens';
import { checkIpRateLimit, checkEmailResendLimit, checkLoginRateLimit } from './lib/rate-limit';
import { createHash, timingSafeEqual } from 'crypto';
import { sendEmail } from './lib/providers';
import { confirmationEmail, newsletterEmail } from './lib/templates';
import { confirmedPage, unsubscribedPage, errorPage } from './lib/pages';
import { getSettings, updateSettings, AppSettings } from './lib/settings';

function getEnv(key: string, fallback?: string): string {
  return process.env[key] || fallback || '';
}

// Boot-time misconfiguration guard — loudly flag missing critical env vars so a
// misconfigured deploy fails visibly in the logs instead of silently (e.g. an empty
// JWT_SECRET would make admin sessions forgeable).
(function checkConfig() {
  const missing: string[] = [];
  if (!process.env.JWT_SECRET) missing.push('JWT_SECRET (admin sessions would be forgeable)');
  if (!process.env.ADMIN_PASSWORD) missing.push('ADMIN_PASSWORD (admin login unprotected)');
  const provider = (process.env.EMAIL_PROVIDER || 'mailgun').toLowerCase();
  if (provider === 'mailgun' && (!process.env.MAILGUN_API_KEY || !process.env.MAILGUN_DOMAIN)) {
    missing.push('MAILGUN_API_KEY / MAILGUN_DOMAIN');
  }
  if (provider === 'brevo' && !process.env.BREVO_API_KEY) missing.push('BREVO_API_KEY');
  if (missing.length) {
    console.error('⚠️  email-newsletter: missing required env var(s): ' + missing.join(', ') + '. See .env.example / README.');
  }
})();

// Resolve the absolute base URL for links in emails/pages.
// Prefers configured baseUrl, otherwise derives it from the incoming request.
function resolveBaseUrl(req: any, settings: AppSettings): string {
  if (settings.baseUrl) return settings.baseUrl.replace(/\/+$/, '');
  const proto = req?.headers?.['x-forwarded-proto'] || 'https';
  const host = req?.headers?.['x-forwarded-host'] || req?.headers?.host;
  return host ? `${proto}://${host}` : '';
}

// --- Auth bypasses (public routes) ---
app.auth('/subscribe', (req, res, next) => next());
app.auth('/confirm/*', (req, res, next) => next());
app.auth('/unsubscribe/*', (req, res, next) => next());
app.auth('/admin/login', (req, res, next) => next());
app.auth('/admin/logout', (req, res, next) => next());
app.auth('/admin.html', (req, res, next) => next());
app.auth('/branding', (req, res, next) => next());

// Admin API — bypass API key but require JWT cookie
app.auth('/admin/api/*', (req, res, next) => {
  try {
    const cookies = parseCookies(req.headers.cookie || '');
    const token = cookies.token;
    if (!token) {
      res.status(401).json({ error: 'Not authenticated' });
      return res.end();
    }
    jwt.verify(token, getEnv('JWT_SECRET'));
    next();
  } catch {
    res.status(401).json({ error: 'Not authenticated' });
    res.end();
  }
});

// --- Helpers ---
function parseCookies(cookieHeader: string): Record<string, string> {
  const cookies: Record<string, string> = {};
  cookieHeader.split(';').forEach((c) => {
    const [key, ...rest] = c.trim().split('=');
    if (key) cookies[key] = rest.join('=');
  });
  return cookies;
}

// --- POST /subscribe ---
app.post('/subscribe', async (req, res) => {
  try {
    const ip = req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || 'unknown';
    const ipAllowed = await checkIpRateLimit(typeof ip === 'string' ? ip : ip[0]);
    if (!ipAllowed) {
      return res.status(429).json({ ok: false, error: 'Too many requests. Please try again later.' });
    }

    const parsed = subscribeSchema.safeParse(req.body);
    if (!parsed.success) {
      const firstError = (parsed.error as any).issues?.[0]?.message || 'Invalid input';
      return res.status(400).json({ ok: false, error: firstError });
    }

    const { email, list } = parsed.data;
    const conn = await Datastore.open();

    // Validate list exists in DB
    const listExists = await conn.findOneOrNull('lists', { name: list });
    if (!listExists) {
      return res.status(400).json({ ok: false, error: `Unknown list: ${list}` });
    }

    const settings = await getSettings();
    const baseUrl = resolveBaseUrl(req, settings);
    const emailListKey = `${email}::${list}`;

    const existing: any[] = await conn.getMany('subscribers', { emailListKey }, { limit: 1 }).toArray();

    if (existing.length > 0) {
      const subscriber = existing[0];

      if (subscriber.status === 'confirmed') {
        return res.status(409).json({ ok: false, error: 'You are already subscribed.' });
      }

      if (subscriber.status === 'pending') {
        const canResend = await checkEmailResendLimit(email, list);
        if (!canResend) {
          return res.json({ ok: true, message: 'Confirmation email already sent. Please check your inbox.' });
        }
        const unsub = `${baseUrl}/unsubscribe/${subscriber.unsubscribeToken}`;
        const { subject, html } = confirmationEmail({
          confirmUrl: `${baseUrl}/confirm/${subscriber.confirmToken}`,
          unsubscribeUrl: unsub,
          listName: list,
          settings,
        });
        await sendEmail({ to: email, subject, html, unsubscribeUrl: unsub, fromEmail: settings.fromEmail, fromName: settings.fromName });
        return res.json({ ok: true, message: 'Confirmation email sent. Please check your inbox.' });
      }

      if (subscriber.status === 'unsubscribed') {
        const confirmToken = generateToken();
        const unsubscribeToken = generateToken();
        await conn.updateOne('subscribers', subscriber._id, {
          $set: {
            status: 'pending',
            confirmToken,
            unsubscribeToken,
            tokenExpiresAt: generateTokenExpiry(),
            unsubscribedAt: null,
          },
        });
        const unsub2 = `${baseUrl}/unsubscribe/${unsubscribeToken}`;
        const { subject, html } = confirmationEmail({
          confirmUrl: `${baseUrl}/confirm/${confirmToken}`,
          unsubscribeUrl: unsub2,
          listName: list,
          settings,
        });
        await sendEmail({ to: email, subject, html, unsubscribeUrl: unsub2, fromEmail: settings.fromEmail, fromName: settings.fromName });
        return res.json({ ok: true, message: 'Confirmation email sent. Please check your inbox.' });
      }
    }

    const confirmToken = generateToken();
    const unsubscribeToken = generateToken();

    await conn.insertOne('subscribers', {
      email, list, emailListKey,
      status: 'pending',
      confirmToken, unsubscribeToken,
      tokenExpiresAt: generateTokenExpiry(),
      createdAt: new Date().toISOString(),
      confirmedAt: null,
      unsubscribedAt: null,
    });

    const unsub3 = `${baseUrl}/unsubscribe/${unsubscribeToken}`;
    const { subject, html } = confirmationEmail({
      confirmUrl: `${baseUrl}/confirm/${confirmToken}`,
      unsubscribeUrl: unsub3,
      listName: list,
      settings,
    });
    await sendEmail({ to: email, subject, html, unsubscribeUrl: unsub3, fromEmail: settings.fromEmail, fromName: settings.fromName });
    res.json({ ok: true, message: 'Confirmation email sent. Please check your inbox.' });
  } catch (err: any) {
    console.error('Subscribe error:', err.message);
    res.status(500).json({ ok: false, error: 'Something went wrong. Please try again.' });
  }
});

// --- GET /confirm/:token ---
app.get('/confirm/:token', async (req, res) => {
  const settings = await getSettings();
  try {
    const { token } = req.params;
    const conn = await Datastore.open();
    const results: any[] = await conn.getMany('subscribers', { confirmToken: token }, { limit: 1 }).toArray();

    if (results.length === 0) {
      res.set('content-type', 'text/html');
      return res.status(404).send(errorPage('This confirmation link is invalid or has already been used.', settings));
    }

    const subscriber = results[0];

    if (subscriber.status === 'confirmed') {
      res.set('content-type', 'text/html');
      return res.send(confirmedPage(settings));
    }

    if (isTokenExpired(subscriber.tokenExpiresAt)) {
      res.set('content-type', 'text/html');
      return res.status(404).send(errorPage('This confirmation link has expired. Please sign up again.', settings));
    }

    await conn.updateOne('subscribers', subscriber._id, {
      $set: { status: 'confirmed', confirmedAt: new Date().toISOString() },
    });

    res.set('content-type', 'text/html');
    res.send(confirmedPage(settings));
  } catch (err: any) {
    console.error('Confirm error:', err.message);
    res.set('content-type', 'text/html');
    res.status(500).send(errorPage('Something went wrong. Please try again.', settings));
  }
});

// --- GET /unsubscribe/:token ---
app.get('/unsubscribe/:token', async (req, res) => {
  const settings = await getSettings();
  try {
    const { token } = req.params;
    const conn = await Datastore.open();
    const results: any[] = await conn.getMany('subscribers', { unsubscribeToken: token }, { limit: 1 }).toArray();

    if (results.length === 0) {
      res.set('content-type', 'text/html');
      return res.status(404).send(errorPage('This unsubscribe link is invalid.', settings));
    }

    const subscriber = results[0];

    if (subscriber.status === 'unsubscribed') {
      res.set('content-type', 'text/html');
      return res.send(unsubscribedPage(settings));
    }

    await conn.updateOne('subscribers', subscriber._id, {
      $set: { status: 'unsubscribed', unsubscribedAt: new Date().toISOString() },
    });

    res.set('content-type', 'text/html');
    res.send(unsubscribedPage(settings));
  } catch (err: any) {
    console.error('Unsubscribe error:', err.message);
    res.set('content-type', 'text/html');
    res.status(500).send(errorPage('Something went wrong. Please try again.', settings));
  }
});

// Constant-time password comparison (hash first so differing lengths don't leak / throw).
function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(String(a)).digest();
  const hb = createHash('sha256').update(String(b)).digest();
  return timingSafeEqual(ha, hb);
}

// --- POST /admin/login ---
app.post('/admin/login', async (req, res) => {
  try {
    const ip = req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || 'unknown';
    const allowed = await checkLoginRateLimit(typeof ip === 'string' ? ip : ip[0]);
    if (!allowed) {
      return res.status(429).json({ ok: false, error: 'Too many login attempts. Please try again later.' });
    }
    const { password } = req.body;
    const expected = getEnv('ADMIN_PASSWORD');
    if (!expected || !safeEqual(String(password || ''), expected)) {
      return res.status(401).json({ ok: false, error: 'Invalid password' });
    }
    const token = jwt.sign({ sub: 'admin' }, getEnv('JWT_SECRET'), { expiresIn: '24h' });
    res.set('Set-Cookie', `token=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${24 * 60 * 60}`);
    res.json({ ok: true });
  } catch (err: any) {
    console.error('Login error:', err.message);
    res.status(500).json({ ok: false, error: 'Login failed' });
  }
});

// --- GET /admin/logout ---
app.get('/admin/logout', (req, res) => {
  res.set('Set-Cookie', 'token=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0');
  res.json({ ok: true });
});

// --- GET /branding (public, non-secret subset for login screen + public pages) ---
app.get('/branding', async (req, res) => {
  const s = await getSettings();
  res.json({
    ok: true,
    data: {
      appName: s.appName,
      logoUrl: s.logoUrl,
      primaryColor: s.primaryColor,
      textColor: s.textColor,
      websiteUrl: s.websiteUrl,
    },
  });
});

// --- GET /admin/api/settings ---
app.get('/admin/api/settings', async (req, res) => {
  const settings = await getSettings();
  res.json({ ok: true, data: { ...settings, envPaused: process.env.SENDING_PAUSED === 'true' } });
});

// --- PUT /admin/api/settings ---
app.put('/admin/api/settings', async (req, res) => {
  try {
    const allowed: (keyof AppSettings)[] = [
      'appName', 'logoUrl', 'primaryColor', 'textColor', 'emailBrand',
      'fromEmail', 'fromName', 'maxPerHour', 'sendingPaused', 'baseUrl', 'websiteUrl',
      'footerCompanyName', 'footerAddress', 'footerText',
    ];
    const partial: Partial<AppSettings> = {};
    for (const key of allowed) {
      if (key in (req.body || {})) (partial as any)[key] = req.body[key];
    }
    await updateSettings(partial);
    // Return effective settings (folds in the env kill-switch) so the UI reflects true state.
    const updated = await getSettings();
    res.json({ ok: true, data: { ...updated, envPaused: process.env.SENDING_PAUSED === 'true' } });
  } catch (err: any) {
    console.error('Settings update error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to save settings' });
  }
});

// --- GET /admin/api/subscribers ---
app.get('/admin/api/subscribers', async (req, res) => {
  const conn = await Datastore.open();
  const { search, list, status, limit = '50', offset = '0' } = req.query;

  const query: any = {};
  if (list) query.list = list;
  if (status) query.status = status;
  if (search) query.email = { $regex: search };

  const subscribers = await conn
    .getMany('subscribers', query, {
      limit: parseInt(limit as string),
      offset: parseInt(offset as string),
      sort: { createdAt: -1 },
    })
    .toArray();

  res.json({ ok: true, data: subscribers });
});

// --- GET /admin/api/lists ---
app.get('/admin/api/lists', async (req, res) => {
  const conn = await Datastore.open();
  const lists = await conn.getMany('lists', {}, { sort: { name: 1 } }).toArray();
  res.json({ ok: true, data: lists });
});

// --- POST /admin/api/lists ---
app.post('/admin/api/lists', async (req, res) => {
  const { name } = req.body;
  if (!name || typeof name !== 'string') {
    return res.status(400).json({ ok: false, error: 'List name is required' });
  }

  const listName = name.toLowerCase().trim().replace(/[^a-z0-9-]/g, '');
  if (!listName) {
    return res.status(400).json({ ok: false, error: 'Invalid list name' });
  }

  const conn = await Datastore.open();
  const existing = await conn.findOneOrNull('lists', { name: listName });
  if (existing) {
    return res.status(409).json({ ok: false, error: 'List already exists' });
  }

  await conn.insertOne('lists', { name: listName, createdAt: new Date().toISOString() });
  res.json({ ok: true });
});

// --- DELETE /admin/api/lists/:id ---
app.delete('/admin/api/lists/:id', async (req, res) => {
  try {
    const conn = await Datastore.open();
    const listDoc: any = await conn.findOneOrNull('lists', req.params.id);
    if (!listDoc) {
      return res.status(404).json({ ok: false, error: 'List not found' });
    }

    // Remove all subscribers on this list
    await conn.removeMany('subscribers', { list: listDoc.name });

    // Remove the list itself
    await conn.removeOne('lists', req.params.id);

    res.json({ ok: true });
  } catch (err: any) {
    console.error('Delete list error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to delete list' });
  }
});

// --- POST /admin/api/import ---
app.post('/admin/api/import', async (req, res) => {
  try {
    const { emails, list, status: importStatus = 'confirmed' } = req.body;

    if (!emails || !Array.isArray(emails) || emails.length === 0) {
      return res.status(400).json({ ok: false, error: 'emails array is required' });
    }
    if (!list || typeof list !== 'string') {
      return res.status(400).json({ ok: false, error: 'list is required' });
    }

    const conn = await Datastore.open();

    // Verify list exists
    const listExists = await conn.findOneOrNull('lists', { name: list });
    if (!listExists) {
      return res.status(400).json({ ok: false, error: `Unknown list: ${list}` });
    }

    // Queue emails in batches for the import worker
    const BATCH_SIZE = 50;
    let queued = 0;
    for (let i = 0; i < emails.length; i += BATCH_SIZE) {
      const batch = emails.slice(i, i + BATCH_SIZE);
      await conn.enqueue('importBatch', { batch, list, status: importStatus });
      queued += batch.length;
    }

    res.json({ ok: true, queued, message: `${queued} email(s) queued for import. Check subscribers list shortly.` });
  } catch (err: any) {
    console.error('Import error:', err.message);
    res.status(500).json({ ok: false, error: 'Import failed' });
  }
});

// --- Import batch worker ---
app.worker('importBatch', async (req, res) => {
  const { batch, list, status: importStatus } = req.body.payload;
  const conn = await Datastore.open();
  let imported = 0;
  let skipped = 0;

  for (const rawEmail of batch) {
    const email = String(rawEmail).toLowerCase().trim();
    if (!email || !email.includes('@')) {
      skipped++;
      continue;
    }

    const emailListKey = `${email}::${list}`;
    const existing = await conn.findOneOrNull('subscribers', { emailListKey });

    if (existing) {
      skipped++;
      continue;
    }

    await conn.insertOne('subscribers', {
      email,
      list,
      emailListKey,
      status: importStatus,
      confirmToken: generateToken(),
      unsubscribeToken: generateToken(),
      tokenExpiresAt: null,
      createdAt: new Date().toISOString(),
      confirmedAt: importStatus === 'confirmed' ? new Date().toISOString() : null,
      unsubscribedAt: null,
    });
    imported++;
  }

  console.log(`Import batch: ${imported} imported, ${skipped} skipped`);
  res.end();
}, { timeout: 30000, workers: 1 }); // serial processing; safe on all plans (raise workers on paid plans for faster delivery)

// --- GET /admin/api/stats ---
app.get('/admin/api/stats', async (req, res) => {
  const conn = await Datastore.open();
  const all = await conn.getMany('subscribers', {}).toArray();
  const total = all.length;
  const confirmed = all.filter((s: any) => s.status === 'confirmed').length;
  const pending = all.filter((s: any) => s.status === 'pending').length;
  const unsubscribed = all.filter((s: any) => s.status === 'unsubscribed').length;
  res.json({ ok: true, total, confirmed, pending, unsubscribed });
});

// --- GET /admin/api/email-log ---
app.get('/admin/api/email-log', async (req, res) => {
  const conn = await Datastore.open();
  const { search, status, campaignId, limit = '50', offset = '0' } = req.query;

  const query: any = {};
  if (status) query.status = status;
  if (search) query.to = { $regex: search };
  if (campaignId) query.campaignId = campaignId;

  const logs = await conn
    .getMany('email_log', query, {
      limit: parseInt(limit as string),
      offset: parseInt(offset as string),
      sort: { sentAt: -1 },
    })
    .toArray();

  res.json({ ok: true, data: logs });
});

// --- DELETE /admin/api/campaigns/:id ---
app.delete('/admin/api/campaigns/:id', async (req, res) => {
  try {
    const conn = await Datastore.open();
    await conn.removeOne('campaigns', req.params.id);
    res.json({ ok: true });
  } catch (err: any) {
    console.error('Delete campaign error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to delete campaign' });
  }
});

// --- DELETE /admin/api/subscribers/:id ---
app.delete('/admin/api/subscribers/:id', async (req, res) => {
  try {
    const conn = await Datastore.open();
    await conn.removeOne('subscribers', req.params.id);
    res.json({ ok: true });
  } catch (err: any) {
    console.error('Delete subscriber error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to delete subscriber' });
  }
});

// --- GET /admin/api/campaigns ---
app.get('/admin/api/campaigns', async (req, res) => {
  const conn = await Datastore.open();
  const { limit = '50', offset = '0' } = req.query;

  const campaigns = await conn
    .getMany('campaigns', {}, {
      limit: parseInt(limit as string),
      offset: parseInt(offset as string),
      sort: { createdAt: -1 },
    })
    .toArray();

  res.json({ ok: true, data: campaigns });
});

// --- GET /admin/api/campaigns/:id ---
app.get('/admin/api/campaigns/:id', async (req, res) => {
  try {
    const conn = await Datastore.open();
    const campaign = await conn.findOneOrNull('campaigns', req.params.id);
    if (!campaign) {
      return res.status(404).json({ ok: false, error: 'Campaign not found' });
    }
    res.json({ ok: true, data: campaign });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// --- POST /admin/api/campaigns/:id/redrive — reset failed deliveries to pending and re-enqueue ---
// Recovers a campaign after a provider rate-limit/outage: flips its `failed` email_log rows back to
// `pending` (fresh attempt budget) and re-queues all pending now. Safe while paused (worker no-ops);
// the cooldown breaker keeps it from hammering once sending resumes.
app.post('/admin/api/campaigns/:id/redrive', async (req, res) => {
  try {
    const conn = await Datastore.open();
    const campaignId = req.params.id;
    const campaign: any = await conn.findOneOrNull('campaigns', campaignId);
    if (campaign && campaign.status === 'cancelled') {
      return res.status(400).json({ ok: false, error: 'Campaign is cancelled' });
    }
    const failedRows: any[] = await conn.getMany('email_log', { campaignId, status: 'failed' }, { limit: 100000 }).toArray();
    const count = failedRows.length;
    if (count > 0) {
      await conn.updateMany('email_log', { campaignId, status: 'failed' }, { $set: { status: 'pending', attempts: 0, error: null, statusCode: null } });
      try { await conn.updateOne('campaigns', campaignId, { $inc: { failed: -count } }); } catch {}
    }
    await conn.enqueueFromQuery('email_log', { campaignId, status: 'pending', attempts: { $lt: MAX_SEND_ATTEMPTS } }, 'sendEmail', { limit: 100000 });
    res.json({ ok: true, redriven: count, message: `${count} failed delivery(ies) reset to pending and re-queued.` });
  } catch (err: any) {
    console.error('Redrive error:', err.message);
    res.status(500).json({ ok: false, error: 'Re-drive failed' });
  }
});

// --- POST /admin/api/campaigns/:id/cancel — stop a campaign from sending any further ---
// Marks the campaign 'cancelled' and flips its un-sent (pending/failed) deliveries to 'cancelled' so
// neither the hourly sweep nor a re-drive will send them. Already-'sent' rows are untouched.
app.post('/admin/api/campaigns/:id/cancel', async (req, res) => {
  try {
    const conn = await Datastore.open();
    const campaignId = req.params.id;
    const stoppable: any[] = await conn.getMany('email_log', { campaignId, status: { $in: ['pending', 'failed'] } }, { limit: 100000 }).toArray();
    const count = stoppable.length;
    if (count > 0) {
      await conn.updateMany('email_log', { campaignId, status: { $in: ['pending', 'failed'] } }, { $set: { status: 'cancelled' } });
    }
    await conn.updateOne('campaigns', campaignId, { $set: { status: 'cancelled' } });
    res.json({ ok: true, cancelled: count, message: `Campaign cancelled — ${count} un-sent delivery(ies) stopped.` });
  } catch (err: any) {
    console.error('Cancel error:', err.message);
    res.status(500).json({ ok: false, error: 'Cancel failed' });
  }
});

// --- POST /admin/api/send ---
app.post('/admin/api/send', async (req, res) => {
  const { subject, body, bodyMarkdown, lists } = req.body;

  if (!subject || !body || !lists || !Array.isArray(lists) || lists.length === 0) {
    return res.status(400).json({ ok: false, error: 'Subject, body, and lists are required' });
  }

  const conn = await Datastore.open();

  // Create campaign
  const campaign: any = await conn.insertOne('campaigns', {
    subject,
    body,
    bodyMarkdown: bodyMarkdown || body,
    lists,
    status: 'sending',
    queued: 0,
    sent: 0,
    failed: 0,
    createdAt: new Date().toISOString(),
  });

  let queued = 0;

  for (const list of lists) {
    const subscribers: any[] = await conn
      .getMany('subscribers', { list, status: 'confirmed' })
      .toArray();

    for (const subscriber of subscribers) {
      // Minimal payload — the worker reads subject/body from the campaign, so a
      // retry re-enqueued from email_log only needs the per-recipient fields.
      await conn.enqueue('sendEmail', {
        campaignId: campaign._id,
        to: subscriber.email,
        unsubscribeToken: subscriber.unsubscribeToken,
      });
      queued++;
    }
  }

  // Update campaign with queued count
  await conn.updateOne('campaigns', campaign._id, {
    $set: { queued },
  });

  // Set expectations: with an hourly cap, a large send paces over several hours.
  const cap = Number((await getSettings()).maxPerHour) || 0;
  let message = `${queued} email(s) queued for delivery.`;
  if (cap > 0 && queued > cap) {
    message = `${queued} email(s) queued — pacing at ${cap}/hr to respect provider limits (~${Math.ceil(queued / cap)}h to finish).`;
  }

  res.json({ ok: true, queued, campaignId: campaign._id, message });
});

// --- Email send worker (processes one at a time on the free plan) ---
// Durable, retryable delivery built on the email_log collection as the outbox:
//   • One email_log row per recipient, keyed by (campaignId, to), written/updated here.
//   • Success → 'sent'. A 5xx/network error → 'pending' (retried by the hourly sweep) up to
//     MAX_SEND_ATTEMPTS, then 'failed'. A permanent 4xx (e.g. bad address) → 'failed' immediately.
//   • Provider rate limits (429 / 420 / 403-probation) → 'pending' WITHOUT burning an attempt,
//     and trip a global cooldown so other jobs hold off instead of hammering a capped account.
//   • Idempotent: an already-'sent' row is skipped, so a re-enqueue never double-sends.
const MAX_SEND_ATTEMPTS = 5;
const COOLDOWN_KEY = 'send_cooldown_until';

// Is this failure a provider rate-limit / throttle we should back off on (vs. a permanent error)?
function isRateLimit(result: any): boolean {
  const code = result.statusCode;
  if (code === 429 || code === 420) return true; // too many requests (Mailgun/Brevo) / "enhance your calm"
  if (code === 403) return /limit|probation|try again|not allowed to send/i.test(result.error || ''); // Mailgun probation
  // Some providers signal throttling/quota in the body with other status codes.
  return /throttl|too many requests|rate exceeded|sending quota|maximum sending rate/i.test(result.error || '');
}

// How long to hold off sends — from the provider's own signal (Retry-After / "enabled in N seconds"), capped at 2h.
function cooldownMsFromError(result: any): number {
  if (result.retryAfter) return Math.min(2 * 3600 * 1000, result.retryAfter * 1000);
  const m = /enabled in (\d+) seconds/i.exec(result.error || '');
  if (m) return Math.min(2 * 3600 * 1000, parseInt(m[1], 10) * 1000);
  return 15 * 60 * 1000; // default cooldown when the provider rate-limits without a clear retry time
}

// Keep/record a recipient as 'pending' (so the sweep retries it) without burning a delivery attempt.
async function upsertPending(conn: any, existing: any, info: { campaignId: any; to: string; subject: string; unsubscribeToken: string; attempts: number }): Promise<void> {
  if (existing) {
    if (existing.status !== 'pending') await conn.updateOne('email_log', existing._id, { $set: { status: 'pending' } });
  } else {
    await conn.insertOne('email_log', {
      campaignId: info.campaignId || null, to: info.to, subject: info.subject, unsubscribeToken: info.unsubscribeToken,
      status: 'pending', attempts: info.attempts, providerId: null, statusCode: null, error: null,
      sentAt: new Date().toISOString(), createdAt: new Date().toISOString(),
    });
  }
}

app.worker('sendEmail', async (req, res) => {
  // Kill-switch: drain the queue without contacting the mail provider. Set SENDING_PAUSED=true
  // to halt all sending (e.g. provider outage / rate-limit block); unset to resume.
  if (process.env.SENDING_PAUSED === 'true') return res.end();
  const payload = req.body.payload || req.body;
  const { campaignId, to, unsubscribeToken } = payload;
  const conn = await Datastore.open();

  // Existing delivery row: present on retries, absent on the first attempt.
  const existing: any = await conn.findOneOrNull('email_log', { campaignId, to });
  if (existing && existing.status === 'sent') return res.end(); // already delivered — idempotent skip
  const attempts = existing ? (existing.attempts || 0) : 0;

  const campaign: any = await conn.findOneOrNull('campaigns', campaignId);
  if (!campaign || campaign.status === 'cancelled') return res.end(); // gone or cancelled — nothing to send

  const settings = await getSettings();
  if (settings.sendingPaused) return res.end(); // UI pause kill-switch (drains queue without sending)

  // Circuit breaker: if the provider recently rate-limited us, hold off (no send attempt) until the
  // cooldown passes. This is what stops a re-drive from hammering a capped / probation account.
  const cooldownUntil = Number((await conn.get(COOLDOWN_KEY, { keyspace: 'ratelimit' })) || 0);
  if (cooldownUntil > Date.now()) {
    await upsertPending(conn, existing, { campaignId, to, subject: campaign.subject, unsubscribeToken, attempts });
    return res.end();
  }

  // Proactive hourly send cap — paces under provider new-sender limits so we never trip a ban.
  // Once this hour's quota is spent, the message stays 'pending' for the next sweep to pick up.
  const maxPerHour = Number(settings.maxPerHour) || 0;
  if (maxPerHour > 0) {
    const hourKey = `sendcount:${Math.floor(Date.now() / 3600000)}`;
    const usedThisHour = await conn.incr(hourKey, 1, { keyspace: 'ratelimit', ttl: 3700000 });
    if (usedThisHour > maxPerHour) {
      await upsertPending(conn, existing, { campaignId, to, subject: campaign.subject, unsubscribeToken, attempts });
      return res.end();
    }
  }

  const base = settings.baseUrl.replace(/\/+$/, '');
  const unsubscribeUrl = `${base}/unsubscribe/${unsubscribeToken}`;
  const html = newsletterEmail({ subject: campaign.subject, body: campaign.body, unsubscribeUrl, settings });
  const result = await sendEmail({ to, subject: campaign.subject, html, unsubscribeUrl, fromEmail: settings.fromEmail, fromName: settings.fromName });

  // Provider rate-limit (429 / 420 / 403-probation) → set a global cooldown from its own "try again"
  // signal and keep this message pending WITHOUT burning an attempt (not the recipient's fault).
  if (!result.ok && isRateLimit(result)) {
    const waitMs = cooldownMsFromError(result);
    await conn.set(COOLDOWN_KEY, String(Date.now() + waitMs), { keyspace: 'ratelimit', ttl: waitMs + 60000 });
    await upsertPending(conn, existing, { campaignId, to, subject: campaign.subject, unsubscribeToken, attempts });
    console.log(`Provider rate-limited — holding sends for ${Math.round(waitMs / 1000)}s; ${to} kept pending`);
    return res.end();
  }

  // Otherwise: success, a non-rate transient (5xx / network) → retry, or a permanent 4xx → fail.
  const code = result.statusCode;
  const transient = !result.ok && (code === undefined || code >= 500);
  const nextAttempts = attempts + 1;
  let status: 'sent' | 'pending' | 'failed';
  if (result.ok) status = 'sent';
  else if (transient && nextAttempts < MAX_SEND_ATTEMPTS) status = 'pending';
  else status = 'failed';

  // Upsert the delivery row (email_log doubles as audit log + retry source).
  const row = {
    campaignId: campaignId || null,
    to,
    subject: campaign.subject,
    unsubscribeToken,
    status,
    attempts: nextAttempts,
    providerId: result.providerId || null,
    statusCode: result.statusCode || null,
    error: result.error || null,
    sentAt: new Date().toISOString(),
  };
  if (existing) {
    await conn.updateOne('email_log', existing._id, { $set: row });
  } else {
    await conn.insertOne('email_log', { ...row, createdAt: new Date().toISOString() });
  }

  // Campaign totals only on terminal outcomes — each reached at most once per recipient.
  if (campaignId && (status === 'sent' || status === 'failed')) {
    try { await conn.updateOne('campaigns', campaignId, { $inc: { [status]: 1 } }); } catch {}
  }

  if (status === 'pending') {
    console.log(`Send to ${to} deferred (status ${code ?? 'network'}); will retry on next sweep, attempt ${nextAttempts}/${MAX_SEND_ATTEMPTS}`);
  } else if (status === 'failed') {
    console.error(`Failed to send to ${to} after ${nextAttempts} attempt(s):`, result.error);
  }

  res.end();
}, { timeout: 30000, workers: 1 }); // serial on free plans; raise workers on paid plans

// --- Hourly retry sweep: re-enqueue deliveries still pending ---
// The initial send is enqueued immediately in POST /send, so this only re-drives
// transient failures. Hourly is the finest cadence the free plan allows; lower it on paid.
app.job('0 * * * *', async (req, res) => {
  if (process.env.SENDING_PAUSED === 'true') { console.log('Retry sweep paused (SENDING_PAUSED)'); return res.end(); }
  const conn = await Datastore.open();
  if ((await getSettings()).sendingPaused) { console.log('Retry sweep paused (sendingPaused setting)'); return res.end(); }
  const query = { status: 'pending', attempts: { $lt: MAX_SEND_ATTEMPTS } };
  // Count what we're about to re-drive directly (enqueueFromQuery's return shape isn't reliable).
  const pending: any[] = await conn.getMany('email_log', query, { limit: 1000 }).toArray();
  await conn.enqueueFromQuery('email_log', query, 'sendEmail', { limit: 1000 });
  console.log(`Retry sweep: re-enqueued ${pending.length} pending email(s)`);
  res.end();
});

// --- POST /admin/api/images (upload as base64 JSON) ---
app.post('/admin/api/images', async (req, res) => {
  try {
    const { filename, data, contentType } = req.body;
    if (!filename || !data || !contentType) {
      return res.status(400).json({ ok: false, error: 'filename, data (base64), and contentType are required' });
    }

    // Only allow image types — files are served publicly from this domain, so an
    // attacker-controlled content-type (e.g. text/html, image/svg+xml) would be a
    // stored-XSS / malicious-hosting vector.
    const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
    if (!ALLOWED_TYPES.includes(contentType)) {
      return res.status(400).json({ ok: false, error: 'Unsupported image type. Allowed: PNG, JPEG, GIF, WEBP.' });
    }

    // Write buffer to filestore via stream
    const buffer = Buffer.from(data, 'base64');
    const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
    if (buffer.length > MAX_BYTES) {
      return res.status(413).json({ ok: false, error: 'Image too large (max 5 MB).' });
    }

    const slug = `${Date.now()}-${filename.toLowerCase().replace(/[^a-z0-9.-]/g, '-')}`;
    const filePath = `/uploads/${slug}`;
    const stream = new PassThrough();
    stream.end(buffer);
    await filestore.saveFile(filePath, stream);

    // Store metadata
    const conn = await Datastore.open();
    const image: any = await conn.insertOne('images', {
      slug,
      filename,
      filePath,
      contentType,
      size: buffer.length,
      createdAt: new Date().toISOString(),
    });

    const settings = await getSettings();
    const base = resolveBaseUrl(req, settings);
    res.json({ ok: true, url: `${base}/images/${slug}`, data: image });
  } catch (err: any) {
    console.error('Image upload error:', err.message);
    res.status(500).json({ ok: false, error: 'Upload failed: ' + err.message });
  }
});

// --- GET /admin/api/images (list with search + pagination) ---
app.get('/admin/api/images', async (req, res) => {
  const conn = await Datastore.open();
  const { search, limit = '12', offset = '0' } = req.query;

  const query: any = {};
  if (search) query.filename = { $regex: search };

  const images = await conn
    .getMany('images', query, {
      limit: parseInt(limit as string),
      offset: parseInt(offset as string),
      sort: { createdAt: -1 },
    })
    .toArray();

  const settings = await getSettings();
  const base = resolveBaseUrl(req, settings);
  const data = images.map((img: any) => ({
    ...img,
    url: `${base}/images/${img.slug}`,
  }));
  res.json({ ok: true, data });
});

// --- DELETE /admin/api/images/:id ---
app.delete('/admin/api/images/:id', async (req, res) => {
  try {
    const conn = await Datastore.open();
    const image: any = await conn.findOneOrNull('images', req.params.id);
    if (image) {
      try { await filestore.deleteFile(image.filePath); } catch {}
      await conn.removeOne('images', req.params.id);
    }
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: 'Delete failed' });
  }
});

// --- Serve uploaded images publicly via app.storage() ---
app.auth('/images/*', (req, res, next) => next());
app.storage({ route: '/images', directory: '/uploads' });

// Serve admin HTML — AFTER all API routes
app.static({ route: '/', directory: '/public', default: 'admin.html' });

export default app.init();
