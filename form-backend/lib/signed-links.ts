import jwt from 'jsonwebtoken';

// Per-FILE download tokens for links in notification emails. The admin download
// route requires a session cookie, which an email cannot carry.
//
// A token grants exactly one file. It expires, so a leaked email exposes those
// files until exp rather than forever, and it is signature-verified, so it cannot
// be edited to point at another file or submission.

const DEFAULT_TTL_DAYS = 7;

function secret(): string {
  return process.env.JWT_SECRET || '';
}

export function signFileToken(
  submissionId: string,
  fileId: string,
  ttlDays: number = DEFAULT_TTL_DAYS
): string {
  return jwt.sign({ sid: submissionId, fid: fileId }, secret(), {
    expiresIn: `${ttlDays}d`,
  });
}

export function verifyFileToken(token: string): { sid: string; fid: string } | null {
  try {
    const claims: any = jwt.verify(String(token || ''), secret());
    if (!claims || typeof claims.sid !== 'string' || typeof claims.fid !== 'string') return null;
    return { sid: claims.sid, fid: claims.fid };
  } catch {
    // Expired, tampered, wrong secret, malformed, or no secret configured.
    return null;
  }
}
