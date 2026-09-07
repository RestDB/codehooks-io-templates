// Pure display logic for the admin dashboard. No DOM, no fetch, no imports —
// so `node --test` can cover it directly, the way lib/* modules already are.
// Every function here is total: junk input returns something renderable rather
// than throwing or producing "NaN"/"Invalid Date" in front of a customer.

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** One line of untrusted text: no line breaks, bounded length. */
function oneLine(value, max) {
  if (typeof value !== 'string') return '';
  const flat = value.replace(/[\r\n\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim();
  return flat.length > max ? flat.slice(0, max - 1) + '…' : flat;
}

const EMAILISH = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function relativeTime(iso, now) {
  const then = new Date(iso);
  const ms = then.getTime();
  if (!Number.isFinite(ms)) return '';
  const ref = now instanceof Date ? now : new Date();
  const age = ref.getTime() - ms;

  // A clock-skewed or future timestamp must not render as "-3 min".
  if (age < MINUTE) return 'just now';
  if (age < HOUR) return Math.floor(age / MINUTE) + ' min';
  if (age < DAY) return Math.floor(age / HOUR) + ' hr';
  if (age < 30 * DAY) {
    const d = Math.floor(age / DAY);
    return d + (d === 1 ? ' day' : ' days');
  }
  return then.toISOString().slice(0, 10);
}

export function pickWho(data, fields) {
  const d = data && typeof data === 'object' ? data : {};
  const schema = Array.isArray(fields) ? fields : [];

  const named = oneLine(d.name, 80);
  if (named) return named;

  for (const f of schema) {
    if (f && f.type === 'text') {
      const v = oneLine(d[f.name], 80);
      if (v) return v;
    }
  }

  for (const v of Object.values(d)) {
    const s = oneLine(v, 80);
    if (s && EMAILISH.test(s)) return s;
  }

  for (const v of Object.values(d)) {
    const s = oneLine(v, 80);
    if (s) return s;
  }

  return 'Anonymous';
}

export function pickSnippet(data, fields) {
  const d = data && typeof data === 'object' ? data : {};
  const schema = Array.isArray(fields) ? fields : [];
  const who = pickWho(d, schema);

  const message = oneLine(d.message, 140);
  if (message && message !== who) return message;

  for (const f of schema) {
    if (f && f.type === 'textarea') {
      const v = oneLine(d[f.name], 140);
      if (v && v !== who) return v;
    }
  }

  let best = '';
  for (const v of Object.values(d)) {
    const s = oneLine(v, 140);
    if (s && s !== who && s.length > best.length) best = s;
  }
  return best;
}

export function formatBytes(n) {
  const bytes = Number(n);
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return Math.round(bytes) + ' B';
  const units = ['KB', 'MB', 'GB'];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return v.toFixed(1) + ' ' + units[i];
}

export function formatCount(total, exact) {
  const n = Number(total);
  if (!Number.isFinite(n) || n < 0) return '0';
  return exact ? String(n) : n + '+';
}

export function rangeLabel(offset, shown, total, exact) {
  const off = Number(offset) || 0;
  const count = Number(shown) || 0;
  if (count <= 0) return 'No submissions';
  return off + 1 + '-' + (off + count) + ' of ' + formatCount(total, exact);
}

export function buildQuery(params) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) {
    if (v === null || v === undefined || v === '') continue;
    q.set(k, String(v));
  }
  return q.toString();
}

// The status a submission already holds is never offered as a transition —
// a "Mark read" button on an already-read submission is a no-op that looks
// like a broken control.
export function actionsFor(status) {
  const s = String(status || 'new');
  const out = [];
  if (s === 'spam') {
    out.push({ label: 'Not spam', next: 'new', kind: 'normal' });
  } else {
    if (s !== 'read') out.push({ label: 'Mark read', next: 'read', kind: 'normal' });
    if (s !== 'archived') out.push({ label: 'Archive', next: 'archived', kind: 'normal' });
    out.push({ label: 'Spam', next: 'spam', kind: 'normal' });
  }
  if (s === 'archived') out.push({ label: 'Move to inbox', next: 'read', kind: 'normal' });
  out.push({ label: 'Delete', next: null, kind: 'danger' });
  return out;
}
