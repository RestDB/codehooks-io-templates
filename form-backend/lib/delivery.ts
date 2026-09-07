import { RECIPIENT_RE } from '#lib/recipients';

export type DeliveryOutcome = {
  status: 'sent' | 'pending' | 'failed';
  attempts: number;
  /**
   * How many times this row has been DEFERRED — parked without a real send
   * attempt because the provider asked us to slow down (429) or because the
   * deployment is misconfigured. Kept separately from `attempts` on purpose:
   * `attempts` is a budget for "we tried and it did not work", and a deferral is
   * "we never tried". It also drives the exponential backoff, which `attempts`
   * cannot, precisely because a deferral does not move `attempts`.
   */
  deferrals: number;
};

/**
 * A deployment misconfiguration, as opposed to a provider or network failure.
 * Thrown by the provider factory so the `deliver` worker can tell "nobody could
 * ever have sent this until a human changes an env var" apart from "the send was
 * attempted and failed". The two must not share an attempt budget: a
 * configuration error is not a delivery attempt.
 */
export class ConfigurationError extends Error {
  readonly isConfigurationError = true;
  constructor(message: string) {
    super(message);
    this.name = 'ConfigurationError';
  }
}

export function isConfigurationError(err: unknown): boolean {
  return !!(err && (err as any).isConfigurationError === true);
}

/**
 * Results that must NOT consume the attempt budget, because no send was really
 * attempted:
 *
 *   - `429` — the provider explicitly asked us to come back later.
 *   - a configuration error — a missing BASE_URL or provider key. Burning an
 *     attempt here is what made a weekend without BASE_URL unrecoverable: five
 *     hourly redrives and every row was terminally `failed` about four hours in,
 *     long before anyone read the diagnostics panel on Monday.
 *
 * Both are bounded by MAX_DEFERRALS instead, so neither can park a row forever.
 */
export function isDeferrable(result: { ok?: boolean; statusCode?: number; configError?: boolean } | null | undefined): boolean {
  if (!result || result.ok) return false;
  return result.statusCode === 429 || result.configError === true;
}

/**
 * Decide a delivery row's next state. Pure, so the branch matrix is testable without
 * a datastore, a provider, or a deploy.
 *
 * - `ok: true` always sends, and clears the deferral count.
 * - A DEFERRABLE result (429, or a configuration error) does NOT burn an attempt
 *   and is never permanent — until MAX_DEFERRALS, which stops a permanently
 *   rate-limited or permanently misconfigured row cycling forever.
 * - A status in 4xx (other than 429) is a permanent rejection — retrying an
 *   invalid recipient or a bad request cannot succeed.
 * - Anything else with no numeric status — a network error, or an unexpected
 *   throw from the channel — is TRANSIENT and burns an attempt, so a genuine bug
 *   still terminates once the budget runs out.
 */
export function classify(
  result: { ok: boolean; statusCode?: number; configError?: boolean },
  priorAttempts: number,
  maxAttempts: number,
  priorDeferrals: number = 0
): DeliveryOutcome {
  const deferrals = Number.isFinite(priorDeferrals) && priorDeferrals > 0 ? Math.floor(priorDeferrals) : 0;

  if (result.ok) {
    return { status: 'sent', attempts: priorAttempts + 1, deferrals: 0 };
  }

  if (isDeferrable(result)) {
    const next = deferrals + 1;
    // The one thing that stops "keeps the row alive until the operator fixes it"
    // from meaning "forever". See MAX_DEFERRALS for the horizon this buys.
    return { status: next >= MAX_DEFERRALS ? 'failed' : 'pending', attempts: priorAttempts, deferrals: next };
  }

  const status = result.statusCode;
  const attempts = priorAttempts + 1;
  const permanent = typeof status === 'number' && status >= 400 && status < 500;
  const exhausted = attempts >= maxAttempts;

  return { status: permanent || exhausted ? 'failed' : 'pending', attempts, deferrals };
}

export type RetryPatch = {
  status: 'pending';
  attempts: number;
  deferrals: number;
  lastError: null;
  retryAfter: null;
  nextAttemptAt: null;
};

// A flat shape rather than a discriminated union: this project's tsconfig has
// `strictNullChecks` off, under which TypeScript does not narrow a union on a
// boolean literal discriminant, so `if (!d.allowed) d.reason` fails to compile.
export type RetryDecision = {
  allowed: boolean;
  /** Set only when `allowed` is false. */
  reason?: string;
  /** Set only when `allowed` is true. */
  patch?: RetryPatch;
};

/**
 * Decide whether an operator may re-drive one delivery row, and what to reset.
 * Pure, so the refusal matrix is testable without a datastore.
 *
 * `attempts` is reset to 0 on purpose. The attempt budget exists to bound
 * AUTOMATIC retries of an unchanged condition; an operator pressing retry has
 * just changed something (set BASE_URL, rotated a key, fixed a recipient), so
 * the row deserves the full budget again. Without the reset a `failed` row that
 * had already exhausted its attempts would re-fail on the first try — see
 * `classify`, where `attempts >= maxAttempts` is terminal.
 *
 * `sent` is refused because re-driving it would send a second email: the
 * `deliver` worker's own `status === 'sent'` guard is the only thing stopping a
 * duplicate, and flipping the row back to `pending` would remove it.
 * `skipped` is refused because the spec defines it as terminal — the channel had
 * nothing to do, and retrying cannot change that.
 */
