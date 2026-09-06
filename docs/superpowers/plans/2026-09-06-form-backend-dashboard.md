# form-backend Admin Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `form-backend`'s settings page into an admin dashboard that can read, search and triage submissions, keeping every existing setting as one section of it.

**Architecture:** Eight focused static files served by `app.static` from `form-backend/public/`, loaded as native ES modules with no build step and no CDN. Pure display logic lives in `format.js` so `node --test` can cover it. Three small additions to existing routes in `index.ts` supply counts the UI needs.

**Tech Stack:** TypeScript on `codehooks-js` 1.4.10 (backend), vanilla ES modules + hand-written CSS (frontend), `node --test` with Node 23 type-stripping.

**Spec:** `docs/superpowers/specs/2026-09-06-form-backend-dashboard-design.md`

**Design reference:** `docs/superpowers/specs/2026-09-06-form-backend-dashboard-mockup.html` — an approved, working mockup. Its CSS and its render structure are the source of truth for appearance and markup. Where a task says "port from the mockup", read that file and take the real code; do not reinvent it.

## Global Constraints

- **No build step, no framework, no CDN, no webfont.** Every asset ships in `form-backend/public/`.
- **Module files must end in `.js`.** Verified on the live platform: `app.static` serves `.css` as `text/css` and `.js` as `application/javascript`; **`.mjs` returns 404.**
- Imports in backend code use the `#lib/*` subpath map. No other style resolves under both the platform loader and Node's ESM resolver.
- **`coho verify` must pass in every task.** Node 23 type-stripping runs `.ts` under `node --test` WITHOUT typechecking, so a green test run does not prove types are sound.
- **Submission content, uploaded filenames and server error strings are attacker-controlled.** Every dynamic insertion uses `textContent` or `createTextNode`. `innerHTML` is forbidden in new code except for static literals containing no interpolation.
- The session cookie's `SameSite=Strict` is the only protection against cross-origin admin requests, because the platform injects `Access-Control-Allow-Origin: <echoed origin>` and `Allow-Credentials: true` on every response. No new route may bypass `/admin/api/*` auth.
- Palette tokens, exact values: `--paper #FBFAF7`, `--surface #FFFFFF`, `--sunk #F4F2EE`, `--ink #1C1917`, `--body #44403C`, `--muted #A8A29E`, `--rule #E7E5E4`, `--accent #0F5C5C`, `--accent-soft #E3EFEE`, `--flag #B91C1C`, `--star #B45309`.
- Font stacks, exact values:
  - `--ui: -apple-system, BlinkMacSystemFont, "Segoe UI Variable Text", "Segoe UI", system-ui, Roboto, "Helvetica Neue", sans-serif`
  - `--data: ui-monospace, "SF Mono", SFMono-Regular, "Cascadia Code", "JetBrains Mono", Menlo, Consolas, monospace`
- `COUNT_CAP = 5000`. Counts above it display as `5000+`, never as a wrong exact number.
- The URL stays `/setup/`. Do not add an `/admin/` static route — it collides with `/admin/api/*`.
- The existing 200 unit tests must stay green. Run `node --test test/*.test.ts` in every task.
- Working directory for all commands is `form-backend/`.

---

### Task 1: `format.js` — pure display logic

Everything the UI decides about how to *show* a submission, with no DOM and no fetch, so it is unit-testable. This task ships no visible UI.

**Files:**
- Create: `form-backend/public/format.js`
- Test: `form-backend/test/format.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces, all named exports:
  - `relativeTime(iso: string, now?: Date): string`
  - `pickWho(data: Record<string, unknown>, fields: Array<{name: string, type: string}>): string`
  - `pickSnippet(data: Record<string, unknown>, fields: Array<{name: string, type: string}>): string`
  - `formatBytes(n: number): string`
  - `formatCount(total: number, exact: boolean): string`
  - `rangeLabel(offset: number, shown: number, total: number, exact: boolean): string`
  - `buildQuery(params: Record<string, unknown>): string`
  - `actionsFor(status: string): Array<{ label: string, next: string | null, kind: string }>`

- [ ] **Step 1: Write the failing test**

Create `form-backend/test/format.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert';
import {
  relativeTime,
  pickWho,
  pickSnippet,
  formatBytes,
  formatCount,
  rangeLabel,
  buildQuery,
  actionsFor,
} from '../public/format.js';

const NOW = new Date('2026-09-06T21:00:00.000Z');
const iso = (msAgo: number) => new Date(NOW.getTime() - msAgo).toISOString();

// --- relativeTime ---------------------------------------------------

test('relativeTime reports seconds as "just now"', () => {
  assert.equal(relativeTime(iso(5 * 1000), NOW), 'just now');
  assert.equal(relativeTime(iso(59 * 1000), NOW), 'just now');
});

test('relativeTime crosses into minutes, hours and days at the right boundary', () => {
  assert.equal(relativeTime(iso(60 * 1000), NOW), '1 min');
  assert.equal(relativeTime(iso(59 * 60 * 1000), NOW), '59 min');
  assert.equal(relativeTime(iso(60 * 60 * 1000), NOW), '1 hr');
  assert.equal(relativeTime(iso(23 * 60 * 60 * 1000), NOW), '23 hr');
  assert.equal(relativeTime(iso(24 * 60 * 60 * 1000), NOW), '1 day');
  assert.equal(relativeTime(iso(2 * 24 * 60 * 60 * 1000), NOW), '2 days');
});

test('relativeTime falls back to a date beyond 30 days', () => {
  assert.equal(relativeTime('2026-06-01T10:00:00.000Z', NOW), '2026-06-01');
});

test('relativeTime never throws on junk and never renders "NaN"', () => {
  for (const bad of ['', 'not-a-date', null, undefined, 12345]) {
    const out = relativeTime(bad as any, NOW);
    assert.equal(typeof out, 'string');
    assert.ok(!out.includes('NaN'), `"${out}" contains NaN for input ${String(bad)}`);
    assert.ok(!out.includes('Invalid'), `"${out}" leaks Invalid Date for input ${String(bad)}`);
  }
});

