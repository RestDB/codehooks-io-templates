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
    patch: { status: 'pending', attempts: 0, lastError: null, retryAfter: null },
  };
}
