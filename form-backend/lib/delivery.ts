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