test('relativeTime does not render a future timestamp as a negative age', () => {
  const future = new Date(NOW.getTime() + 60 * 60 * 1000).toISOString();
  const out = relativeTime(future, NOW);
  assert.ok(!out.startsWith('-'), `future time rendered as "${out}"`);
});

// --- pickWho --------------------------------------------------------

const FIELDS = [
  { name: 'name', type: 'text' },
  { name: 'email', type: 'email' },
  { name: 'message', type: 'textarea' },
];

test('pickWho prefers a name field', () => {
  assert.equal(pickWho({ name: 'Ada Lovelace', email: 'ada@x.dev' }, FIELDS), 'Ada Lovelace');
});

test('pickWho falls back to an email-looking value', () => {
  assert.equal(pickWho({ email: 'grace@navy.example' }, FIELDS), 'grace@navy.example');
});

test('pickWho falls back to the first non-empty string', () => {
  assert.equal(pickWho({ subject: 'Broken export' }, []), 'Broken export');
});

test('pickWho returns Anonymous rather than empty for an empty submission', () => {
  assert.equal(pickWho({}, FIELDS), 'Anonymous');
  assert.equal(pickWho({ name: '   ' }, FIELDS), 'Anonymous');
  assert.equal(pickWho(null as any, FIELDS), 'Anonymous');
});

test('pickWho collapses newlines so one value cannot fake two list rows', () => {
  const out = pickWho({ name: 'Ada\nLovelace\r\nInjected' }, FIELDS);
  assert.ok(!/[\r\n]/.test(out), `pickWho leaked a line break: ${JSON.stringify(out)}`);
});

test('pickWho truncates a very long value', () => {
  const out = pickWho({ name: 'x'.repeat(500) }, FIELDS);
  assert.ok(out.length <= 80, `pickWho returned ${out.length} chars`);
});

test('pickWho ignores non-string values rather than rendering [object Object]', () => {
  const out = pickWho({ name: { nested: true }, subject: 'Real' } as any, []);
  assert.ok(!out.includes('object Object'), `pickWho rendered ${out}`);
});

// --- pickSnippet ----------------------------------------------------

test('pickSnippet prefers a message field', () => {
  assert.equal(pickSnippet({ name: 'Ada', message: 'Hello there' }, FIELDS), 'Hello there');
});

test('pickSnippet does not repeat the value pickWho already used', () => {
  const data = { name: 'Ada Lovelace' };
  assert.notEqual(pickSnippet(data, FIELDS), pickWho(data, FIELDS));
});

test('pickSnippet collapses newlines and truncates', () => {
  const out = pickSnippet({ message: 'a\nb\r\nc' + 'x'.repeat(400) }, FIELDS);
  assert.ok(!/[\r\n]/.test(out), 'snippet leaked a line break');
  assert.ok(out.length <= 140, `snippet was ${out.length} chars`);
});

test('pickSnippet returns an empty string when there is nothing else to show', () => {
  assert.equal(pickSnippet({ name: 'Ada' }, FIELDS), '');
});

// --- formatBytes ----------------------------------------------------

test('formatBytes scales through the units', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(999), '999 B');
  assert.equal(formatBytes(1024), '1.0 KB');
  assert.equal(formatBytes(240 * 1024), '240.0 KB');
  assert.equal(formatBytes(2.4 * 1024 * 1024), '2.4 MB');
});

test('formatBytes never renders NaN for junk', () => {
  for (const bad of [NaN, -1, null, undefined, 'x']) {
    const out = formatBytes(bad as any);
    assert.ok(!out.includes('NaN'), `formatBytes(${String(bad)}) = ${out}`);
  }
});

// --- formatCount and rangeLabel -------------------------------------

test('formatCount marks a capped count rather than lying', () => {
  assert.equal(formatCount(214, true), '214');
  assert.equal(formatCount(5000, false), '5000+');
});

test('rangeLabel describes the visible window', () => {
  assert.equal(rangeLabel(0, 50, 214, true), '1-50 of 214');
  assert.equal(rangeLabel(200, 14, 214, true), '201-214 of 214');
  assert.equal(rangeLabel(0, 50, 5000, false), '1-50 of 5000+');
});

test('rangeLabel handles an empty result without producing "1-0 of 0"', () => {
  assert.equal(rangeLabel(0, 0, 0, true), 'No submissions');
});

// --- buildQuery -----------------------------------------------------

test('buildQuery omits empty values', () => {
  assert.equal(buildQuery({ search: '', status: 'new', limit: 50 }), 'status=new&limit=50');
});

test('buildQuery percent-encodes values', () => {
  const q = buildQuery({ search: 'a&b=c d' });
  assert.ok(!q.includes('a&b=c d'), `unencoded: ${q}`);
  assert.equal(new URLSearchParams(q).get('search'), 'a&b=c d');
});

test('buildQuery returns an empty string when nothing is set', () => {
  assert.equal(buildQuery({ search: '', status: '' }), '');
});

// --- actionsFor -----------------------------------------------------

test('actionsFor never offers a transition to the status already held', () => {
  for (const s of ['new', 'read', 'archived', 'spam']) {
    const nexts = actionsFor(s).map((a) => a.next);
    assert.ok(!nexts.includes(s), `actionsFor('${s}') offered '${s}'`);
  }
});

test('actionsFor offers "Not spam" only for a spam submission', () => {
  assert.ok(actionsFor('spam').some((a) => a.label === 'Not spam'));
  for (const s of ['new', 'read', 'archived']) {
    assert.ok(!actionsFor(s).some((a) => a.label === 'Not spam'), `'${s}' offered Not spam`);
  }
});

