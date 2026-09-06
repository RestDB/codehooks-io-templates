import { test } from 'node:test';
import assert from 'node:assert';
import { classify } from '#lib/delivery';

const MAX = 5;

test('a successful send is sent, attempts incremented', () => {
  const outcome = classify({ ok: true }, 0, MAX);
  assert.deepEqual(outcome, { status: 'sent', attempts: 1 });
});

test('a 5xx is transient: pending, attempts incremented', () => {
  const outcome = classify({ ok: false, statusCode: 503 }, 0, MAX);
  assert.deepEqual(outcome, { status: 'pending', attempts: 1 });
});

test('a network error (no statusCode) is transient: pending, attempts incremented', () => {
  const outcome = classify({ ok: false }, 0, MAX);
  assert.deepEqual(outcome, { status: 'pending', attempts: 1 });
});

test('a thrown provider error (also no statusCode) is transient, NOT permanently failed', () => {
  // A caught synchronous throw (e.g. missing BREVO_API_KEY) reaches classify()
  // exactly like a network error: no statusCode. It must NOT be forced permanent —
  // a fixable misconfiguration has to self-heal through the hourly redrive once the
  // operator sets the env var, rather than discarding every queued notification.
  const outcome = classify({ ok: false }, 0, MAX);
  assert.equal(outcome.status, 'pending');
  assert.notEqual(outcome.status, 'failed');
});

test('400/401/403 are permanent: failed immediately, on the very first attempt', () => {
  for (const statusCode of [400, 401, 403]) {
    const outcome = classify({ ok: false, statusCode }, 0, MAX);
    assert.deepEqual(outcome, { status: 'failed', attempts: 1 }, `statusCode ${statusCode}`);
  }
});

test('429 is pending and does NOT burn an attempt', () => {
  const outcome = classify({ ok: false, statusCode: 429 }, 0, MAX);
  assert.deepEqual(outcome, { status: 'pending', attempts: 0 });
});

test('a 5xx at maxAttempts - 1 prior attempts is failed: exhausted', () => {
  const outcome = classify({ ok: false, statusCode: 503 }, MAX - 1, MAX);
  assert.deepEqual(outcome, { status: 'failed', attempts: MAX });
});

test('a 429 at maxAttempts - 1 prior attempts stays pending: it never burned attempts', () => {
  const outcome = classify({ ok: false, statusCode: 429 }, MAX - 1, MAX);
  assert.deepEqual(outcome, { status: 'pending', attempts: MAX - 1 });
});
