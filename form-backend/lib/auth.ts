import * as jwt from 'jsonwebtoken';
import { createHash, timingSafeEqual } from 'crypto';

function secret(): string {
  return process.env.JWT_SECRET || '';
}

export function parseCookies(header: string): Record<string, string> {
  const out: Record<string, string> = {};
  (header || '').split(';').forEach((c) => {
    const [key, ...rest] = c.trim().split('=');
    if (key) out[key] = rest.join('=');
  });
  return out;
}

export function signToken(): string {
  return jwt.sign({ role: 'admin' }, secret(), { expiresIn: '7d' });
}

export function verifyRequest(req: any): boolean {
  try {
    const token = parseCookies(req.headers?.cookie || '').token;
    if (!token) return false;
    jwt.verify(token, secret());
    return true;
  } catch {
    return false;
  }
}

// Hash both sides to a fixed length so timingSafeEqual never throws on
// mismatched buffer lengths, which would itself leak length information.
export function passwordMatches(candidate: string): boolean {
  const expected = process.env.ADMIN_PASSWORD || '';
  if (!expected) return false;
  const a = createHash('sha256').update(String(candidate || '')).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}