test('actionsFor always offers delete', () => {
  for (const s of ['new', 'read', 'archived', 'spam']) {
    assert.ok(actionsFor(s).some((a) => a.kind === 'danger'), `'${s}' had no delete`);
  }
});

test('actionsFor tolerates an unknown status rather than throwing', () => {
  const out = actionsFor('wat');
  assert.ok(Array.isArray(out) && out.length > 0);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/format.test.ts`
Expected: FAIL — `Cannot find module '../public/format.js'`.

- [ ] **Step 3: Write `form-backend/public/format.js`**

```js
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
```

- [ ] **Step 4: Run the tests**

Run: `node --test test/format.test.ts` — expected PASS.
Run: `node --test test/*.test.ts` — expected 200 prior tests plus the new ones, 0 failures.
Run: `coho verify` — expected `OK 🙌`.

- [ ] **Step 5: Commit**

```bash
git add form-backend/public/format.js form-backend/test/format.test.ts
git commit -m "feat(form-backend): pure display helpers for the dashboard"
```

---

### Task 2: Backend counts

Three route changes. **Step 1 is a live probe** — the projection syntax is documented but unverified on this deployment, and this project has been bitten three times by platform behaviour that fails silently.

**Files:**
- Modify: `form-backend/index.ts` (routes at `:86`, `:368`, `:434`)
- Create: `form-backend/lib/counting.ts`
- Test: `form-backend/test/counting.test.ts`

**Interfaces:**
- Produces: `countCapped(conn, collection, query, cap?): Promise<{ total: number, exact: boolean }>` from `#lib/counting`, and `COUNT_CAP = 5000`.
- Produces, over HTTP: `GET /admin/api/forms/:formId/submissions` gains `total: number` and `exact: boolean` on the non-search path; `GET /admin/api/forms` gains `newCount: number` per form.

- [ ] **Step 1: Probe the projection syntax on the live space**

Add this route temporarily to `index.ts`, deploy, call it, then remove it:

```ts
app.get('/admin/api/_probe', async (req, res) => {
  const conn = await Datastore.open();
  const rows = await conn
    .getMany('submissions', {}, { hints: { $fields: { _id: 1 } }, limit: 3 })
    .toArray();
  res.json({ ok: true, sample: rows, keys: rows.map((r: any) => Object.keys(r)) });
});
```

Run `coho deploy`, then call it with the admin session. **What you are checking:** whether each returned row contains only `_id`, or the whole document. Record the answer in your report.

- If projection works, `countCapped` uses it as written below.
- If projection is ignored and full documents come back, **keep the same `countCapped` signature and the same cap** — the function still returns a correct count, it just transfers more bytes. Note it in your report as a performance caveat, do not change the interface, and do not invent a different counting method.

Remove the probe route before committing. `git diff` must show no trace of it.

- [ ] **Step 2: Write the failing test**

Create `form-backend/test/counting.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert';
import { countCapped, COUNT_CAP } from '#lib/counting';

function fakeConn(rowCount: number) {
  const calls: any[] = [];
  return {
    calls,
    getMany(collection: string, query: any, options: any) {
      calls.push({ collection, query, options });
      const n = Math.min(rowCount, options?.limit ?? rowCount);
      const rows = Array.from({ length: n }, (_, i) => ({ _id: 'id' + i }));
      return { async toArray() { return rows; } };
    },
  };
}

test('countCapped returns an exact count below the cap', async () => {
  const conn = fakeConn(214);
  const r = await countCapped(conn as any, 'submissions', { formId: 'f1' });
  assert.deepEqual(r, { total: 214, exact: true });
});

test('countCapped reports the cap without claiming exactness above it', async () => {
  const conn = fakeConn(99999);
  const r = await countCapped(conn as any, 'submissions', {});
  assert.equal(r.total, COUNT_CAP);
  assert.equal(r.exact, false);
});

test('countCapped is exact at exactly the cap', async () => {
  const conn = fakeConn(COUNT_CAP);
  const r = await countCapped(conn as any, 'submissions', {});
  assert.deepEqual(r, { total: COUNT_CAP, exact: true });
});

test('countCapped asks for one row beyond the cap so the boundary is decidable', async () => {
  const conn = fakeConn(10);
  await countCapped(conn as any, 'submissions', {});
  assert.equal(conn.calls[0].options.limit, COUNT_CAP + 1);
});

test('countCapped projects to _id so a count does not transfer whole documents', async () => {
  const conn = fakeConn(10);
  await countCapped(conn as any, 'submissions', {});
  assert.deepEqual(conn.calls[0].options.hints, { $fields: { _id: 1 } });
});

test('countCapped passes the caller query through untouched', async () => {
  const conn = fakeConn(1);
  const q = { formId: 'f1', status: 'new' };
  await countCapped(conn as any, 'submissions', q);
  assert.deepEqual(conn.calls[0].query, q);
});

test('a failing store yields zero rather than breaking the page', async () => {
  const broken = { getMany() { throw new Error('db down'); } };
  const r = await countCapped(broken as any, 'submissions', {});
  assert.deepEqual(r, { total: 0, exact: false });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `node --test test/counting.test.ts`
Expected: FAIL — cannot resolve `#lib/counting`.

- [ ] **Step 4: Write `form-backend/lib/counting.ts`**

```ts
// The Datastore has no filtered count: `count(collection)` takes no query, so
// "how many submissions on this form are new" can only be answered by scanning.
// Scanning is bounded and projected to _id, and the caller is told whether the
// answer is exact — showing "5000+" is honest, showing a wrong 5000 is not.

export const COUNT_CAP = 5000;

export type CountResult = { total: number; exact: boolean };

export async function countCapped(
  conn: any,
  collection: string,
  query: Record<string, unknown>,
  cap: number = COUNT_CAP
): Promise<CountResult> {
  try {
    const rows = await conn
      .getMany(collection, query, { hints: { $fields: { _id: 1 } }, limit: cap + 1 })
      .toArray();
    const n = rows.length;
    // The extra row distinguishes "exactly cap" from "cut short".
    return n > cap ? { total: cap, exact: false } : { total: n, exact: true };
  } catch (err: any) {
    // A count is decoration on a page whose real content is the submission list.
    // A counting failure must not take the inbox down with it.
    console.error('countCapped failed for', collection, err?.message);
    return { total: 0, exact: false };
  }
}
```

- [ ] **Step 5: Add `total`/`exact` to the submissions route**

In `index.ts`, in `app.get('/admin/api/forms/:formId/submissions', ...)`, replace the final non-search block:

```ts
  const rows = await conn
    .getMany('submissions', query, { sort: { created: -1 }, limit: lim, offset: off })
    .toArray();

  res.json({ ok: true, data: rows });
```

with:

```ts
  const rows = await conn
    .getMany('submissions', query, { sort: { created: -1 }, limit: lim, offset: off })
    .toArray();

  // The same filter the page was drawn from, so the total can never describe a
  // different set than the rows above it.
  const { total, exact } = await countCapped(conn, 'submissions', query);

  res.json({ ok: true, data: rows, total, exact });
```

Add `import { countCapped } from '#lib/counting';` alongside the other `#lib` imports.

The search path already returns `total`; add `exact: !page.truncated` to its response so both paths carry the same shape:

```ts
    return res.json({ ok: true, ...page, exact: !page.truncated });
```

- [ ] **Step 6: Add `newCount` to the forms list route**

Replace `app.get('/admin/api/forms', ...)` with:

```ts
app.get('/admin/api/forms', async (req, res) => {
  const conn = await Datastore.open();
  const forms = await conn.getMany('forms', {}, { sort: { created: -1 } }).toArray();

  // One bounded scan per form. The forms list is small by nature — this is a
  // handful of documents, not a table scan per page view.
  const withCounts = [];
  for (const form of forms as any[]) {
    const { total } = await countCapped(conn, 'submissions', { formId: form.uuid, status: 'new' }, 999);
    withCounts.push({ ...form, newCount: total });
  }

  res.json({ ok: true, data: withCounts });
});
```

- [ ] **Step 7: Do NOT touch the stats counters — read this instead**

An earlier draft of this plan told you to decrement `stats.total` on submission delete, with
`$inc: { 'stats.total': -1 }`. **Do not do that.** It was wrong twice over, and both reasons matter
for the rest of this task:

1. **Dot notation is not a path on this datastore.** `$inc: { 'stats.total': -1 }` creates or
   updates a top-level field literally *named* `stats.total`. It never touches `total` inside
   `stats`, and it raises no error. This is a general rule, not an `$inc` quirk — `$set` behaves the
   same way. See `lib/stats.ts`, which documents the full probe.
2. **The counters have since moved.** They are now flat atomic fields — `statsTotal`, `statsSpam`,
   `statsLastSubmissionAt` — composed back into the public `stats` object on read by
   `composeStats()` in `lib/stats.ts`. Nothing in this task should write them.

`stats.total` is a **lifetime-received** counter: how many submissions this form has ever accepted.
That is a genuinely useful number and it is correct as it stands. It is NOT the number of
submissions currently stored, and decrementing it would destroy the stat to approximate something
`countCapped` already answers exactly.

**So: this step is a no-op on the backend.** Every place the dashboard shows "how many are stored
right now" — the rail badge, the list footer, any delete confirmation — uses `countCapped` from
Step 4. Where the UI wants "received all time", it may read `form.stats.total`, which is now
accurate.

Confirm before moving on: `grep -rn "stats\." form-backend/index.ts form-backend/lib` should show
no dotted update key anywhere. If it does, that write is silently inert.

- [ ] **Step 8: Verify**

Run: `node --test test/counting.test.ts` — PASS.
Run: `node --test test/*.test.ts` — all green.
Run: `coho verify` — `OK 🙌`.
Run: `coho deploy`, then with an admin session confirm over HTTP:
- `GET /admin/api/forms` returns `newCount` on every form.
- `GET /admin/api/forms/<uuid>/submissions?limit=2` returns `total` and `exact`, and `total` is larger than `data.length` on a form with more than two submissions.
- `GET /admin/api/forms/<uuid>/submissions?search=x` still returns `total`, and now `exact`.

- [ ] **Step 9: Commit**

```bash
git add form-backend/lib/counting.ts form-backend/test/counting.test.ts form-backend/index.ts
git commit -m "feat(form-backend): submission counts for the dashboard"
```

---

### Task 3: Page shell and stylesheet

The visual skeleton. After this task `/setup/` renders the three-pane layout with static placeholder content and no behaviour.

**Files:**
- Create: `form-backend/public/app.css`
- Rewrite: `form-backend/public/index.html`
- Preserve: copy the current `index.html` to `form-backend/public/legacy-setup.html.bak` first, so Task 8 can port from it. **Delete that backup in Task 8.**

**Interfaces:**
- Produces: the DOM contract every later task binds to. These ids and classes are fixed:
  - `#rail`, `#rail-select` (the narrow-screen form switcher), `#new-form`
  - `#tab-submissions`, `#tab-settings`, `#pane-submissions`, `#pane-settings`
  - `#q`, `#status`, `#from`, `#to`, `#rows`, `#count`, `#prev`, `#next`
  - `#record`
  - `#login`, `#login-form`, `#password`, `#login-error`, `#app`
  - `#toasts`

- [ ] **Step 1: Back up the current page**

```bash
cp form-backend/public/index.html form-backend/public/legacy-setup.html.bak
```

- [ ] **Step 2: Write `app.css`**

Port the entire `<style>` block from `docs/superpowers/specs/2026-09-06-form-backend-dashboard-mockup.html` into `form-backend/public/app.css`, with these changes:

1. Drop the `.page`, `.chrome`, `.app`, `.titlebar`, `.dots`, `.legend`, `.card`, `.swatches`, `.sw`, `.typerow`, `.sample-ui`, `.sample-data` and `.ask` rules — those are mockup chrome, not product.
2. `body` takes `background: var(--paper)` (not the mockup's `#EEEBE5` desk colour) and `height: 100vh; overflow: hidden`.
3. `.panes` becomes `height: 100vh` instead of `min-height: 620px`, and `.rows` uses `flex: 1 1 auto` with no `max-height`.
4. Keep every token, every font stack, and every component rule for `.rail*`, `.tabs`, `.tab`, `.filters`, `.rows`, `.row*`, `.list-foot`, `.pager`, `.record*`, `.actions`, `.act`, `.fields`, `.block-label`, `.files`, `.file`, `.meta`, `.notes`, `.note*`, `.empty` exactly as they are — they are approved.
5. Keep the `:focus-visible`, `prefers-reduced-motion` and `max-width: 1040px` blocks.

Then add, new to this task:

```css
/* --- login gate --- */
.gate {
  height: 100vh;
  display: grid;
  place-items: center;
  background: var(--paper);
  padding: 1rem;
}
.gate form {
  background: var(--surface);
  border: 1px solid var(--rule);
  border-radius: 10px;
  padding: 1.5rem;
  width: min(22rem, 100%);
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}
.gate h1 { margin: 0; font-size: 1.0625rem; color: var(--ink); font-weight: 600; }
.gate input {
  font: inherit;
  color: var(--body);
  background: var(--paper);
  border: 1px solid var(--rule);
  border-radius: 6px;
  padding: 0.5rem 0.6rem;
}
.gate .err { color: var(--flag); font-size: 12.5px; min-height: 1.2em; }

/* --- toasts --- */
#toasts {
  position: fixed;
  bottom: 1rem;
  right: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  z-index: 20;
}
.toast {
  background: var(--ink);
  color: var(--paper);
  border-radius: 7px;
  padding: 0.5rem 0.75rem;
  font-size: 13px;
  box-shadow: 0 6px 20px -6px rgba(28,25,23,0.4);
}
.toast[data-kind="error"] { background: var(--flag); }

/* --- narrow-screen form switcher --- */
#rail-select { display: none; }
@media (max-width: 1040px) {
  .rail-list, .rail-foot { display: none; }
  #rail-select {
    display: block;
    font: inherit;
    width: 100%;
    color: var(--body);
    background: var(--surface);
    border: 1px solid var(--rule);
    border-radius: 6px;
    padding: 0.4rem 0.5rem;
  }
  body, .panes { height: auto; overflow: auto; }
}
```

- [ ] **Step 3: Write `index.html`**

Replace `form-backend/public/index.html` entirely. Structure only — no inline `<style>`, no inline behaviour beyond the module script tag:

```html
<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Form Backend</title>
<link rel="stylesheet" href="app.css">