export function planRetry(
  row: { status?: string; channel?: string; target?: string; nextAttemptAt?: string | null } | null | undefined,
  now: Date = new Date()
): RetryDecision {
  const status = row?.status;
  if (status === 'sent') {
    return { allowed: false, reason: 'This delivery already succeeded; retrying would send a duplicate.' };
  }
  if (status === 'skipped') {
    return { allowed: false, reason: 'This delivery was skipped and is terminal; there is nothing to retry.' };
  }

  // A row whose TARGET is the problem cannot be rescued by re-sending it. The row
  // still carries the address that was rejected, and nothing rewrites it when the
  // form's settings are corrected — so a retry re-sends to the same bad address,
  // gets the same 4xx, and overwrites `lastError` ("Not a valid email address:
  // team.customer.example") with the provider's generic wording. That destroys the
  // one thing that made the row useful. Refuse, and name the actual fix.
  if (row?.channel === 'email' && row?.target && !RECIPIENT_RE.test(String(row.target).trim())) {
    return {
      allowed: false,
      reason:
        `This delivery targets an address no provider will accept (${String(row.target).trim().slice(0, 120)}). ` +
        'Retrying would send to the same address and overwrite the reason recorded here. ' +
        'Correct the recipient in this form\'s notification settings — later submissions will use the new address.',
    };
  }

  // A `pending` row that is DUE is either in a worker right now or about to be
  // picked up by the next redrive; re-queueing it races that worker into two
  // identical emails, for no gain the row would not have got by itself.
  //
  // A `pending` row that is NOT due is the opposite case, and is exactly the
  // recovery path this button exists for: it is parked behind a backoff deadline
  // (a 429, or a missing BASE_URL the operator has just set), no worker holds it,
  // and skipping the remaining wait is precisely what the operator wants.
  if (status === 'pending' && isDue(row, now)) {
    return {
      allowed: false,
      reason:
        'This delivery is already queued and will be attempted automatically; ' +
        'retrying now could send two copies of the same notification.',
    };
  }

  return {
    allowed: true,
    patch: {
      status: 'pending', attempts: 0, deferrals: 0,
      lastError: null, retryAfter: null, nextAttemptAt: null,
    },
  };
}


// --- Deferral backoff --------------------------------------------------------
//
// `classify` keeps a deferrable row (a 429, or a configuration error) `pending`
// without burning an attempt, and the row records what the provider asked for.
// Nothing used to read it: the hourly redrive re-fired every such row at once,
// every hour, forever, so a provider that started rate-limiting turned the outbox
// into an amplifier that never drained and never terminated.
//
// The FIRST fix for that stamped a flat 15-minute deadline on the row. That was
// inert in the default case, and the README and CHANGELOG claimed more than it
// did: the redrive runs HOURLY, so a 15-minute deadline has always elapsed by the
// time the next redrive looks, and 500 rate-limited rows still fired together at
// 13:00, again at 14:00, again at 15:00. A deadline shorter than the job interval
// changes nothing at all.
//
// So the wait GROWS. Each successive deferral of the same row doubles it from
// RATE_LIMIT_COOLDOWN_SECONDS up to MAX_COOLDOWN_SECONDS: 15m, 30m, 1h, 2h, 4h,
// 8h, 16h, 24h. From the third deferral on it is longer than the redrive
// interval, so the job genuinely steps over the row instead of re-firing it, and
// the attempt rate of a stuck backlog decays geometrically rather than staying
// flat at once-an-hour forever.
//
// Growth alone would still leave a backlog SYNCHRONISED — 500 rows deferred in
// the same minute come due in the same minute, which is the thundering herd in
// slower clothing — so each wait is stretched by an independent random factor.
// Jitter only ever LENGTHENS the wait: shortening it could undercut a
// `Retry-After` the provider explicitly asked for.
//
// The wait is held PER ROW rather than as a global cooldown. Both were on the
// table; per-row wins because the deadline already lives in the document that
// gates the send, so there is no second store to read, no keyspace to keep in
// sync, and no new outage mode — a global cooldown key that cannot be read leaves
// you choosing between blocking every send and silently not backing off at all.

/** The FIRST deferral's wait. Each further deferral of the same row doubles it. */
export const RATE_LIMIT_COOLDOWN_SECONDS = 15 * 60;

/**
 * Ceiling on the doubling, and on a hostile or fat-fingered `Retry-After`.
 * Applied BEFORE jitter, so jitter can still de-synchronise rows that have all
 * reached the ceiling — clamping after jitter would collapse them back onto the
 * same instant, which is the whole problem.
 */
