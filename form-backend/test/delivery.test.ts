import { test } from 'node:test';
import assert from 'node:assert';
import {
  classify,
  planRetry,
  cooldownSeconds,
  backoffSeconds,
  nextAttemptAt,
  isDue,
  isDeferrable,
  isConfigurationError,
  ConfigurationError,
  RATE_LIMIT_COOLDOWN_SECONDS,
  MAX_COOLDOWN_SECONDS,
  BACKOFF_JITTER_RATIO,
  MAX_DEFERRALS,
  deliveryIdFrom,
} from '#lib/delivery';

const MAX = 5;

// Jitter is injected, so every schedule assertion below is exact rather than
// approximate. NO_JITTER pins the low end of the range, FULL_JITTER the high end.
const NO_JITTER = () => 0;
const FULL_JITTER = () => 1;

test('a successful send is sent, attempts incremented', () => {
  const outcome = classify({ ok: true }, 0, MAX);
  assert.deepEqual(outcome, { status: 'sent', attempts: 1, deferrals: 0 });
});

test('a success clears a deferral history — the row is no longer backing off', () => {
  assert.equal(classify({ ok: true }, 0, MAX, 7).deferrals, 0);
});

test('a 5xx is transient: pending, attempts incremented', () => {
  const outcome = classify({ ok: false, statusCode: 503 }, 0, MAX);
  assert.deepEqual(outcome, { status: 'pending', attempts: 1, deferrals: 0 });
});

test('a network error (no statusCode) is transient: pending, attempts incremented', () => {
  const outcome = classify({ ok: false }, 0, MAX);
  assert.deepEqual(outcome, { status: 'pending', attempts: 1, deferrals: 0 });
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
    assert.deepEqual(outcome, { status: 'failed', attempts: 1, deferrals: 0 }, `statusCode ${statusCode}`);
  }
});

test('429 is pending and does NOT burn an attempt', () => {
  const outcome = classify({ ok: false, statusCode: 429 }, 0, MAX);
  assert.deepEqual(outcome, { status: 'pending', attempts: 0, deferrals: 1 });
});

test('a 5xx at maxAttempts - 1 prior attempts is failed: exhausted', () => {
  const outcome = classify({ ok: false, statusCode: 503 }, MAX - 1, MAX);
  assert.deepEqual(outcome, { status: 'failed', attempts: MAX, deferrals: 0 });
});

test('a 429 at maxAttempts - 1 prior attempts stays pending: it never burned attempts', () => {
  const outcome = classify({ ok: false, statusCode: 429 }, MAX - 1, MAX);
  assert.deepEqual(outcome, { status: 'pending', attempts: MAX - 1, deferrals: 1 });
});

// --- manual retry (final review, finding 3) ---