<div class="gate" id="login">
  <form id="login-form">
    <h1>Form Backend</h1>
    <label for="password">Admin password</label>
    <input type="password" id="password" autocomplete="current-password" required>
    <button type="submit" class="act primary">Sign in</button>
    <p class="err" id="login-error"></p>
  </form>
</div>

<div class="panes" id="app" hidden>

  <nav class="rail" aria-label="Forms">
    <div class="rail-head">
      <span class="mark">Form Backend</span>
    </div>
    <div>
      <div class="rail-label">Forms</div>
      <select id="rail-select" aria-label="Select a form"></select>
      <div class="rail-list" id="rail"></div>
      <button class="rail-new" type="button" id="new-form">+ New form</button>
    </div>
    <div class="rail-foot" id="rail-foot"></div>
  </nav>

  <section class="list" aria-label="Submissions">
    <div class="tabs" role="tablist">
      <button class="tab" role="tab" id="tab-submissions" aria-selected="true" type="button">Submissions</button>
      <button class="tab" role="tab" id="tab-settings" aria-selected="false" type="button">Settings</button>
    </div>
    <div class="filters">
      <input type="search" id="q" placeholder="Search submissions" aria-label="Search submissions">
      <select id="status" aria-label="Filter by status">
        <option value="">All</option>
        <option value="new">New</option>
        <option value="read">Read</option>
        <option value="archived">Archived</option>
        <option value="spam">Spam</option>
      </select>
    </div>
    <div class="filters">
      <input type="date" id="from" aria-label="From date">
      <input type="date" id="to" aria-label="To date">
    </div>
    <div class="rows" id="rows"></div>
    <div class="list-foot">
      <span id="count"></span>
      <span class="pager">
        <button type="button" id="prev" aria-label="Previous page">&larr;</button>
        <button type="button" id="next" aria-label="Next page">&rarr;</button>
      </span>
    </div>
  </section>

  <section class="record" aria-label="Submission record" id="record"></section>

  <section class="record" aria-label="Form settings" id="pane-settings" hidden></section>

