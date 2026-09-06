import jwt from 'jsonwebtoken';
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
  return jwt.sign({ role: 'admin', typ: 'session' }, secret(), {
    expiresIn: '7d',
    algorithm: 'HS256',
  });
}

// A valid SIGNATURE is not a valid SESSION. File-download tokens are signed with
// the same JWT_SECRET, so verifying the signature alone let anyone who received a
// notification email replay its /files/<token> value as `Cookie: token=...` and
// reach the whole admin API, DELETE included. The claim check is what separates
// the two token types; `algorithms` is pinned so a token cannot arrive claiming
// `alg: none`.
export function verifyRequest(req: any): boolean {
  try {
    const token = parseCookies(req.headers?.cookie || '').token;
    if (!token) return false;
    const claims: any = jwt.verify(token, secret(), { algorithms: ['HS256'] });
    return !!claims && claims.role === 'admin' && claims.typ === 'session';
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