test('a failed row may be retried, and its attempt budget is restored', () => {
  const decision = planRetry({ status: 'failed' });
  assert.equal(decision.allowed, true);
  assert.deepEqual(
    decision.patch,
    {
      status: 'pending', attempts: 0, deferrals: 0,
      lastError: null, retryAfter: null, nextAttemptAt: null,
    }
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

// --- what an operator may re-drive (fix-wave review, findings 4 and 9) ---

test('a DUE pending row is refused: retrying races the worker into a duplicate', () => {
  // A pending row that is due is either inside a worker right now or about to be
  // picked up by the next redrive. Re-queueing it sends the recipient two
  // identical notifications, to skip a wait the row would have left on its own.
  const decision = planRetry({ status: 'pending', nextAttemptAt: null } as any, NOW);
  assert.equal(decision.allowed, false);
  assert.match(decision.reason, /already queued|two copies/i);
});

test('a DEFERRED pending row MAY be retried: that is the recovery path', () => {
  // The opposite case, and the one this button exists for: the row is parked
  // behind a backoff deadline (a 429, or a BASE_URL the operator has just set),
  // no worker holds it, and skipping the wait is exactly the intent.
  const decision = planRetry(
    { status: 'pending', nextAttemptAt: '2026-09-06T18:00:00.000Z' } as any, NOW
  );
  assert.equal(decision.allowed, true);
  assert.equal(decision.patch.nextAttemptAt, null);
  assert.equal(decision.patch.deferrals, 0);
});

test('a row addressed to an unusable recipient is refused, and says what to fix', () => {
  // The row still carries the address that was rejected, and nothing rewrites it
  // when the form's settings are corrected. Retrying re-sends to the same bad
  // address, gets the same 4xx, and overwrites the one useful thing the row had —
  // "Not a valid email address: team.customer.example" — with a generic provider
  // message. So it cannot succeed AND it destroys the diagnostic.
  const decision = planRetry({
    status: 'failed', channel: 'email', target: 'team.customer.example',
    lastError: 'Not a valid email address: team.customer.example',
  } as any, NOW);
  assert.equal(decision.allowed, false);
  assert.match(decision.reason, /team\.customer\.example/);
  assert.match(decision.reason, /notification settings/i);
});

test('a failed row addressed to a VALID recipient is still retryable', () => {
  // The refusal above must not swallow the ordinary case it shares a branch with:
  // an unverified sender, a rotated key, a provider outage.
  const decision = planRetry({
    status: 'failed', channel: 'email', target: 'team@customer.example',
    lastError: 'Brevo responded 500',
  } as any, NOW);
  assert.equal(decision.allowed, true);
});

test('the unusable-target refusal is scoped to the email channel', () => {
  // A future channel's target is not an email address; refusing every one of them
  // would be a silent regression the day a second channel lands.
  const decision = planRetry({
    status: 'failed', channel: 'webhook', target: 'https://example.com/hook',
  } as any, NOW);
  assert.equal(decision.allowed, true);
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

test('a missing BASE_URL stays pending WITHOUT burning an attempt', () => {
  // Routing it through classify() made it transient, but it still spent an attempt
  // per redrive: at MAX_SEND_ATTEMPTS=5 and an hourly job the row was terminally
  // `failed` about four hours after the submission. Deploy on Friday without
  // BASE_URL, set it on Monday, and the entire weekend was already unrecoverable.
  // A configuration error is not a delivery attempt.
  const outcome = classify(
    { ok: false, error: 'BASE_URL is not configured', configError: true } as any, 0, MAX
  );
  assert.deepEqual(outcome, { status: 'pending', attempts: 0, deferrals: 1 });
});

test('a weekend of missing BASE_URL still leaves every row recoverable', () => {
  // Five redrives used to be terminal. Walk the same row through the redrives an
  // unattended weekend would actually deliver and assert it is still pending.
  let attempts = 0;
  let deferrals = 0;
  const cfgError = { ok: false, error: 'BASE_URL is not configured', configError: true } as any;
  for (let i = 0; i < MAX_DEFERRALS - 1; i++) {
    const out = classify(cfgError, attempts, MAX, deferrals);
    attempts = out.attempts;
    deferrals = out.deferrals;
    assert.equal(out.status, 'pending', `redrive ${i + 1}`);
  }
  assert.equal(attempts, 0, 'no attempt was ever spent on a configuration error');
});

test('a configuration error is nonetheless bounded: MAX_DEFERRALS is terminal', () => {
  // "Does not burn an attempt" must not mean "cycles forever".
  const cfgError = { ok: false, error: 'BASE_URL is not configured', configError: true } as any;
  const out = classify(cfgError, 0, MAX, MAX_DEFERRALS - 1);
  assert.equal(out.status, 'failed');
  assert.equal(out.deferrals, MAX_DEFERRALS);
});

test('a persistently rate-limiting provider also terminates', () => {
  const out = classify({ ok: false, statusCode: 429 }, 0, MAX, MAX_DEFERRALS - 1);
  assert.equal(out.status, 'failed');
});

test('an UNEXPECTED throw is not a configuration error — it still burns attempts', () => {
  // The worker flags only ConfigurationError. A genuine bug must stay bounded by
  // MAX_SEND_ATTEMPTS rather than becoming an indefinitely deferred row.
  const outcome = classify({ ok: false, error: 'x is not a function' } as any, 0, MAX);
  assert.equal(outcome.attempts, 1);
  assert.equal(outcome.deferrals, 0);
});

test('isDeferrable separates "never tried" from "tried and failed"', () => {
  assert.equal(isDeferrable({ ok: false, statusCode: 429 }), true);
  assert.equal(isDeferrable({ ok: false, configError: true }), true);
  assert.equal(isDeferrable({ ok: false, statusCode: 503 }), false);
  assert.equal(isDeferrable({ ok: false }), false);
  assert.equal(isDeferrable({ ok: true }), false);
  assert.equal(isDeferrable(null), false);
});

test('ConfigurationError is recognisable across the module boundary', () => {
  // The worker cannot use `instanceof` safely across bundling, so the flag is the
  // contract. If this breaks, a missing provider key silently starts burning
  // attempts again.
  assert.equal(isConfigurationError(new ConfigurationError('no key')), true);
  assert.equal(isConfigurationError(new Error('socket hang up')), false);
  assert.equal(isConfigurationError(null), false);
});

// --- 429 backoff (final review, finding 5) ---
//
// classify() already keeps a 429 pending without burning an attempt. Because
// attempts never increment, `attempts: {$lt: MAX}` never excludes such a row, so
// before this the hourly redrive re-fired every rate-limited row at once, every
// hour, indefinitely — ignoring the Retry-After the provider asked for.

const NOW = new Date('2026-09-06T12:00:00.000Z');

test('a 429 with a Retry-After header produces exactly that wait on the first deferral', () => {
  // 120s exceeds nothing here — the schedule's own first step is 15 minutes — so
  // the schedule wins. See the next test for the case the header wins.
  assert.equal(
    cooldownSeconds({ ok: false, statusCode: 429, retryAfter: 120 }, 0, NO_JITTER),
    RATE_LIMIT_COOLDOWN_SECONDS
  );
});

test("a provider's Retry-After WINS whenever it is longer than our own schedule", () => {
  const asked = 3 * 60 * 60; // 3h, longer than the first step and the second
  assert.equal(cooldownSeconds({ ok: false, statusCode: 429, retryAfter: asked }, 0, NO_JITTER), asked);
  assert.equal(
    nextAttemptAt({ ok: false, statusCode: 429, retryAfter: asked }, NOW, 0, NO_JITTER),
    '2026-09-06T15:00:00.000Z'
  );
});

test("a provider's Retry-After never SHORTENS a row that has been deferred repeatedly", () => {
  // 60s from the provider must not undo four hours of accumulated backoff.
  const deferrals = 4; // scheduled wait is 15m * 2^4 = 4h
  assert.equal(
    cooldownSeconds({ ok: false, statusCode: 429, retryAfter: 60 }, deferrals, NO_JITTER),
    4 * 60 * 60
  );
});

// --- the schedule itself (fix-wave review, finding 1) ---
//
// The flat 15-minute deadline that preceded this was INERT: the redrive job runs
// hourly, so a 15-minute deadline had always elapsed by the time the job looked,
// and 500 rate-limited rows re-fired together every hour exactly as before —
// while the README claimed the backlog "backs off instead of re-firing in full
// every hour". These assertions are what make that sentence true.

const HOUR = 3600;

test('the wait DOUBLES with each deferral of the same row', () => {
  assert.equal(backoffSeconds(0), 15 * 60);
  assert.equal(backoffSeconds(1), 30 * 60);
  assert.equal(backoffSeconds(2), 1 * HOUR);
  assert.equal(backoffSeconds(3), 2 * HOUR);
  assert.equal(backoffSeconds(4), 4 * HOUR);
  assert.equal(backoffSeconds(5), 8 * HOUR);
  assert.equal(backoffSeconds(6), 16 * HOUR);
});

test('the hourly redrive genuinely steps OVER a repeatedly-deferred row', () => {
  // The finding in one assertion. With a flat 15-minute wait every one of these
  // is due at the next hourly redrive, so the stampede repeats unchanged. The
  // schedule has to exceed the job interval for the job to skip the row at all.
  const REDRIVE_INTERVAL = HOUR;
  assert.ok(backoffSeconds(0) < REDRIVE_INTERVAL, 'the first deferral is deliberately short');
  assert.ok(backoffSeconds(3) > REDRIVE_INTERVAL, 'by the fourth the job skips the row');
  assert.ok(backoffSeconds(6) > 4 * REDRIVE_INTERVAL, 'and keeps skipping it for longer');
});

test('the doubling is capped rather than running away', () => {
  assert.equal(backoffSeconds(20), MAX_COOLDOWN_SECONDS);
  assert.equal(backoffSeconds(9999), MAX_COOLDOWN_SECONDS);
  assert.ok(Number.isFinite(backoffSeconds(Number.MAX_SAFE_INTEGER)));
});

test('a corrupt stored deferral count degrades to the first step, never to NaN', () => {
  for (const bad of [undefined, null, NaN, -3, 'seven']) {
    assert.equal(backoffSeconds(bad as any), RATE_LIMIT_COOLDOWN_SECONDS, String(bad));
  }
});

test('jitter de-synchronises a backlog instead of letting it come due as one herd', () => {
  // Rows rate-limited in the same second must not all come due in the same second.
  const lo = cooldownSeconds({ ok: false, statusCode: 429 }, 3, NO_JITTER);
  const hi = cooldownSeconds({ ok: false, statusCode: 429 }, 3, FULL_JITTER);
  assert.equal(lo, 2 * HOUR);
  assert.equal(hi, Math.ceil(2 * HOUR * (1 + BACKOFF_JITTER_RATIO)));
  assert.ok(hi - lo >= 30 * 60, 'the spread is wide enough to matter at this scale');
});

test('jitter only ever LENGTHENS the wait', () => {
  // Shortening could undercut a Retry-After the provider explicitly asked for.
  const scheduled = backoffSeconds(2);
  for (const roll of [0, 0.1, 0.5, 0.9, 1]) {
    assert.ok(cooldownSeconds({ ok: false, statusCode: 429 }, 2, () => roll) >= scheduled);
  }
});

test('jitter still spreads rows that have all reached the ceiling', () => {
  // Clamping AFTER jitter would collapse every capped row back onto one instant,
  // which is the thundering herd the cap was supposed to be protecting against.
  const lo = cooldownSeconds({ ok: false, statusCode: 429 }, 40, NO_JITTER);
  const hi = cooldownSeconds({ ok: false, statusCode: 429 }, 40, FULL_JITTER);
  assert.equal(lo, MAX_COOLDOWN_SECONDS);
  assert.ok(hi > lo);
});

test('a hostile Retry-After is clamped before jitter, not honoured', () => {
  assert.equal(
    cooldownSeconds({ ok: false, statusCode: 429, retryAfter: 99999999 }, 0, NO_JITTER),
    MAX_COOLDOWN_SECONDS
  );
});

test('a negative or zero Retry-After falls back to the schedule', () => {
  assert.equal(
    cooldownSeconds({ ok: false, statusCode: 429, retryAfter: 0 }, 0, NO_JITTER),
    RATE_LIMIT_COOLDOWN_SECONDS
  );
  assert.equal(
    cooldownSeconds({ ok: false, statusCode: 429, retryAfter: -5 }, 0, NO_JITTER),
    RATE_LIMIT_COOLDOWN_SECONDS
  );
});

test('a configuration error backs off on the same schedule as a 429', () => {
  // Otherwise a missing BASE_URL is re-attempted hourly for five days.
  const cfg = { ok: false, configError: true } as any;
  assert.equal(cooldownSeconds(cfg, 0, NO_JITTER), RATE_LIMIT_COOLDOWN_SECONDS);
  assert.equal(cooldownSeconds(cfg, 4, NO_JITTER), 4 * HOUR);
});

test('a success sets no cooldown', () => {
  assert.equal(cooldownSeconds({ ok: true }, 0, NO_JITTER), 0);
  assert.equal(nextAttemptAt({ ok: true }, NOW, 0, NO_JITTER), null);
});

test('an ordinary transient failure sets no cooldown — it retries at the next redrive', () => {
  assert.equal(cooldownSeconds({ ok: false, statusCode: 503 }, 0, NO_JITTER), 0);
  assert.equal(nextAttemptAt({ ok: false }, NOW, 0, NO_JITTER), null);
});

test('a permanent 4xx sets no cooldown', () => {
  assert.equal(cooldownSeconds({ ok: false, statusCode: 400 }, 0, NO_JITTER), 0);
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
  assert.deepEqual(outcome, { status: 'pending', attempts: 3, deferrals: 1 });
  // 300s from the provider is shorter than the schedule's own first step, so the
  // schedule wins: still not due 301s later, and due once the 15 minutes are up.
  const deadline = nextAttemptAt({ ok: false, statusCode: 429, retryAfter: 300 }, NOW, 0, NO_JITTER);
  assert.equal(isDue({ nextAttemptAt: deadline }, NOW), false);
  assert.equal(isDue({ nextAttemptAt: deadline }, new Date(NOW.getTime() + 301_000)), false);
  assert.equal(
    isDue({ nextAttemptAt: deadline }, new Date(NOW.getTime() + (RATE_LIMIT_COOLDOWN_SECONDS + 1) * 1000)),
    true
  );
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