</div>

<div id="toasts" aria-live="polite"></div>

<script type="module" src="app.js"></script>
```

Note `#pane-submissions` is not a separate element — the list plus `#record` *is* the submissions pane. Track that in the DOM contract: switching to Settings hides `#record` and shows `#pane-settings`.

- [ ] **Step 4: Create a placeholder `app.js` so the page loads**

```js
// Replaced in Task 5. Present so the shell loads without a 404.
document.getElementById('login').hidden = false;
```

- [ ] **Step 5: Deploy and check the shell renders**

Run: `coho deploy`, then open `https://api.formbackend.dev/setup/`.
Expected: the login card renders on warm paper with the correct fonts. Confirm in the network panel that `app.css` returns `200 text/css` and `app.js` returns `200 application/javascript`, and that **no request leaves the origin**.

- [ ] **Step 6: Commit**

```bash
git add form-backend/public/
git commit -m "feat(form-backend): dashboard shell and stylesheet"
```

---

### Task 4: `api.js` and `ui.js`

Client plumbing. No visible change.

**Files:**
- Create: `form-backend/public/api.js`, `form-backend/public/ui.js`

**Interfaces:**
- `api.js` produces: `login(password)`, `logout()`, `listForms()`, `createForm(name)`, `getForm(id)`, `patchForm(id, patch)`, `deleteForm(id)`, `getSnippet(id)`, `listDeliveries(id)`, `listSubmissions(formId, params)`, `getSubmission(id)`, `patchSubmission(id, patch)`, `deleteSubmission(id)`, `fileUrl(submissionId, fileId)`, `exportUrl(formId)`. Every one returns parsed JSON or throws an `Error` whose `message` is the server's `error` string. A 401 from any call dispatches a `session-expired` event on `window` and throws.
- `ui.js` produces: `el(tag, cls?, text?)`, `clear(node)`, `toast(message, kind?)`, `confirmInline(host, message, onConfirm)`, `setBusy(button, busy)`.

