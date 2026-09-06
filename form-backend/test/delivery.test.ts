import { test } from 'node:test';
import assert from 'node:assert';
import {
  classify,
  planRetry,
  cooldownSeconds,
  nextAttemptAt,
  isDue,
  RATE_LIMIT_COOLDOWN_SECONDS,
  MAX_COOLDOWN_SECONDS,
  deliveryIdFrom,
} from '#lib/delivery';

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
    { status: 'pending', attempts: 0, lastError: null, retryAfter: null, nextAttemptAt: null }
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

// --- 429 backoff (final review, finding 5) ---
//
// classify() already keeps a 429 pending without burning an attempt. Because
// attempts never increment, `attempts: {$lt: MAX}` never excludes such a row, so
// before this the hourly redrive re-fired every rate-limited row at once, every
// hour, indefinitely — ignoring the Retry-After the provider asked for.

const NOW = new Date('2026-09-06T12:00:00.000Z');

test('a 429 with a Retry-After header produces exactly that wait', () => {
  assert.equal(cooldownSeconds({ ok: false, statusCode: 429, retryAfter: 120 }), 120);
  assert.equal(
    nextAttemptAt({ ok: false, statusCode: 429, retryAfter: 120 }, NOW),
    '2026-09-06T12:02:00.000Z'
  );
});

test('a 429 with no Retry-After still backs off, rather than re-firing immediately', () => {
  assert.equal(cooldownSeconds({ ok: false, statusCode: 429 }), RATE_LIMIT_COOLDOWN_SECONDS);
  assert.notEqual(nextAttemptAt({ ok: false, statusCode: 429 }, NOW), null);
});

test('an absurd Retry-After is clamped rather than parking the row forever', () => {
  assert.equal(
    cooldownSeconds({ ok: false, statusCode: 429, retryAfter: 99999999 }),
    MAX_COOLDOWN_SECONDS
  );
});

test('a negative or zero Retry-After falls back to the default cooldown', () => {
  assert.equal(cooldownSeconds({ ok: false, statusCode: 429, retryAfter: 0 }), RATE_LIMIT_COOLDOWN_SECONDS);
  assert.equal(cooldownSeconds({ ok: false, statusCode: 429, retryAfter: -5 }), RATE_LIMIT_COOLDOWN_SECONDS);
});

test('a success sets no cooldown', () => {
  assert.equal(cooldownSeconds({ ok: true }), 0);
  assert.equal(nextAttemptAt({ ok: true }, NOW), null);
});

test('an ordinary transient failure sets no cooldown — it retries at the next redrive', () => {
  assert.equal(cooldownSeconds({ ok: false, statusCode: 503 }), 0);
  assert.equal(nextAttemptAt({ ok: false }, NOW), null);
});

test('a permanent 4xx sets no cooldown', () => {
  assert.equal(cooldownSeconds({ ok: false, statusCode: 400 }), 0);
});

test('a row inside its cooldown is NOT due', () => {
  assert.equal(isDue({ nextAttemptAt: '2026-09-06T12:05:00.000Z' }, NOW), false);
});

test('a row whose cooldown has elapsed is due', () => {
  assert.equal(isDue({ nextAttemptAt: '2026-09-06T11:59:59.000Z' }, NOW), true);
});

test('a row due at exactly now is due', () => {
  assert.equal(isDue({ nextAttemptAt: NOW.toISOString() }, NOW), true);
});

test('a row with no deadline is due — including one written before the field existed', () => {
  assert.equal(isDue({ nextAttemptAt: null }, NOW), true);
  assert.equal(isDue({}, NOW), true);
  assert.equal(isDue(null, NOW), true);
});

test('an unparseable deadline means due now, never stranded forever', () => {
  assert.equal(isDue({ nextAttemptAt: 'not a date' }, NOW), true);
});

test('the 429 loop terminates: the row is not re-attempted until its deadline', () => {
  // The whole failure in one assertion. A 429 leaves attempts untouched, so the
  // redrive's attempts filter can never exclude the row; only the deadline can.
  const outcome = classify({ ok: false, statusCode: 429 }, 3, MAX);
  assert.deepEqual(outcome, { status: 'pending', attempts: 3 });
  const deadline = nextAttemptAt({ ok: false, statusCode: 429, retryAfter: 300 }, NOW);
  assert.equal(isDue({ nextAttemptAt: deadline }, NOW), false);
  assert.equal(isDue({ nextAttemptAt: deadline }, new Date(NOW.getTime() + 301_000)), true);
});

test('an operator retry clears the cooldown', () => {
  const decision = planRetry({ status: 'pending', nextAttemptAt: '2099-01-01T00:00:00.000Z' } as any);
  assert.equal(decision.allowed, true);
  assert.equal(decision.patch.nextAttemptAt, null);
  assert.equal(isDue(decision.patch, NOW), true);
});

// --- which row a `deliver` message refers to ---
//
// Found live, not by reading: the hourly redrive uses enqueueFromQuery, which puts
// the matched DOCUMENT in body.payload — there is no `deliveryId` key. Destructuring
// `{ deliveryId }` yielded undefined for every redriven row, and the logs showed the
// worker re-sending and then failing its status write with NOT_FOUND, every hour.

test('the immediate enqueue shape carries deliveryId', () => {
  assert.equal(deliveryIdFrom({ deliveryId: 'abc123' }), 'abc123');
});

test('the enqueueFromQuery shape carries the document, so the id is _id', () => {
  const row = { _id: 'row-1', status: 'pending', target: 'a@b.com', attempts: 1 };
  assert.equal(deliveryIdFrom(row), 'row-1');
});

test('deliveryId wins when both are somehow present', () => {
  assert.equal(deliveryIdFrom({ deliveryId: 'wrapper', _id: 'doc' }), 'wrapper');
});

test('an unusable payload yields null so the worker stops instead of loading a random row', () => {
  for (const payload of [null, undefined, {}, 'string', 42, { deliveryId: '' }, { _id: 123 }]) {
    assert.equal(deliveryIdFrom(payload as any), null, JSON.stringify(payload));
  }
});
