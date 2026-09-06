import { test } from 'node:test';
import assert from 'node:assert';
import { pickReplyTo, renderSubject, buildNotification } from '#lib/notify';
import type { FileRef } from '#lib/attachments';

const f = (id: string, size: number): FileRef => ({
  id, filename: `${id}.pdf`, contentType: 'application/pdf', size, path: `/uploads/${id}`,
});

// --- Reply-To selection ---

test('prefers a field whose schema type is email', () => {
  const got = pickReplyTo(
    { contact: 'ada@example.com', other: 'zz@example.com' },
    [{ name: 'other', type: 'text' }, { name: 'contact', type: 'email' }]
  );
  assert.equal(got, 'ada@example.com');
});

test('falls back to the first value that looks like an email when no schema says so', () => {
  const got = pickReplyTo({ name: 'Ada', whatever: 'ada@example.com' }, []);
  assert.equal(got, 'ada@example.com');
});

test('returns null when nothing resembles an email', () => {
  assert.equal(pickReplyTo({ name: 'Ada', note: 'hello' }, []), null);
});

test('ignores an email-typed field that is empty', () => {
  const got = pickReplyTo({ contact: '' }, [{ name: 'contact', type: 'email' }]);
  assert.equal(got, null);
});

// --- subject ---

test('renders the form name into the subject', () => {
  assert.equal(renderSubject('New submission: {{form}}', 'Contact', {}), 'New submission: Contact');
});

test('renders a submitted field into the subject', () => {
  assert.equal(renderSubject('From {{name}}', 'Contact', { name: 'Ada' }), 'From Ada');
});

test('an unknown placeholder renders empty rather than leaving braces', () => {
  assert.equal(renderSubject('X {{nope}} Y', 'Contact', {}), 'X  Y');
});

test('an empty template falls back to a usable subject', () => {
  assert.equal(renderSubject('', 'Contact', {}), 'New submission: Contact');
});

// --- body ---

const base = {
  formName: 'Contact',
  subjectTemplate: 'New submission: {{form}}',
  fields: { name: 'Ada', email: 'ada@example.com' },
  fieldDefs: [{ name: 'email', type: 'email' }],
  meta: { created: '2026-09-06T10:00:00.000Z', ip: '203.0.113.5', referer: 'https://example.com' },
  plan: { attach: [], tooLarge: [] },
  submissionId: 'sub-1',
  baseUrl: 'https://api.example.com',
};

test('the body lists every submitted field', () => {
  const out = buildNotification(base);
  assert.match(out.text, /name:\s*Ada/);
  assert.match(out.text, /email:\s*ada@example\.com/);
});

test('the body carries submission metadata', () => {
  const out = buildNotification(base);
  assert.match(out.text, /203\.0\.113\.5/);
  assert.match(out.text, /example\.com/);
});

test('attached files are listed', () => {
  process.env.JWT_SECRET = 'test-secret';
  const out = buildNotification({ ...base, plan: { attach: [f('cv', 100)], tooLarge: [] } });
  assert.match(out.text, /cv\.pdf/);
  assert.match(out.text, /attached/i);
});

test('files too large to attach are named, not silently omitted', () => {
  process.env.JWT_SECRET = 'test-secret';
  const out = buildNotification({ ...base, plan: { attach: [], tooLarge: [f('huge', 99999999)] } });
  assert.match(out.text, /huge\.pdf/);
  assert.match(out.text, /too large/i);
});

test('every file gets a download link regardless of whether it attached', () => {
  process.env.JWT_SECRET = 'test-secret';
  const out = buildNotification({
    ...base,
    plan: { attach: [f('a', 10)], tooLarge: [f('b', 99999999)] },
  });
  const links = out.text.match(/https:\/\/api\.example\.com\/files\//g) || [];
  assert.equal(links.length, 2);
});

test('Reply-To is surfaced on the result', () => {
  const out = buildNotification(base);
  assert.equal(out.replyTo, 'ada@example.com');
});
