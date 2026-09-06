// Attempt throttling for the admin login.
//
// `/admin/login` is unauthenticated and public on every deployment, so without a
// limit it is an unlimited password oracle. The counter lives in the key-value
// store with a TTL, keyed by client IP, so it costs one read and one write per
// attempt and expires on its own.
//
// The decision logic is pure and lives in `evaluate` so it can be unit tested
// without a datastore; `checkLoginAttempt` is the thin storage wrapper.

export type ThrottleDecision = {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
};

export const MAX_LOGIN_ATTEMPTS = 8;
export const LOGIN_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Decide whether an attempt is allowed, given how many have already been made
 * in the current window. Pure — no I/O.
 */
export function evaluate(
  attemptsSoFar: number,
  max: number = MAX_LOGIN_ATTEMPTS,
  windowMs: number = LOGIN_WINDOW_MS
): ThrottleDecision {
  const used = Number.isFinite(attemptsSoFar) && attemptsSoFar > 0 ? Math.floor(attemptsSoFar) : 0;
  const allowed = used < max;
  return {
    allowed,
    remaining: Math.max(0, max - used - (allowed ? 1 : 0)),
    retryAfterSeconds: allowed ? 0 : Math.ceil(windowMs / 1000),
  };
}

/** Derive a throttle key from the request. Falls back to a shared bucket when no IP is present. */
export function clientKey(req: any): string {
  const raw =
    req?.headers?.['x-forwarded-for'] ||
    req?.headers?.['x-real-ip'] ||
    '';
  const first = String(Array.isArray(raw) ? raw[0] : raw).split(',')[0].trim();
  // An absent IP must not become a free pass: everyone without one shares a bucket.
  return first ? `login:${first}` : 'login:unknown';
}

/**
 * Record an attempt and report whether it may proceed.
 * Counts every attempt, successful or not, so a correct guess cannot reset the window.
 */
export async function checkLoginAttempt(conn: any, req: any): Promise<ThrottleDecision> {
  const key = clientKey(req);
  try {
    const used = Number((await conn.get(key, { keyspace: 'throttle' })) || 0);
    const decision = evaluate(used);
    // Only keep counting while under the cap; once blocked the TTL governs release.
    if (decision.allowed) {
      await conn.set(key, String(used + 1), { keyspace: 'throttle', ttl: LOGIN_WINDOW_MS });
    }
    return decision;
  } catch (err: any) {
    // A throttle-store failure must not lock the owner out of their own admin.
    console.error('Login throttle unavailable, allowing attempt:', err.message);
    return { allowed: true, remaining: MAX_LOGIN_ATTEMPTS, retryAfterSeconds: 0 };
  }
}

/** Clear the counter after a successful login so a legitimate admin is not penalised. */
export async function clearLoginAttempts(conn: any, req: any): Promise<void> {
  try {
    await conn.del(clientKey(req), { keyspace: 'throttle' });
  } catch {
    /* best effort */
  }
}
