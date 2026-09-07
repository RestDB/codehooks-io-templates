import { test } from 'node:test';
import assert from 'node:assert';
import {
  isHoneypotFilled,
  controlFieldsFor,
  submitKey,
  checkSubmitRate,
  SUBMIT_RATE_DEFAULT,
  checkHoneypotName,
} from '#lib/spam';

// --- honeypot ---

test('an empty honeypot is a human', () => {
  assert.equal(isHoneypotFilled({ _gotcha: '' }, '_gotcha'), false);
});

test('an absent honeypot is a human', () => {
  assert.equal(isHoneypotFilled({ name: 'Ada' }, '_gotcha'), false);
});

test('a whitespace-only honeypot is a human, not a bot', () => {
  // A stray space from an autofill must not discard a real submission.
  assert.equal(isHoneypotFilled({ _gotcha: '   ' }, '_gotcha'), false);
});

test('a filled honeypot is a bot', () => {
  assert.equal(isHoneypotFilled({ _gotcha: 'http://spam' }, '_gotcha'), true);
});

test('the honeypot name is configurable', () => {
  assert.equal(isHoneypotFilled({ website: 'x' }, 'website'), true);
  assert.equal(isHoneypotFilled({ website: 'x' }, '_gotcha'), false);
});

test('an unset honeypot name never flags anything', () => {
  assert.equal(isHoneypotFilled({ _gotcha: 'x' }, ''), false);
});

// --- control fields ---

test('control fields include the form-specific honeypot name', () => {
  const fields = controlFieldsFor('website');
  assert.ok(fields.includes('website'));
  assert.ok(fields.includes('_redirect'));
});

test('control fields do not duplicate when the honeypot is a standard name', () => {
  const fields = controlFieldsFor('_gotcha');
  assert.equal(fields.filter((f) => f === '_gotcha').length, 1);
});

// --- rate limit ---

test('submitKey separates forms so one busy form cannot throttle another', () => {
  const req = { headers: { 'x-forwarded-for': '203.0.113.5' } };
  assert.notEqual(submitKey('form-a', req), submitKey('form-b', req));
});

test('submitKey separates clients', () => {
  const a = submitKey('form-a', { headers: { 'x-forwarded-for': '203.0.113.5' } });
  const b = submitKey('form-a', { headers: { 'x-forwarded-for': '203.0.113.6' } });
  assert.notEqual(a, b);
});

function fakeConn() {
  const store = new Map<string, string>();
  return {
    async get(k: string) { return store.get(k); },
    async set(k: string, v: string) { store.set(k, v); },
    async del(k: string) { store.delete(k); },
  };
}

test('submissions are allowed up to the limit then refused', async () => {
  const conn = fakeConn();
  const req = { headers: { 'x-forwarded-for': '203.0.113.7' } };
  for (let i = 0; i < 3; i++) {
    assert.equal((await checkSubmitRate(conn, 'f1', req, 3)).allowed, true);
  }
  const blocked = await checkSubmitRate(conn, 'f1', req, 3);
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterSeconds > 0);
});

test('a throttle-store failure ALLOWS the submission', async () => {
  // A key-value outage must never take a customer's contact form offline.
  const broken = {
    async get() { throw new Error('kv down'); },
    async set() { throw new Error('kv down'); },
    async del() { throw new Error('kv down'); },
  };
  const d = await checkSubmitRate(broken, 'f1', { headers: {} }, 3);
  assert.equal(d.allowed, true);
});

test('the default limit is exported and positive', () => {
  assert.ok(SUBMIT_RATE_DEFAULT > 0);
});

// --- honeypot name collisions (final review, finding 12) ---

test('a honeypot that collides with a real field name is rejected', () => {
  // Setting it to `email` makes isHoneypotFilled() true for every genuine
  // submission: all of them stored as spam, the email value stripped, no
  // notification ever sent, and a 200 returned throughout.
  const check = checkHoneypotName('email', [{ name: 'name' }, { name: 'email' }]);
  assert.equal(check.ok, false);
  assert.match(check.error as string, /email/);
  assert.match(check.error as string, /spam/i);
});

test('the collision is real: the colliding name would flag a genuine submission', () => {
  assert.equal(isHoneypotFilled({ email: 'ada@example.com' }, 'email'), true);
});

test('a honeypot that matches no field is accepted', () => {
  assert.equal(checkHoneypotName('_gotcha', [{ name: 'name' }, { name: 'email' }]).ok, true);
});

test('a honeypot colliding with a control field the endpoint interprets is rejected', () => {
  for (const name of ['_redirect', '_subject', '_next']) {
    const check = checkHoneypotName(name, []);
    assert.equal(check.ok, false, name);
  }
});

test('an empty or absent honeypot is valid — the check is simply off', () => {
  assert.equal(checkHoneypotName('', [{ name: 'email' }]).ok, true);
  assert.equal(checkHoneypotName(undefined, [{ name: 'email' }]).ok, true);
  assert.equal(checkHoneypotName(null, [{ name: 'email' }]).ok, true);
  assert.equal(checkHoneypotName('   ', [{ name: 'email' }]).ok, true);
});

test('a non-string honeypot is rejected', () => {
  assert.equal(checkHoneypotName(42 as any, []).ok, false);
});

test('a form with no fields accepts any honeypot name', () => {
  assert.equal(checkHoneypotName('anything', []).ok, true);
  assert.equal(checkHoneypotName('anything', null).ok, true);
});
