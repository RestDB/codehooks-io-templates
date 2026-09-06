// Security-sensitive decision logic for the public submit endpoint, split out
// of index.ts (which is route registration only) so it can be unit tested.

export function originOf(req: any): string {
  const raw = req.headers?.origin || req.headers?.referer || '';
  try {
    return raw ? new URL(raw).hostname : '';
  } catch {
    return '';
  }
}

export function corsHeaders(form: any, req: any): Record<string, string> {
  const list: string[] = form.allowedDomains || [];
  const origin = req.headers?.origin;
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
  if (list.length === 0) {
    headers['Access-Control-Allow-Origin'] = '*';
  } else if (origin && list.includes(originOf(req))) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Vary'] = 'Origin';
  }
  return headers;
}

// Only same-origin-ish redirects are honoured — an open redirect would let an
// attacker use the form endpoint as a link launderer. Resolving against a
// placeholder base (rather than string-prefix checks like `startsWith('/')`)
// is required because browsers resolve `//evil.com` and `/\evil.com` to a
// DIFFERENT HOST relative to the current page — a naive "starts with /" check
// would treat those as safe relative paths when they are not.
export function safeRedirect(form: any, requested: string): string | null {
  if (!requested) return null;
  if (!form.allowRedirectOverride) return null;

  let resolved: URL;
  try {
    resolved = new URL(requested, 'https://placeholder.invalid');
  } catch {
    return null;
  }

  // Same-site path: hostname stayed the placeholder, so nothing escaped.
  if (resolved.hostname === 'placeholder.invalid') {
    return resolved.pathname + resolved.search + resolved.hash;
  }

  if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') return null;
  const list: string[] = form.allowedDomains || [];
  return list.includes(resolved.hostname) ? resolved.toString() : null;
}

// Uploads are attacker-supplied, so filenames are never used as storage paths.
export function safeName(name: string): string {
  const cleaned = String(name || 'file')
    .toLowerCase()
    .replace(/[^a-z0-9.-]/g, '-')
    // Collapse runs of 2+ dots so no ".." traversal token can survive even
    // when every individual character is otherwise in the allowed set.
    .replace(/\.{2,}/g, '-')
    .slice(0, 80);
  return cleaned || 'file';
}