export const MAX_COOLDOWN_SECONDS = 24 * 60 * 60;

/** Each wait is stretched by up to this fraction, independently per row. */
export const BACKOFF_JITTER_RATIO = 0.25;

/**
 * How many times one row may be deferred before it is given up on.
 *
 * A deferral costs no attempt, which is the point — a configuration error is not
 * a delivery attempt, and neither is a rate limit. But "does not burn an attempt"
 * must not mean "cycles forever": with the doubling schedule above, 12 deferrals
 * span roughly five days (15m+30m+1h+2h+4h+8h+16h+24h+4x24h), which comfortably
 * covers the case this exists for — deploy on Friday without BASE_URL, notice on
 * Monday — and then stops.
 */
export const MAX_DEFERRALS = 12;

export type BackoffInput = {
  ok: boolean;
  statusCode?: number;
  retryAfter?: number;
  configError?: boolean;
};

/**
 * The un-jittered wait for a row that has already been deferred `priorDeferrals`
 * times. Pure and separate from `cooldownSeconds` so the SCHEDULE itself can be
 * asserted exactly, without a random source in the way.
 */
export function backoffSeconds(priorDeferrals: number): number {
  const n = Number.isFinite(priorDeferrals) && priorDeferrals > 0 ? Math.floor(priorDeferrals) : 0;
  // 2 ** 40 is already far past the cap; bounding the exponent keeps a corrupt
  // stored value from producing Infinity here.
  const doubled = RATE_LIMIT_COOLDOWN_SECONDS * Math.pow(2, Math.min(n, 40));
  return Math.min(doubled, MAX_COOLDOWN_SECONDS);
}

/**
 * How long this result asks us to wait before trying the same row again. Pure;
 * `random` is injected so the jitter is assertable.
 *
 * A provider-supplied `Retry-After` still wins whenever it is LONGER than our own
 * schedule — the provider knows something we do not — but never shortens the
 * backoff of a row that has already been deferred repeatedly.
 */
export function cooldownSeconds(
  result: BackoffInput,
  priorDeferrals: number = 0,
  random: () => number = Math.random
): number {
  if (!isDeferrable(result)) return 0;

  const scheduled = backoffSeconds(priorDeferrals);
  const asked = Number(result.retryAfter);
  const base = Number.isFinite(asked) && asked > 0 ? Math.max(Math.ceil(asked), scheduled) : scheduled;

  const capped = Math.min(base, MAX_COOLDOWN_SECONDS);
  const roll = Number(random());
  const spread = Number.isFinite(roll) ? Math.min(Math.max(roll, 0), 1) : 0;
  return Math.ceil(capped * (1 + BACKOFF_JITTER_RATIO * spread));
}

/**
 * The absolute instant this row may next be attempted, or null for "now".
 * Absolute rather than a duration because the row is read back by a different
 * process at an unknown later time — a stored "120 seconds" answers nothing.
 * ISO-8601 so it sorts and compares in the datastore query as it does here.
 */
export function nextAttemptAt(
  result: BackoffInput,
  now: Date = new Date(),
  priorDeferrals: number = 0,
  random: () => number = Math.random
): string | null {
  const seconds = cooldownSeconds(result, priorDeferrals, random);
  return seconds > 0 ? new Date(now.getTime() + seconds * 1000).toISOString() : null;
}

/**
 * May this row be attempted yet? A row that is not due is left completely
 * untouched by the worker — it stays `pending`, keeps its attempt count, and is
 * picked up again by a later redrive.
 *
 * An absent or unparseable deadline means due NOW: a bad value must never strand
 * a notification forever, which is the failure mode this whole finding is about.
 */
export function isDue(row: { nextAttemptAt?: string | null } | null | undefined, now: Date = new Date()): boolean {
  const at = row?.nextAttemptAt;
  if (!at) return true;
  const due = Date.parse(at);
  if (!Number.isFinite(due)) return true;
  return due <= now.getTime();
}


/**
 * Which delivery row a `deliver` message refers to.
 *
 * The worker is fed from TWO places that put DIFFERENT things in the payload, and
 * this was silently broken until it was watched live:
 *
 *   - `conn.enqueue('deliver', { deliveryId })` — the immediate send. Payload is
 *     the wrapper object.
 *   - `conn.enqueueFromQuery('deliveries', query, 'deliver')` — the hourly redrive.
 *     Per codehooks-js, this puts each matched DOCUMENT in `body.payload`, so
 *     there is no `deliveryId` key at all; the id is the document's own `_id`.
 *
 * Reading only `payload.deliveryId` therefore yielded `undefined` for every
 * redriven row. Observed consequence in the logs: the worker went on to load a
 * row anyway, re-sent it, and then failed its status write three times with
 * `NOT_FOUND` — so the redrive re-sent the same notification every hour and could
 * never record that it had. Returning null here makes the worker stop instead.
 */
export function deliveryIdFrom(payload: any): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const id = payload.deliveryId ?? payload._id;
  return typeof id === 'string' && id ? id : null;
}
