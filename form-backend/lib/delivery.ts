export type DeliveryOutcome = { status: 'sent' | 'pending' | 'failed'; attempts: number };

/**
 * Decide a delivery row's next state. Pure, so the branch matrix is testable without
 * a datastore, a provider, or a deploy.
 *
 * - `ok: true` always sends.
 * - A 429 is the provider asking to slow down, not refusing the message: it does
 *   NOT burn an attempt, and is never permanent.
 * - A status in 4xx (other than 429) is a permanent rejection — retrying an
 *   invalid recipient or a bad request cannot succeed.
 * - Anything else with no numeric status — a network error, OR a provider
 *   throwing synchronously on missing/invalid credentials (a misconfiguration
 *   that is deliberately not caught inside the provider layer) — is TRANSIENT.
 *   A fixable misconfiguration must self-heal through the hourly redrive once
 *   the operator sets the missing env var, rather than being discarded forever;
 *   a genuinely permanent one still terminates once attempts are exhausted.
 */
export function classify(
  result: { ok: boolean; statusCode?: number },
  priorAttempts: number,
  maxAttempts: number
): DeliveryOutcome {
  if (result.ok) {
    return { status: 'sent', attempts: priorAttempts + 1 };
  }

  const status = result.statusCode;
  const rateLimited = status === 429;
  const attempts = rateLimited ? priorAttempts : priorAttempts + 1;
  const permanent = typeof status === 'number' && status >= 400 && status < 500 && status !== 429;
  const exhausted = !rateLimited && attempts >= maxAttempts;

  return { status: permanent || exhausted ? 'failed' : 'pending', attempts };
}

export type RetryPatch = {
  status: 'pending';
  attempts: number;
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
export function planRetry(row: { status?: string } | null | undefined): RetryDecision {
  const status = row?.status;
  if (status === 'sent') {
    return { allowed: false, reason: 'This delivery already succeeded; retrying would send a duplicate.' };
  }
  if (status === 'skipped') {
    return { allowed: false, reason: 'This delivery was skipped and is terminal; there is nothing to retry.' };
  }
  return {
    allowed: true,
    patch: { status: 'pending', attempts: 0, lastError: null, retryAfter: null, nextAttemptAt: null },
  };
}


// --- Rate-limit backoff -------------------------------------------------------
//
// `classify` keeps a 429 row `pending` without burning an attempt, and the row
// records the `Retry-After` the provider asked for. Nothing used to read it: the
// hourly redrive re-fired every such row at once, every hour, forever, so a
// provider that started rate-limiting turned the outbox into an amplifier that
// never drained and never terminated.
//
// The wait is held PER ROW rather than as a global cooldown. Both were on the
// table; per-row wins because the deadline already lives in the document that
// gates the send, so there is no second store to read, no keyspace to keep in
// sync, and no new outage mode — a global cooldown key that cannot be read leaves
// you choosing between blocking every send and silently not backing off at all.
// Rows that were rate-limited together do come due together, which is exactly
// what the provider's Retry-After asked for.

/** Applied to a 429 that carries no usable Retry-After header. */
export const RATE_LIMIT_COOLDOWN_SECONDS = 15 * 60;

/** A hostile or fat-fingered Retry-After must not park a row past any useful horizon. */
export const MAX_COOLDOWN_SECONDS = 24 * 60 * 60;

export type BackoffInput = { ok: boolean; statusCode?: number; retryAfter?: number };

/** How long this result asks us to wait before trying the same row again. Pure. */
export function cooldownSeconds(result: BackoffInput): number {
  if (!result || result.ok) return 0;
  if (result.statusCode !== 429) return 0;
  const asked = Number(result.retryAfter);
  const seconds = Number.isFinite(asked) && asked > 0 ? asked : RATE_LIMIT_COOLDOWN_SECONDS;
  return Math.min(Math.ceil(seconds), MAX_COOLDOWN_SECONDS);
}

/**
 * The absolute instant this row may next be attempted, or null for "now".
 * Absolute rather than a duration because the row is read back by a different
 * process at an unknown later time — a stored "120 seconds" answers nothing.
 * ISO-8601 so it sorts and compares in the datastore query as it does here.
 */
export function nextAttemptAt(result: BackoffInput, now: Date = new Date()): string | null {
  const seconds = cooldownSeconds(result);
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