- [ ] **Step 1: Write `api.js`**

```js
// The only module that calls fetch. Everything else works in terms of these
// functions, so auth handling and error shape live in exactly one place.

async function call(path, options = {}) {
  const res = await fetch(path, {
    credentials: 'same-origin',
    headers: options.body ? { 'content-type': 'application/json' } : undefined,
    ...options,
  });

  if (res.status === 401) {
    window.dispatchEvent(new CustomEvent('session-expired'));
    throw new Error('Your session has expired. Sign in again.');
  }

  let payload = null;
  try {
    payload = await res.json();
  } catch {
    throw new Error('The server returned a response this page could not read.');
  }

  if (!res.ok || payload.ok === false) {
    throw new Error(payload && payload.error ? String(payload.error) : 'Request failed.');
  }
  return payload;
}

const body = (obj) => ({ method: 'POST', body: JSON.stringify(obj) });

export const login = (password) => call('/admin/login', body({ password }));
export const logout = () => call('/admin/logout', { method: 'POST' });

export const listForms = () => call('/admin/api/forms');
export const createForm = (name) => call('/admin/api/forms', body({ name }));
export const getForm = (id) => call('/admin/api/forms/' + encodeURIComponent(id));
export const patchForm = (id, patch) =>
  call('/admin/api/forms/' + encodeURIComponent(id), { method: 'PATCH', body: JSON.stringify(patch) });
export const deleteForm = (id) =>
  call('/admin/api/forms/' + encodeURIComponent(id), { method: 'DELETE' });
export const getSnippet = (id) => call('/admin/api/forms/' + encodeURIComponent(id) + '/snippet');
export const listDeliveries = (id) => call('/admin/api/forms/' + encodeURIComponent(id) + '/deliveries');

export const listSubmissions = (formId, query) =>
  call('/admin/api/forms/' + encodeURIComponent(formId) + '/submissions' + (query ? '?' + query : ''));
export const getSubmission = (id) => call('/admin/api/submissions/' + encodeURIComponent(id));
export const patchSubmission = (id, patch) =>
  call('/admin/api/submissions/' + encodeURIComponent(id), { method: 'PATCH', body: JSON.stringify(patch) });
export const deleteSubmission = (id) =>
  call('/admin/api/submissions/' + encodeURIComponent(id), { method: 'DELETE' });

export const fileUrl = (submissionId, fileId) =>
  '/admin/api/submissions/' + encodeURIComponent(submissionId) + '/files/' + encodeURIComponent(fileId);
export const exportUrl = (formId) =>
  '/admin/api/forms/' + encodeURIComponent(formId) + '/export.csv';
```

- [ ] **Step 2: Write `ui.js`**

```js
// DOM helpers. `el` takes text, never markup — the single reason this page has
// no innerHTML in it: submission content and server error strings are both
// attacker-controlled and both end up on screen.

export function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== null && text !== undefined) node.textContent = String(text);
  return node;
}

export function clear(node) {
  node.textContent = '';
  return node;
}

export function toast(message, kind) {
  const host = document.getElementById('toasts');
  const t = el('div', 'toast', message);
  if (kind) t.setAttribute('data-kind', kind);
  host.appendChild(t);
  setTimeout(() => t.remove(), kind === 'error' ? 6000 : 3000);
}

// Two-step confirmation in place, never window.confirm — the same pattern the
// delete-form control already uses, so destructive actions look alike.
export function confirmInline(host, message, onConfirm) {
  clear(host);
  host.hidden = false;
  host.appendChild(el('p', null, message));

  const yes = el('button', 'act danger', 'Yes, delete');
  yes.type = 'button';
  const no = el('button', 'act', 'Cancel');
  no.type = 'button';

  no.addEventListener('click', () => {
    host.hidden = true;
    clear(host);
  });

  yes.addEventListener('click', async () => {
    setBusy(yes, true);
    try {
      await onConfirm();
      host.hidden = true;
      clear(host);
    } catch (err) {
      setBusy(yes, false);
      const e = el('p', 'err', err.message);
      host.appendChild(e);
    }
  });

  const row = el('div', 'actions');
  row.appendChild(yes);
  row.appendChild(no);
  host.appendChild(row);
}

export function setBusy(button, busy) {
  button.disabled = !!busy;
  if (busy) {
    button.dataset.label = button.textContent;
    button.textContent = 'Working…';
  } else if (button.dataset.label) {
    button.textContent = button.dataset.label;
    delete button.dataset.label;
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add form-backend/public/api.js form-backend/public/ui.js
git commit -m "feat(form-backend): dashboard api client and DOM helpers"
```

---

### Task 5: `app.js` — boot, login gate, rail, tabs

After this task the page signs in, lists real forms in the rail with real unread counts, and switches tabs. The list and record panes stay empty.

**Files:**
- Rewrite: `form-backend/public/app.js`

