import { test } from 'node:test';
import assert from 'node:assert';
import {
  evaluate,
  clientKey,
  checkLoginAttempt,
  clearLoginAttempts,
  MAX_LOGIN_ATTEMPTS,
} from '#lib/throttle';

// --- evaluate (pure) ------------------------------------------------

test('evaluate allows the first attempt', () => {
  const d = evaluate(0);
  assert.equal(d.allowed, true);
  assert.equal(d.remaining, MAX_LOGIN_ATTEMPTS - 1);
  assert.equal(d.retryAfterSeconds, 0);
});

test('evaluate allows attempts right up to the cap', () => {
  assert.equal(evaluate(MAX_LOGIN_ATTEMPTS - 1).allowed, true);
});

test('evaluate blocks at the cap and reports a retry delay', () => {
  const d = evaluate(MAX_LOGIN_ATTEMPTS);
  assert.equal(d.allowed, false);
  assert.equal(d.remaining, 0);
  assert.ok(d.retryAfterSeconds > 0);
});

test('evaluate stays blocked beyond the cap', () => {
  assert.equal(evaluate(MAX_LOGIN_ATTEMPTS + 50).allowed, false);
});

test('evaluate treats a corrupt stored count as zero rather than as a free pass', () => {
  // A NaN or negative count must not read as "under the limit forever" in a way
  // that also breaks the countdown.
  assert.equal(evaluate(NaN as any).allowed, true);
  assert.equal(evaluate(-5).allowed, true);
  assert.equal(evaluate(NaN as any).remaining, MAX_LOGIN_ATTEMPTS - 1);
});

// --- clientKey ------------------------------------------------------

test('clientKey uses the first x-forwarded-for hop', () => {
  const k = clientKey({ headers: { 'x-forwarded-for': '203.0.113.7, 70.41.3.18' } });
  assert.equal(k, 'login:203.0.113.7');
});

test('clientKey falls back to x-real-ip', () => {
  assert.equal(clientKey({ headers: { 'x-real-ip': '198.51.100.4' } }), 'login:198.51.100.4');
});

test('a missing IP shares one bucket rather than bypassing the limit', () => {
  assert.equal(clientKey({ headers: {} }), 'login:unknown');
  assert.equal(clientKey({}), 'login:unknown');
});

test('clientKey separates distinct clients', () => {
  const a = clientKey({ headers: { 'x-forwarded-for': '203.0.113.1' } });
  const b = clientKey({ headers: { 'x-forwarded-for': '203.0.113.2' } });
  assert.notEqual(a, b);
});

// --- checkLoginAttempt (with a fake store) --------------------------

function fakeConn() {
  const store = new Map<string, string>();
  return {
    store,
    async get(k: string) { return store.get(k); },
    async set(k: string, v: string) { store.set(k, v); },
    async del(k: string) { store.delete(k); },
  };
}

test('repeated attempts from one IP are eventually blocked', async () => {
  const conn = fakeConn();
  const req = { headers: { 'x-forwarded-for': '203.0.113.9' } };
  for (let i = 0; i < MAX_LOGIN_ATTEMPTS; i++) {
    assert.equal((await checkLoginAttempt(conn, req)).allowed, true, `attempt ${i + 1} should pass`);
  }
  const blocked = await checkLoginAttempt(conn, req);
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterSeconds > 0);
});

test('one blocked IP does not block a different IP', async () => {
  const conn = fakeConn();
  const attacker = { headers: { 'x-forwarded-for': '203.0.113.9' } };
  const admin = { headers: { 'x-forwarded-for': '198.51.100.1' } };
  for (let i = 0; i < MAX_LOGIN_ATTEMPTS + 3; i++) await checkLoginAttempt(conn, attacker);
  assert.equal((await checkLoginAttempt(conn, admin)).allowed, true);
});

test('a successful login clears the counter', async () => {
  const conn = fakeConn();
  const req = { headers: { 'x-forwarded-for': '203.0.113.11' } };
  for (let i = 0; i < 5; i++) await checkLoginAttempt(conn, req);
  await clearLoginAttempts(conn, req);
  const after = await checkLoginAttempt(conn, req);
  assert.equal(after.remaining, MAX_LOGIN_ATTEMPTS - 1);
});

test('a failing throttle store allows the attempt rather than locking the owner out', async () => {
  const broken = {
    async get() { throw new Error('kv down'); },
    async set() { throw new Error('kv down'); },
    async del() { throw new Error('kv down'); },
  };
  const d = await checkLoginAttempt(broken, { headers: {} });
  assert.equal(d.allowed, true);
});
