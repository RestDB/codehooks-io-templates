import jwt from 'jsonwebtoken';

// Per-FILE download tokens for links in notification emails. The admin download
// route requires a session cookie, which an email cannot carry.
//
// A token grants exactly one file. It expires, so a leaked email exposes those
// files until exp rather than forever, and it is signature-verified, so it cannot
// be edited to point at another file or submission.
//
// `typ` separates these from admin session tokens, which are signed with the SAME
// secret. Without it a file token replays as a session cookie and vice versa —
// the signature alone proves only that WE minted the token, never what it is for.

const DEFAULT_TTL_DAYS = 7;

function secret(): string {
  return process.env.JWT_SECRET || '';
}

export function signFileToken(
  submissionId: string,
  fileId: string,
  ttlDays: number = DEFAULT_TTL_DAYS
): string {
  return jwt.sign({ sid: submissionId, fid: fileId, typ: 'file' }, secret(), {
    expiresIn: `${ttlDays}d`,
    algorithm: 'HS256',
  });
}

export function verifyFileToken(token: string): { sid: string; fid: string } | null {
  try {
    const claims: any = jwt.verify(String(token || ''), secret(), { algorithms: ['HS256'] });
    if (!claims || claims.typ !== 'file') return null;
    if (typeof claims.sid !== 'string' || typeof claims.fid !== 'string') return null;
    if (!claims.sid || !claims.fid) return null;
    return { sid: claims.sid, fid: claims.fid };
  } catch {
    // Expired, tampered, wrong secret, malformed, or no secret configured.
    return null;
  }
}