**Interfaces:**
- Consumes: `api.js`, `ui.js`, `format.js`, and the DOM contract from Task 3.
- Produces: a module-level store other modules import — `export const state = { forms: [], formId: null, tab: 'submissions' }` — plus `export function selectForm(id)` and `export async function refreshForms()`. Emits a `form-changed` event on `window` whenever `state.formId` changes, which Task 6 listens for.

- [ ] **Step 1: Implement**

Requirements, in full:

1. On load, call `listForms()`. A success means there is a session: hide `#login`, show `#app`, render the rail. A thrown error means no session: show `#login`, hide `#app`.
2. `#login-form` submit calls `login(password)`, then re-runs boot. On failure, put the error message in `#login-error` via `textContent` and leave the field focused. Never log the password.
3. `window.addEventListener('session-expired', ...)` shows `#login` and hides `#app`.
4. Rail: one `.rail-item` button per form. `textContent` for the name. A `.badge` showing `newCount`, with `data-zero="true"` when it is 0 so CSS hides it. `aria-current="true"` on the selected form. Mirror the same list into `#rail-select` for narrow screens, kept in sync both ways.
5. `#rail-foot` shows total submissions across forms and the most recent submission time, using `relativeTime`.
6. `#new-form` prompts for a name inline (an input appended below the button, not `window.prompt`), calls `createForm`, refreshes the rail, and selects the new form.
7. Tabs: clicking `#tab-settings` sets `aria-selected` on both tabs, hides `#record`, shows `#pane-settings`, and hides the `.filters` rows and `#rows` and `.list-foot`. Clicking `#tab-submissions` reverses it.
8. Selecting a form sets `state.formId`, updates the rail, and dispatches `form-changed`.
9. Every `api` call is wrapped so a thrown error becomes `toast(err.message, 'error')` rather than an unhandled rejection.

- [ ] **Step 2: Deploy and verify**

Run `coho deploy`. In a browser: sign in with the admin password, confirm the rail lists the real forms with correct unread badges, click between forms, click between tabs, create a form and confirm it appears, then delete it via curl to leave the space clean. Confirm no request leaves the origin.

- [ ] **Step 3: Commit**

```bash
git add form-backend/public/app.js
git commit -m "feat(form-backend): dashboard boot, login gate, form rail"
```

---

### Task 6: `submissions.js` — the list pane

**Files:**
- Create: `form-backend/public/submissions.js`
- Modify: `form-backend/public/app.js` (import and initialise it)

**Interfaces:**
- Consumes: `state`, `form-changed`, `listSubmissions`, `format.js`.
- Produces: `initList()`, and a `submission-selected` event on `window` carrying `{ detail: submission }` that Task 7 listens for.

- [ ] **Step 1: Implement**

1. Fetch on `form-changed`, on filter change, and on pagination. Build the query with `buildQuery({ search, status, from, to, limit: 50, offset })`.
2. Debounce the search box by 250 ms so typing does not fire a request per keystroke.
3. Render one `.row` button per submission, exactly as the mockup does: `data-status` attribute, `.row-top` with `.row-who` (from `pickWho`) and `.row-when` (from `relativeTime`), `.row-snip` with `.row-marks` (`★` when `starred`, `❑` when `files.length`) followed by `pickSnippet`. All `textContent`.
4. `#count` gets `rangeLabel(offset, rows.length, total, exact)`.
5. `#prev` is disabled at `offset === 0`; `#next` is disabled when `offset + rows.length >= total && exact`.
6. Empty result renders `.empty` with `No submissions match that filter.`; a form with no submissions at all renders `No submissions yet. Point a form at this endpoint and they will appear here.`
7. Clicking a row sets `aria-current`, and dispatches `submission-selected`.
8. Selecting a `new` submission optimistically marks it `read` after the record opens — call `patchSubmission(id, { status: 'read' })`, update the row's `data-status`, and decrement the rail badge. On failure, revert and toast.
9. A fetch failure renders `.empty` with the error message and does not leave a stale list on screen.

- [ ] **Step 2: Deploy and verify**

Submissions appear for the selected form, newest first. Search narrows them. Each status filter returns the right subset. Pagination works on a form with more than 50 submissions and the buttons disable at the ends. Opening a `new` submission clears its teal edge and decrements the badge.

- [ ] **Step 3: Commit**

```bash
git add form-backend/public/submissions.js form-backend/public/app.js
git commit -m "feat(form-backend): submission list pane"
```

---

### Task 7: the record pane

**Files:**
- Modify: `form-backend/public/submissions.js`

**Interfaces:**
- Consumes: `submission-selected`, `getSubmission`, `patchSubmission`, `deleteSubmission`, `fileUrl`, `actionsFor`, `formatBytes`, `confirmInline`.

- [ ] **Step 1: Implement**

