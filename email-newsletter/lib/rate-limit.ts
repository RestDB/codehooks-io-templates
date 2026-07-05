import { Datastore } from 'codehooks-js';

const IP_LIMIT = 5;
const IP_WINDOW_MS = 60 * 1000; // 1 minute
const EMAIL_RESEND_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const LOGIN_LIMIT = 10;                    // admin login attempts per window per IP
const LOGIN_WINDOW_MS = 10 * 60 * 1000;    // 10 minutes

export async function checkIpRateLimit(ip: string): Promise<boolean> {
  const conn = await Datastore.open();
  const key = `ratelimit:ip:${ip}`;
  const count = await conn.incr(key, 1, { keyspace: 'ratelimit', ttl: IP_WINDOW_MS });
  return count <= IP_LIMIT;
}

// Throttles admin login attempts per IP to prevent brute-forcing ADMIN_PASSWORD.
export async function checkLoginRateLimit(ip: string): Promise<boolean> {
  const conn = await Datastore.open();
  const key = `ratelimit:login:${ip}`;
  const count = await conn.incr(key, 1, { keyspace: 'ratelimit', ttl: LOGIN_WINDOW_MS });
  return count <= LOGIN_LIMIT;
}

export async function checkEmailResendLimit(email: string, list: string): Promise<boolean> {
  const conn = await Datastore.open();
  const key = `ratelimit:email:${email}::${list}`;
  const existing = await conn.get(key, { keyspace: 'ratelimit' });
  if (existing) return false;
  await conn.set(key, '1', { keyspace: 'ratelimit', ttl: EMAIL_RESEND_WINDOW_MS });
  return true;
}
