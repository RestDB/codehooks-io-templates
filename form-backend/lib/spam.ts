import { evaluate, clientKey } from '#lib/throttle';

// Fields the submit endpoint interprets itself and never stores.
const BASE_CONTROL_FIELDS = ['_redirect', '_subject', '_next'];

export const SUBMIT_RATE_DEFAULT = 30;
export const SUBMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour

/**
 * A filled honeypot means a bot. Whitespace does NOT count: a stray space from an
 * autofill must never discard a real person's submission.
 */
export function isHoneypotFilled(
  fields: Record<string, string>,
  honeypotName: string
): boolean {
  if (!honeypotName) return false;
  const raw = fields?.[honeypotName];
  return typeof raw === 'string' && raw.trim() !== '';
}

/**
 * Control fields for a given form, including its configured honeypot name.
 * Replaces the hardcoded `_gotcha` so a form can rename its trap — a fixed,
 * well-known name is fingerprintable by bots that know to skip it.
 */
export function controlFieldsFor(honeypotName: string): string[] {
  const fields = [...BASE_CONTROL_FIELDS];
  if (honeypotName && !fields.includes(honeypotName)) fields.push(honeypotName);
  return fields;
}

/** Rate-limit key: per form AND per client, so one busy form cannot throttle another. */
export function submitKey(formId: string, req: any): string {
  return `submit:${formId}:${clientKey(req)}`;
}

export async function checkSubmitRate(
  conn: any,
  formId: string,
  req: any,
  max: number = SUBMIT_RATE_DEFAULT
): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  const key = submitKey(formId, req);
  try {
    const used = Number((await conn.get(key, { keyspace: 'throttle' })) || 0);
    const decision = evaluate(used, max, SUBMIT_WINDOW_MS);
    if (decision.allowed) {
      await conn.set(key, String(used + 1), { keyspace: 'throttle', ttl: SUBMIT_WINDOW_MS });
    }
    return { allowed: decision.allowed, retryAfterSeconds: decision.retryAfterSeconds };
  } catch (err: any) {
    // A key-value outage must not take a customer's contact form offline.
    console.error('Submit throttle unavailable, allowing submission:', err.message);
    return { allowed: true, retryAfterSeconds: 0 };
  }
}