Port the record structure from the mockup exactly — `.record-head` (eyebrow with form name and status, `<h2>` with `pickWho`, `.from` with the submitter's email), `.actions`, then `.record-body` containing `.fields`, the files block, `.meta`, and `.notes`.

1. **Fields** — a `<dl class="fields">`, one `dt`/`dd` per key in `submission.data`, in the form's declared field order first, then any remaining keys. Values via `textContent`; the CSS already sets `white-space: pre-wrap` so multi-line values render as written without any markup.
2. **Files** — one `.file` row per entry in `submission.files`: name, `formatBytes(size)`, and a Download link to `fileUrl(submission._id, file.id)`. The link is a real `<a href>` with `download` — the route already sets `content-disposition: attachment`.
3. **Metadata** — a `<dl class="meta">` with `submitted` (the full ISO timestamp), `ip`, `referer`, `agent` and `id`. Missing values render as `—`, never as `undefined`.
4. **Notes** — existing notes with their timestamps, then an input and an Add button calling `patchSubmission(id, { note })`. Empty input does nothing.
5. **Actions** — a Star toggle with `aria-pressed`, a Reply button that is an `<a>` with a `mailto:` href built from the submitter's address (no sending), then one button per entry from `actionsFor(submission.status)`. Each status button calls `patchSubmission`, updates the row in the list, and re-renders the record. Delete uses `confirmInline` and, on success, removes the row and clears the record.
6. Nothing selected renders `.empty` with `Select a submission to read it.`
7. **Also add an Export CSV link** in the actions row of the *list* footer, pointing at `exportUrl(state.formId)` — the capability exists and has no UI.

- [ ] **Step 2: Deploy and verify**

Open a submission with a file attached and confirm every field renders, the download returns the correct bytes, star toggles and persists across a reload, each status action works and the list row updates to match, adding a note persists, and delete removes the submission and clears the pane. Confirm a submission whose content contains `<script>alert(1)</script>` and a value containing newlines both render as literal text.

- [ ] **Step 3: Commit**

```bash
git add form-backend/public/submissions.js
git commit -m "feat(form-backend): submission record pane"
```

---

### Task 8: `settings.js` — port the existing setup UI

Every control the current page has, moved into the Settings tab with no capability lost. This is a port, not a redesign.

**Files:**
- Create: `form-backend/public/settings.js`
- Modify: `form-backend/public/app.js`
- Delete: `form-backend/public/legacy-setup.html.bak`

- [ ] **Step 1: Enumerate what exists**

Read `form-backend/public/legacy-setup.html.bak` and write down every control it offers. As of Task 12 of the previous plan that is: form name; enabled toggle; strict mode; redirect URL and the allow-override flag; allowed domains; honeypot field name; the fields editor; notification settings (enabled, recipients, subject template, attach-files); the snippet with a copy button; the recent delivery attempts panel; and delete form with two-step confirmation. **Confirm this list against the file — do not trust it.** Put the enumeration in your report.

- [ ] **Step 2: Port each into `#pane-settings`**

Reuse the approved component classes — `.act`, `.fields`, `.block-label`, `.file`, `.meta` — rather than inventing new ones. Keep the existing behaviour exactly: same endpoints, same payloads, same validation messages, same two-step delete confirmation with the submission count, same `textContent`-only insertion. Where the old page used its own bespoke CSS class, map it to the nearest approved class and note the mapping in your report.

- [ ] **Step 3: Delete the backup**

```bash
git rm -f form-backend/public/legacy-setup.html.bak 2>/dev/null || rm -f form-backend/public/legacy-setup.html.bak
```

The backup must not ship — it is a second copy of the admin UI on a public static route.

- [ ] **Step 4: Deploy and verify every control**

Walk the enumeration from Step 1 one control at a time against a throwaway form. Every one must work. Record the walkthrough in your report, control by control, with what you observed. **Do not delete or modify the form `Live example` (`_id 6a99c613536c7e9d64986cca`, uuid `3324297f-f6eb-4ca6-a7a7-07424d655432`) — a public demo depends on it.**

- [ ] **Step 5: Commit**

```bash
git add form-backend/public/
git commit -m "feat(form-backend): port form settings into the dashboard"
```

---

### Task 9: Responsive pass, accessibility, docs

**Files:**
- Modify: `form-backend/public/app.css`, `form-backend/README.md`, `CHANGELOG.md`, `form-backend/package.json` (version bump)

- [ ] **Step 1: Narrow-screen pass**

At 375 px, 768 px and 1039 px: the rail is a `<select>`, the list and record stack, nothing scrolls horizontally, and every control is reachable. Fix what is not.

- [ ] **Step 2: Keyboard and screen-reader pass**

Tab through the whole page. Every interactive element takes focus in a sensible order with a visible `:focus-visible` ring. The list rows are buttons, so they are already reachable — confirm Enter and Space activate them. `aria-selected` on tabs and `aria-current` on the selected row and form are correct. `#toasts` is `aria-live="polite"`.

- [ ] **Step 3: Confirm the no-network promise**

Load `/setup/` with devtools open. The only requests are to `/setup/*` and `/admin/api/*`. Zero third-party requests. Record the full request list in your report.

- [ ] **Step 4: Documentation**

- `form-backend/README.md`: replace the "set from `/setup/`" framing with a Dashboard section describing the three panes, search and filters, triage actions, file download and CSV export. Keep every existing settings reference accurate.
- `CHANGELOG.md`: a dated entry under the template, in the style of the existing ones, naming what shipped and the test count.
- `form-backend/package.json`: bump the minor version.

- [ ] **Step 5: Final verification and commit**

Run: `node --test test/*.test.ts` — all green.
Run: `coho verify` — `OK 🙌`.
Run: `coho deploy` and confirm `/setup/` loads clean.

```bash
git add form-backend/ CHANGELOG.md
git commit -m "docs(form-backend): document the dashboard, bump version"
```

---

## Self-review notes

**Spec coverage.** Goals: read submissions (Tasks 6, 7); triage — search, filter, star, read, archive, spam, delete, note (Tasks 6, 7); keep every setting (Task 8); considered look with no build step or network dependency (Tasks 3, 9). Backend additions 1-3 (Task 2). File structure: all eight files created across Tasks 1, 3, 4, 5, 6, 8. Testing: unit in Tasks 1 and 2, browser walkthrough in Tasks 5-9, no-network check in Task 9.

**Known gap, deliberate.** `submissions.js` carries both the list and the record pane (Tasks 6 and 7) and will be the largest module. It is split across two tasks so each gets its own review gate. If it exceeds roughly 400 lines at the end of Task 7, split the record pane into `record.js` as the first step of Task 8 and say so in the report.

**Date filters** are in the shell (Task 3) and wired in Task 6; the API already supports `from`/`to`.

**Dependency order** is strict: 1 and 2 are independent of each other; 3 depends on nothing; 4 depends on 3's DOM contract; 5 depends on 3 and 4; 6 depends on 1 and 5; 7 depends on 6; 8 depends on 5; 9 depends on everything.
