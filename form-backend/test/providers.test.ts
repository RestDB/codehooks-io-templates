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

function capture(status = 200, body: any = { messageId: 'abc' }) {
  const calls: any[] = [];
  const fakeFetch = async (url: string, init: any) => {
    calls.push({ url, init });
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: () => null },
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

test('mailgun sends multipart including the attachment bytes', async () => {
  const { calls, fakeFetch } = capture();
  await makeMailgun('key', 'mg.example.com', false, fakeFetch).send(msg);
  const form = calls[0].init.body;
  assert.ok(typeof form.getAll === 'function', 'expected FormData');
  assert.equal(form.get('subject'), 'New submission: Contact');
  assert.equal(form.get('h:Reply-To'), 'ada@example.com');
  assert.equal(form.getAll('attachment').length, 1);
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
