import { randomBytes } from 'crypto';

const TOKEN_EXPIRY_MS = 48 * 60 * 60 * 1000; // 48 hours

export function generateToken(): string {
  return randomBytes(32).toString('hex');
}

export function generateTokenExpiry(): string {
  return new Date(Date.now() + TOKEN_EXPIRY_MS).toISOString();
}

export function isTokenExpired(expiresAt: string | null | undefined): boolean {
  if (!expiresAt) return true;
  return new Date(expiresAt).getTime() < Date.now();
}
