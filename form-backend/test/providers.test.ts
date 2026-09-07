import { test } from 'node:test';
import assert from 'node:assert';
import { makeBrevo } from '#lib/providers/brevo';
import { makeMailgun } from '#lib/providers/mailgun';

const msg = {
  to: 'owner@example.com',
  subject: 'New submission: Contact',
  text: 'name: Ada',
  fromEmail: 'forms@example.com',
  fromName: 'Forms',
  replyTo: 'ada@example.com',
  attachments: [
    { filename: 'cv.pdf', contentType: 'application/pdf', content: Buffer.from('PDFBYTES') },
  ],
};

function capture(status = 200, body: any = { messageId: 'abc' }, headers: Record<string, string> = {}) {
  const calls: any[] = [];
  const fakeFetch = async (url: string, init: any) => {
    calls.push({ url, init });
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
      json: async () => body,
      text: async () => JSON.stringify(body),
    } as any;
  };
  return { calls, fakeFetch };
}

// --- Brevo ---

test('brevo sends attachments as base64 with a name', async () => {
  const { calls, fakeFetch } = capture();
  await makeBrevo('key', fakeFetch).send(msg);
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.attachment[0].name, 'cv.pdf');
  assert.equal(Buffer.from(body.attachment[0].content, 'base64').toString(), 'PDFBYTES');
});

test('brevo sets replyTo', async () => {
  const { calls, fakeFetch } = capture();
  await makeBrevo('key', fakeFetch).send(msg);
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.replyTo.email, 'ada@example.com');
});

test('brevo omits the attachment key entirely when there are none', async () => {
  const { calls, fakeFetch } = capture();
  await makeBrevo('key', fakeFetch).send({ ...msg, attachments: [] });
  const body = JSON.parse(calls[0].init.body);
  assert.equal('attachment' in body, false);
});

test('brevo reports a 4xx as a permanent failure', async () => {
  const { fakeFetch } = capture(400, { message: 'bad' });
  const r = await makeBrevo('key', fakeFetch).send(msg);
  assert.equal(r.ok, false);
  assert.equal(r.statusCode, 400);
});

// --- Mailgun ---

test('mailgun attaches the file with its name and bytes intact', async () => {
  const { calls, fakeFetch } = capture();
  await makeMailgun('key', 'mg.example.com', false, fakeFetch).send(msg);
  const form = calls[0].init.body;
  assert.ok(typeof form.getAll === 'function', 'expected FormData');
  assert.equal(form.get('subject'), 'New submission: Contact');
  assert.equal(form.get('h:Reply-To'), 'ada@example.com');
  const parts = form.getAll('attachment');
  assert.equal(parts.length, 1);
  const file = parts[0] as any;
  assert.equal(file.name, 'cv.pdf', 'filename must survive');
  assert.equal(await file.text(), 'PDFBYTES', 'bytes must survive');
});

test('mailgun reports a 5xx as retryable', async () => {
  const { fakeFetch } = capture(503, { message: 'oops' });
  const r = await makeMailgun('key', 'mg.example.com', false, fakeFetch).send(msg);
  assert.equal(r.ok, false);
  assert.equal(r.statusCode, 503);
});

test('both providers succeed on 200', async () => {
  const a = capture(); const b = capture();
  assert.equal((await makeBrevo('k', a.fakeFetch).send(msg)).ok, true);
  assert.equal((await makeMailgun('k', 'd', false, b.fakeFetch).send(msg)).ok, true);
});

// --- retryAfter ---

test('retryAfter is parsed from a numeric Retry-After header', async () => {
  const { fakeFetch } = capture(429, { message: 'slow down' }, { 'retry-after': '30' });
  const r = await makeBrevo('key', fakeFetch).send(msg);
  assert.equal(r.retryAfter, 30);
});

test('retryAfter is undefined — never NaN — when the header is absent or unparseable', async () => {
  const absent = capture(429, { message: 'x' });
  assert.equal((await makeBrevo('k', absent.fakeFetch).send(msg)).retryAfter, undefined);

  const junk = capture(429, { message: 'x' }, { 'retry-after': 'later' });
  const r = await makeBrevo('k', junk.fakeFetch).send(msg);
  assert.equal(r.retryAfter, undefined, 'NaN would corrupt a backoff calculation');
});

test('a response whose headers object has no get() does not throw', async () => {
  const calls: any[] = [];
  const noHeaders = async (url: string, init: any) => {
    calls.push({ url, init });
    return { ok: false, status: 500, json: async () => ({}), text: async () => '' } as any;
  };
  const r = await makeBrevo('k', noHeaders).send(msg);
  assert.equal(r.ok, false);
  assert.equal(r.retryAfter, undefined);
});

// --- Provider selection and configuration ---

test('unknown EMAIL_PROVIDER throws', async () => {
  const saved = process.env.EMAIL_PROVIDER;
  try {
    process.env.EMAIL_PROVIDER = 'mailgunn';
    // Need to import fresh to get the updated env, so we test by calling the private selected() indirectly
    // We'll use sendEmail which calls selected() internally
    const sendEmail = (await import('#lib/providers/index')).sendEmail;
    assert.rejects(async () => sendEmail(msg), /Unknown EMAIL_PROVIDER "mailgunn"/);
  } finally {
    if (saved === undefined) delete process.env.EMAIL_PROVIDER;
    else process.env.EMAIL_PROVIDER = saved;
  }
});

test('missing MAILGUN_API_KEY throws', async () => {
  const savedProvider = process.env.EMAIL_PROVIDER;
  const savedKey = process.env.MAILGUN_API_KEY;
  const savedDomain = process.env.MAILGUN_DOMAIN;
  try {
    process.env.EMAIL_PROVIDER = 'mailgun';
    delete process.env.MAILGUN_API_KEY;
    process.env.MAILGUN_DOMAIN = 'example.com';
    const sendEmail = (await import('#lib/providers/index')).sendEmail;
    assert.rejects(async () => sendEmail(msg), /requires MAILGUN_API_KEY/);
  } finally {
    if (savedProvider === undefined) delete process.env.EMAIL_PROVIDER;
    else process.env.EMAIL_PROVIDER = savedProvider;
    if (savedKey === undefined) delete process.env.MAILGUN_API_KEY;
    else process.env.MAILGUN_API_KEY = savedKey;
    if (savedDomain === undefined) delete process.env.MAILGUN_DOMAIN;
    else process.env.MAILGUN_DOMAIN = savedDomain;
  }
});

test('missing BREVO_API_KEY throws', async () => {
  const savedProvider = process.env.EMAIL_PROVIDER;
  const savedKey = process.env.BREVO_API_KEY;
  try {
    process.env.EMAIL_PROVIDER = 'brevo';
    delete process.env.BREVO_API_KEY;
    const sendEmail = (await import('#lib/providers/index')).sendEmail;
    assert.rejects(async () => sendEmail(msg), /requires BREVO_API_KEY/);
  } finally {
    if (savedProvider === undefined) delete process.env.EMAIL_PROVIDER;
    else process.env.EMAIL_PROVIDER = savedProvider;
    if (savedKey === undefined) delete process.env.BREVO_API_KEY;
    else process.env.BREVO_API_KEY = savedKey;
  }
});

