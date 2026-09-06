import { test } from 'node:test';
import assert from 'node:assert';
import { classify, planRetry } from '#lib/delivery';

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

// --- manual retry (final review, finding 3) ---

test('a failed row may be retried, and its attempt budget is restored', () => {
  const decision = planRetry({ status: 'failed' });
  assert.equal(decision.allowed, true);
  assert.deepEqual(
    decision.patch,
    { status: 'pending', attempts: 0, lastError: null, retryAfter: null }
  );
});

test('a retried failed row is no longer exhausted — classify sends it again', () => {
  // Without the attempts reset, a row that hit MAX_SEND_ATTEMPTS would be marked
  // failed again on its very first re-drive, so the retry button would do nothing.
  const decision = planRetry({ status: 'failed', attempts: MAX } as any);
  assert.equal(decision.allowed, true);
  const after = classify({ ok: false, statusCode: 503 }, decision.patch.attempts, MAX);
  assert.equal(after.status, 'pending');
});

test('a pending row may be retried', () => {
  assert.equal(planRetry({ status: 'pending' }).allowed, true);
});

test('a sent row is refused: retrying would send a duplicate', () => {
  const decision = planRetry({ status: 'sent' });
  assert.equal(decision.allowed, false);
  assert.match(decision.reason, /duplicate/i);
});

test('a skipped row is refused: skipped is terminal', () => {
  const decision = planRetry({ status: 'skipped' });
  assert.equal(decision.allowed, false);
  assert.match(decision.reason, /terminal|nothing to retry/i);
});

// --- missing BASE_URL is transient, not terminal (final review, finding 3) ---

test('a missing BASE_URL reaches classify with no statusCode and stays pending', () => {
  // index.ts now feeds { ok: false, error: 'BASE_URL is not configured' } through
  // classify instead of hard-setting `failed`. Only pending rows are redriven by
  // the hourly job, so hard-failing made the backlog unrecoverable once the
  // operator set the variable.
  const outcome = classify({ ok: false, error: 'BASE_URL is not configured' } as any, 0, MAX);
  assert.equal(outcome.status, 'pending');
  assert.equal(outcome.attempts, 1);
});
