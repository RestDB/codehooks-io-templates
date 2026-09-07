# form-backend: Email Notifications & Spam Defence — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Send an email for every submission — with the uploaded files attached and signed download links — add the honeypot enforcement and per-IP rate limiting that make it safe to leave switched on, and give a new customer a setup page so they can go from deploy to a working form without touching curl.

**Architecture:** A durable outbox. The submit handler stays fast and enqueues `processSubmission`, which writes one `deliveries` row per configured channel and enqueues a generic `deliver` task each. `deliver` owns all retry logic; channels are adapters behind one `Channel` interface, and email is the only one this release implements.

**Tech Stack:** TypeScript, codehooks-js, Codehooks Datastore + filestore + queues + jobs, `jsonwebtoken`, `node --test`.

**Spec:** `docs/superpowers/specs/2026-09-06-form-backend-email-notifications-design.md`

## Global Constraints

These bind every task and are not repeated per-task.

- **Internal modules import through the `#lib/*` map**, source AND tests: `from '#lib/throttle'`. Never relative paths.
- **Types use `import type`**, split from value imports. Node strips types with no build step, so a value import of a type throws `SyntaxError` at runtime.
- **`import { randomUUID } from 'crypto'`** — named imports. (`jsonwebtoken` legitimately uses a default import in `lib/auth.ts`; leave it.)
- **No `fs`, `path`, or `os`.** `conn.getMany()` returns a stream — `.toArray()` before use.
- **`app.options` does not exist** in codehooks-js — only get/post/put/patch/delete/all.
- **`parseBody` MUST remain the first awaited call** in the submit handler. The platform consumes the request stream once a handler yields, so anything awaited first empties multipart bodies. The new rate-limit and honeypot checks therefore run **after** parsing.
- **`filestore.getReadStream()` resolves to a stream with NO `.pipe()`.** Consume it with `.on('data', buf => res.write(buf, 'buffer')).on('end', () => res.end())`, and obtain it **before** setting response headers so a failure can still return a real status code.
- **The platform shadows `/health`** — app routes there never run. The status route is `/status`.
- **Node type-stripping compatible:** no `enum`, `namespace`, parameter properties, or decorators.
- **After any `coho deploy`, `sleep 3` before curling.** A spurious `{"error":"Authentication failed"}` within ~2s is a stale instance — retry once, do not chase it.
- **Commit after every task.**

---

## File Structure

| File | Responsibility |
|---|---|
| `lib/signed-links.ts` | Mint and verify per-file download tokens. Pure except for the secret. |
| `lib/attachments.ts` | Decide which files fit the attachment budget. Pure. |
| `lib/notify.ts` | Compose the notification email: subject, body, Reply-To selection. Pure. |
| `lib/providers/types.ts` | `EmailMessage` + `SendResult` + `EmailProvider`, extended with attachments and replyTo. |
| `lib/providers/mailgun.ts` | Mailgun implementation, multipart attachments. |
| `lib/providers/brevo.ts` | Brevo implementation, base64 attachments. |
| `lib/providers/index.ts` | Selects a provider from `EMAIL_PROVIDER`; exposes `sendEmail()`. |
| `lib/channels/types.ts` | The `Channel` interface every adapter implements. |
| `lib/channels/email.ts` | The email channel adapter. |
| `lib/spam.ts` | Honeypot verdict and submission rate-limit decision. Pure decisions. |
| `index.ts` | Route/worker/job registration only. |

---

### Task 1: Signed download links

**Files:**
- Create: `form-backend/lib/signed-links.ts`, `form-backend/test/signed-links.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `signFileToken(submissionId: string, fileId: string, ttlDays?: number): string`
  - `verifyFileToken(token: string): { sid: string; fid: string } | null`

- [ ] **Step 1: Write the failing tests**

Create `form-backend/test/signed-links.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert';
import jwt from 'jsonwebtoken';
import { signFileToken, verifyFileToken } from '#lib/signed-links';

function withSecret(secret: string, fn: () => void) {
  const prev = process.env.JWT_SECRET;
  process.env.JWT_SECRET = secret;
  try { fn(); } finally {
    if (prev === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = prev;
  }
}

test('a signed token round-trips to its submission and file', () => {
  withSecret('test-secret', () => {
    const t = signFileToken('sub-1', 'file-9');
    assert.deepEqual(verifyFileToken(t), { sid: 'sub-1', fid: 'file-9' });
  });
});

test('a token scopes to ONE file, not a whole submission', () => {
  withSecret('test-secret', () => {
    const t = signFileToken('sub-1', 'file-9');
    const claims = verifyFileToken(t);
    assert.equal(claims?.fid, 'file-9');
    // there is no wildcard or omitted fid form
    assert.notEqual(claims?.fid, undefined);
  });
});

test('a tampered token is rejected', () => {
  withSecret('test-secret', () => {
    const t = signFileToken('sub-1', 'file-9');
    const parts = t.split('.');
    const forged = parts[0] + '.' + Buffer.from('{"sid":"sub-1","fid":"other"}').toString('base64url') + '.' + parts[2];
    assert.equal(verifyFileToken(forged), null);
  });
});

test('a token signed with a DIFFERENT secret is rejected', () => {
  let foreign = '';
  withSecret('another-secret', () => { foreign = signFileToken('sub-1', 'file-9'); });
  withSecret('test-secret', () => {
    assert.equal(verifyFileToken(foreign), null);
  });
});

test('an expired token is rejected', () => {
  withSecret('test-secret', () => {
    const expired = jwt.sign({ sid: 'sub-1', fid: 'file-9' }, 'test-secret', { expiresIn: -10 });
    assert.equal(verifyFileToken(expired), null);
  });
});

test('garbage is rejected without throwing', () => {
  withSecret('test-secret', () => {
    assert.equal(verifyFileToken('not-a-token'), null);
    assert.equal(verifyFileToken(''), null);
  });
});

test('verification fails closed when JWT_SECRET is unset', () => {
  let t = '';
  withSecret('test-secret', () => { t = signFileToken('sub-1', 'file-9'); });
  const prev = process.env.JWT_SECRET;
  delete process.env.JWT_SECRET;
  try {
    assert.equal(verifyFileToken(t), null);
  } finally {
    if (prev !== undefined) process.env.JWT_SECRET = prev;
  }
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd form-backend && node --test test/signed-links.test.ts`
Expected: FAIL — cannot find module `#lib/signed-links`.

- [ ] **Step 3: Write the implementation**

Create `form-backend/lib/signed-links.ts`:

```ts
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd form-backend && node --test test/signed-links.test.ts`
Expected: PASS — 7 passing.

- [ ] **Step 5: Commit**

```bash
git add form-backend/lib/signed-links.ts form-backend/test/signed-links.test.ts
git commit -m "feat(form-backend): signed per-file download tokens"
```

---

### Task 2: Attachment budget

**Files:**
- Create: `form-backend/lib/attachments.ts`, `form-backend/test/attachments.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type FileRef = { id: string; filename: string; contentType: string; size: number; path: string }`
  - `type AttachmentPlan = { attach: FileRef[]; tooLarge: FileRef[] }`
  - `planAttachments(files: FileRef[], budgetBytes: number): AttachmentPlan`
  - `MAX_ATTACH_MB_DEFAULT = 10`

Which files attach must be a pure, deterministic decision so it can be tested without a datastore or a provider. Smallest files are attached first, so one large file cannot crowd out several small ones.

- [ ] **Step 1: Write the failing tests**

Create `form-backend/test/attachments.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert';
import { planAttachments } from '#lib/attachments';
import type { FileRef } from '#lib/attachments';

const f = (id: string, size: number): FileRef => ({
  id, filename: `${id}.bin`, contentType: 'application/octet-stream', size, path: `/uploads/${id}`,
});

test('everything attaches when it fits the budget', () => {
  const plan = planAttachments([f('a', 100), f('b', 200)], 1000);
  assert.deepEqual(plan.attach.map((x) => x.id), ['a', 'b']);
  assert.equal(plan.tooLarge.length, 0);
});

test('files over the budget are reported, never silently dropped', () => {
  const plan = planAttachments([f('big', 900), f('small', 50)], 500);
  assert.deepEqual(plan.attach.map((x) => x.id), ['small']);
  assert.deepEqual(plan.tooLarge.map((x) => x.id), ['big']);
});

test('smallest first, so one big file cannot crowd out several small ones', () => {
  const plan = planAttachments([f('big', 600), f('a', 100), f('b', 100)], 700);
  assert.deepEqual(plan.attach.map((x) => x.id).sort(), ['a', 'b']);
  assert.deepEqual(plan.tooLarge.map((x) => x.id), ['big']);
});

test('a single file larger than the whole budget never attaches', () => {
  const plan = planAttachments([f('huge', 5000)], 1000);
  assert.equal(plan.attach.length, 0);
  assert.deepEqual(plan.tooLarge.map((x) => x.id), ['huge']);
});

test('no files yields empty lists rather than throwing', () => {
  const plan = planAttachments([], 1000);
  assert.deepEqual(plan.attach, []);
  assert.deepEqual(plan.tooLarge, []);
});

test('a zero budget attaches nothing and reports everything', () => {
  const plan = planAttachments([f('a', 1)], 0);
  assert.equal(plan.attach.length, 0);
  assert.equal(plan.tooLarge.length, 1);
});

test('every input file appears in exactly one output list', () => {
  const files = [f('a', 100), f('b', 900), f('c', 50)];
  const plan = planAttachments(files, 200);
  const seen = [...plan.attach, ...plan.tooLarge].map((x) => x.id).sort();
  assert.deepEqual(seen, ['a', 'b', 'c']);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd form-backend && node --test test/attachments.test.ts`
Expected: FAIL — cannot find module `#lib/attachments`.

- [ ] **Step 3: Write the implementation**

Create `form-backend/lib/attachments.ts`:

```ts
export type FileRef = {
  id: string;
  filename: string;
  contentType: string;
  size: number;
  path: string;
};

export type AttachmentPlan = {
  attach: FileRef[];
  tooLarge: FileRef[];
};

// Total attachment bytes per email. Stays under Mailgun's 25 MB and Brevo's
// lower limit, with headroom for base64 expansion.
export const MAX_ATTACH_MB_DEFAULT = 10;

/**
 * Decide which files fit the budget. Smallest first, so one large file cannot
 * crowd out several small ones. Files that do not fit are RETURNED, not dropped —
 * the caller names them in the email alongside their download links.
 */
export function planAttachments(files: FileRef[], budgetBytes: number): AttachmentPlan {
  const attach: FileRef[] = [];
  const tooLarge: FileRef[] = [];
  let used = 0;

  for (const file of [...(files || [])].sort((a, b) => a.size - b.size)) {
    if (used + file.size <= budgetBytes) {
      attach.push(file);
      used += file.size;
    } else {
      tooLarge.push(file);
    }
  }

  return { attach, tooLarge };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd form-backend && node --test test/attachments.test.ts`
Expected: PASS — 7 passing.

- [ ] **Step 5: Commit**

```bash
git add form-backend/lib/attachments.ts form-backend/test/attachments.test.ts
git commit -m "feat(form-backend): deterministic attachment budget"
```

---

### Task 3: Spam decisions

**Files:**
- Create: `form-backend/lib/spam.ts`, `form-backend/test/spam.test.ts`

**Interfaces:**
- Consumes: `evaluate`, `clientKey` from `#lib/throttle`.
- Produces:
  - `isHoneypotFilled(fields: Record<string, string>, honeypotName: string): boolean`
  - `controlFieldsFor(honeypotName: string): string[]`
  - `submitKey(formId: string, req: any): string`
  - `checkSubmitRate(conn: any, formId: string, req: any, max?: number): Promise<{ allowed: boolean; retryAfterSeconds: number }>`
  - `SUBMIT_RATE_DEFAULT = 30`, `SUBMIT_WINDOW_MS = 60 * 60 * 1000`

`controlFieldsFor` replaces the hardcoded `_gotcha` in `index.ts` and `lib/validation.ts`, so a form can rename its honeypot.

- [ ] **Step 1: Write the failing tests**

Create `form-backend/test/spam.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert';
import {
  isHoneypotFilled,
  controlFieldsFor,
  submitKey,
  checkSubmitRate,
  SUBMIT_RATE_DEFAULT,
} from '#lib/spam';

// --- honeypot ---

test('an empty honeypot is a human', () => {
  assert.equal(isHoneypotFilled({ _gotcha: '' }, '_gotcha'), false);
});

test('an absent honeypot is a human', () => {
  assert.equal(isHoneypotFilled({ name: 'Ada' }, '_gotcha'), false);
});

test('a whitespace-only honeypot is a human, not a bot', () => {
  // A stray space from an autofill must not discard a real submission.
  assert.equal(isHoneypotFilled({ _gotcha: '   ' }, '_gotcha'), false);
});

test('a filled honeypot is a bot', () => {
  assert.equal(isHoneypotFilled({ _gotcha: 'http://spam' }, '_gotcha'), true);
});

test('the honeypot name is configurable', () => {
  assert.equal(isHoneypotFilled({ website: 'x' }, 'website'), true);
  assert.equal(isHoneypotFilled({ website: 'x' }, '_gotcha'), false);
});

test('an unset honeypot name never flags anything', () => {
  assert.equal(isHoneypotFilled({ _gotcha: 'x' }, ''), false);
});

// --- control fields ---

test('control fields include the form-specific honeypot name', () => {
  const fields = controlFieldsFor('website');
  assert.ok(fields.includes('website'));
  assert.ok(fields.includes('_redirect'));
});

test('control fields do not duplicate when the honeypot is a standard name', () => {
  const fields = controlFieldsFor('_gotcha');
  assert.equal(fields.filter((f) => f === '_gotcha').length, 1);
});

// --- rate limit ---

test('submitKey separates forms so one busy form cannot throttle another', () => {
  const req = { headers: { 'x-forwarded-for': '203.0.113.5' } };
  assert.notEqual(submitKey('form-a', req), submitKey('form-b', req));
});

test('submitKey separates clients', () => {
  const a = submitKey('form-a', { headers: { 'x-forwarded-for': '203.0.113.5' } });
  const b = submitKey('form-a', { headers: { 'x-forwarded-for': '203.0.113.6' } });
  assert.notEqual(a, b);
});

function fakeConn() {
  const store = new Map<string, string>();
  return {
    async get(k: string) { return store.get(k); },
    async set(k: string, v: string) { store.set(k, v); },
    async del(k: string) { store.delete(k); },
  };
}

test('submissions are allowed up to the limit then refused', async () => {
  const conn = fakeConn();
  const req = { headers: { 'x-forwarded-for': '203.0.113.7' } };
  for (let i = 0; i < 3; i++) {
    assert.equal((await checkSubmitRate(conn, 'f1', req, 3)).allowed, true);
  }
  const blocked = await checkSubmitRate(conn, 'f1', req, 3);
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterSeconds > 0);
});

test('a throttle-store failure ALLOWS the submission', async () => {
  // A key-value outage must never take a customer's contact form offline.
  const broken = {
    async get() { throw new Error('kv down'); },
    async set() { throw new Error('kv down'); },
    async del() { throw new Error('kv down'); },
  };
  const d = await checkSubmitRate(broken, 'f1', { headers: {} }, 3);
  assert.equal(d.allowed, true);
});

test('the default limit is exported and positive', () => {
  assert.ok(SUBMIT_RATE_DEFAULT > 0);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd form-backend && node --test test/spam.test.ts`
Expected: FAIL — cannot find module `#lib/spam`.

- [ ] **Step 3: Write the implementation**

Create `form-backend/lib/spam.ts`:

```ts
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd form-backend && node --test test/spam.test.ts`
Expected: PASS — 13 passing.

- [ ] **Step 5: Commit**

```bash
git add form-backend/lib/spam.ts form-backend/test/spam.test.ts
git commit -m "feat(form-backend): honeypot verdict and submission rate limiting"
```

---

### Task 4: Notification email composition

**Files:**
- Create: `form-backend/lib/notify.ts`, `form-backend/test/notify.test.ts`

**Interfaces:**
- Consumes: `FileRef`, `AttachmentPlan` from `#lib/attachments`; `signFileToken` from `#lib/signed-links`.
- Produces:
  - `pickReplyTo(fields: Record<string,string>, defs: Array<{name: string; type: string}>): string | null`
  - `renderSubject(template: string, formName: string, fields: Record<string,string>): string`
  - `buildNotification(input: NotificationInput): { subject: string; text: string; replyTo: string | null }`
  - `type NotificationInput = { formName: string; subjectTemplate: string; fields: Record<string,string>; fieldDefs: Array<{name: string; type: string}>; meta: { created: string; ip: string; referer: string }; plan: AttachmentPlan; submissionId: string; baseUrl: string }`

Plain text only. A notification is read by the form owner, not marketed at them, and text sidesteps a class of escaping bugs on untrusted submission content.

- [ ] **Step 1: Write the failing tests**

Create `form-backend/test/notify.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert';
import { pickReplyTo, renderSubject, buildNotification } from '#lib/notify';
import type { FileRef } from '#lib/attachments';

const f = (id: string, size: number): FileRef => ({
  id, filename: `${id}.pdf`, contentType: 'application/pdf', size, path: `/uploads/${id}`,
});

// --- Reply-To selection ---

test('prefers a field whose schema type is email', () => {
  const got = pickReplyTo(
    { contact: 'ada@example.com', other: 'zz@example.com' },
    [{ name: 'other', type: 'text' }, { name: 'contact', type: 'email' }]
  );
  assert.equal(got, 'ada@example.com');
});

test('falls back to the first value that looks like an email when no schema says so', () => {
  const got = pickReplyTo({ name: 'Ada', whatever: 'ada@example.com' }, []);
  assert.equal(got, 'ada@example.com');
});

test('returns null when nothing resembles an email', () => {
  assert.equal(pickReplyTo({ name: 'Ada', note: 'hello' }, []), null);
});

test('ignores an email-typed field that is empty', () => {
  const got = pickReplyTo({ contact: '' }, [{ name: 'contact', type: 'email' }]);
  assert.equal(got, null);
});

// --- subject ---

test('renders the form name into the subject', () => {
  assert.equal(renderSubject('New submission: {{form}}', 'Contact', {}), 'New submission: Contact');
});

test('renders a submitted field into the subject', () => {
  assert.equal(renderSubject('From {{name}}', 'Contact', { name: 'Ada' }), 'From Ada');
});

test('an unknown placeholder renders empty rather than leaving braces', () => {
  assert.equal(renderSubject('X {{nope}} Y', 'Contact', {}), 'X  Y');
});

test('an empty template falls back to a usable subject', () => {
  assert.equal(renderSubject('', 'Contact', {}), 'New submission: Contact');
});

// --- body ---

const base = {
  formName: 'Contact',
  subjectTemplate: 'New submission: {{form}}',
  fields: { name: 'Ada', email: 'ada@example.com' },
  fieldDefs: [{ name: 'email', type: 'email' }],
  meta: { created: '2026-09-06T10:00:00.000Z', ip: '203.0.113.5', referer: 'https://example.com' },
  plan: { attach: [], tooLarge: [] },
  submissionId: 'sub-1',
  baseUrl: 'https://api.example.com',
};

test('the body lists every submitted field', () => {
  const out = buildNotification(base);
  assert.match(out.text, /name:\s*Ada/);
  assert.match(out.text, /email:\s*ada@example\.com/);
});

test('the body carries submission metadata', () => {
  const out = buildNotification(base);
  assert.match(out.text, /203\.0\.113\.5/);
  assert.match(out.text, /example\.com/);
});

test('attached files are listed', () => {
  const out = buildNotification({ ...base, plan: { attach: [f('cv', 100)], tooLarge: [] } });
  assert.match(out.text, /cv\.pdf/);
  assert.match(out.text, /attached/i);
});

test('files too large to attach are named, not silently omitted', () => {
  const out = buildNotification({ ...base, plan: { attach: [], tooLarge: [f('huge', 99999999)] } });
  assert.match(out.text, /huge\.pdf/);
  assert.match(out.text, /too large/i);
});

test('every file gets a download link regardless of whether it attached', () => {
  process.env.JWT_SECRET = 'test-secret';
  const out = buildNotification({
    ...base,
    plan: { attach: [f('a', 10)], tooLarge: [f('b', 99999999)] },
  });
  const links = out.text.match(/https:\/\/api\.example\.com\/files\//g) || [];
  assert.equal(links.length, 2);
});

test('Reply-To is surfaced on the result', () => {
  const out = buildNotification(base);
  assert.equal(out.replyTo, 'ada@example.com');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd form-backend && node --test test/notify.test.ts`
Expected: FAIL — cannot find module `#lib/notify`.

- [ ] **Step 3: Write the implementation**

Create `form-backend/lib/notify.ts`:

```ts
import { signFileToken } from '#lib/signed-links';
import type { AttachmentPlan } from '#lib/attachments';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type NotificationInput = {
  formName: string;
  subjectTemplate: string;
  fields: Record<string, string>;
  fieldDefs: Array<{ name: string; type: string }>;
  meta: { created: string; ip: string; referer: string };
  plan: AttachmentPlan;
  submissionId: string;
  baseUrl: string;
};

/**
 * Whose address to reply to. A schema-declared email field wins; otherwise the
 * first value that looks like an address. Deterministic so it can be tested.
 */
export function pickReplyTo(
  fields: Record<string, string>,
  defs: Array<{ name: string; type: string }>
): string | null {
  for (const def of defs || []) {
    if (def.type === 'email') {
      const v = (fields?.[def.name] || '').trim();
      if (EMAIL_RE.test(v)) return v;
    }
  }
  for (const v of Object.values(fields || {})) {
    const s = String(v || '').trim();
    if (EMAIL_RE.test(s)) return s;
  }
  return null;
}

export function renderSubject(
  template: string,
  formName: string,
  fields: Record<string, string>
): string {
  const t = template && template.trim() ? template : 'New submission: {{form}}';
  return t.replace(/\{\{(\w+)\}\}/g, (_m, key) => {
    if (key === 'form') return formName;
    return fields?.[key] ?? '';
  });
}

export function buildNotification(input: NotificationInput): {
  subject: string;
  text: string;
  replyTo: string | null;
} {
  const lines: string[] = [];

  for (const [key, value] of Object.entries(input.fields || {})) {
    lines.push(`${key}: ${value}`);
  }

  lines.push('');
  lines.push('--- submission ---');
  lines.push(`received: ${input.meta.created}`);
  if (input.meta.ip) lines.push(`ip: ${input.meta.ip}`);
  if (input.meta.referer) lines.push(`referer: ${input.meta.referer}`);

  const all = [...input.plan.attach, ...input.plan.tooLarge];
  if (all.length) {
    lines.push('');
    lines.push('--- files ---');
    for (const file of input.plan.attach) {
      lines.push(`${file.filename} (attached)`);
      lines.push(`  ${input.baseUrl}/files/${signFileToken(input.submissionId, file.id)}`);
    }
    for (const file of input.plan.tooLarge) {
      lines.push(`${file.filename} (too large to attach)`);
      lines.push(`  ${input.baseUrl}/files/${signFileToken(input.submissionId, file.id)}`);
    }
  }

  return {
    subject: renderSubject(input.subjectTemplate, input.formName, input.fields),
    text: lines.join('\n'),
    replyTo: pickReplyTo(input.fields, input.fieldDefs),
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd form-backend && node --test test/notify.test.ts`
Expected: PASS — 14 passing.

- [ ] **Step 5: Commit**

```bash
git add form-backend/lib/notify.ts form-backend/test/notify.test.ts
git commit -m "feat(form-backend): notification email composition"
```

---

### Task 5: Provider layer with attachments

**Files:**
- Create: `form-backend/lib/providers/types.ts`, `form-backend/lib/providers/mailgun.ts`, `form-backend/lib/providers/brevo.ts`, `form-backend/lib/providers/index.ts`, `form-backend/test/providers.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type Attachment = { filename: string; contentType: string; content: Buffer }`
  - `type EmailMessage = { to: string; subject: string; text: string; fromEmail: string; fromName: string; replyTo?: string; attachments?: Attachment[] }`
  - `type SendResult = { ok: boolean; providerId?: string | null; statusCode?: number; retryAfter?: number; error?: string }`
  - `interface EmailProvider { send(msg: EmailMessage): Promise<SendResult> }`
  - `sendEmail(msg: EmailMessage): Promise<SendResult>`

Both providers take an injectable `fetch` so their request shape is testable without network access.

- [ ] **Step 1: Write the failing tests**

Create `form-backend/test/providers.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert';
import { makeBrevo } from '#lib/providers/brevo';
import { makeMailgun } from '#lib/providers/mailgun';

const msg = {
  to: 'owner@example.com',
  subject: 'New submission: Contact',
  text: 'name: Ada',
  fromEmail: 'forms@example.com',
  fromName: 'Forms',
  replyTo: 'ada@example.com',
  attachments: [
    { filename: 'cv.pdf', contentType: 'application/pdf', content: Buffer.from('PDFBYTES') },
  ],
};

function capture(status = 200, body: any = { messageId: 'abc' }) {
  const calls: any[] = [];
  const fakeFetch = async (url: string, init: any) => {
    calls.push({ url, init });
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: () => null },
      json: async () => body,
      text: async () => JSON.stringify(body),
    } as any;
  };
  return { calls, fakeFetch };
}

// --- Brevo ---

test('brevo sends attachments as base64 with a name', async () => {
  const { calls, fakeFetch } = capture();
  await makeBrevo('key', fakeFetch).send(msg);
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.attachment[0].name, 'cv.pdf');
  assert.equal(Buffer.from(body.attachment[0].content, 'base64').toString(), 'PDFBYTES');
});

test('brevo sets replyTo', async () => {
  const { calls, fakeFetch } = capture();
  await makeBrevo('key', fakeFetch).send(msg);
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.replyTo.email, 'ada@example.com');
});

test('brevo omits the attachment key entirely when there are none', async () => {
  const { calls, fakeFetch } = capture();
  await makeBrevo('key', fakeFetch).send({ ...msg, attachments: [] });
  const body = JSON.parse(calls[0].init.body);
  assert.equal('attachment' in body, false);
});

test('brevo reports a 4xx as a permanent failure', async () => {
  const { fakeFetch } = capture(400, { message: 'bad' });
  const r = await makeBrevo('key', fakeFetch).send(msg);
  assert.equal(r.ok, false);
  assert.equal(r.statusCode, 400);
});

// --- Mailgun ---

test('mailgun sends multipart including the attachment bytes', async () => {
  const { calls, fakeFetch } = capture();
  await makeMailgun('key', 'mg.example.com', false, fakeFetch).send(msg);
  const form = calls[0].init.body;
  assert.ok(typeof form.getAll === 'function', 'expected FormData');
  assert.equal(form.get('subject'), 'New submission: Contact');
  assert.equal(form.get('h:Reply-To'), 'ada@example.com');
  assert.equal(form.getAll('attachment').length, 1);
});

test('mailgun reports a 5xx as retryable', async () => {
  const { fakeFetch } = capture(503, { message: 'oops' });
  const r = await makeMailgun('key', 'mg.example.com', false, fakeFetch).send(msg);
  assert.equal(r.ok, false);
  assert.equal(r.statusCode, 503);
});

test('both providers succeed on 200', async () => {
  const a = capture(); const b = capture();
  assert.equal((await makeBrevo('k', a.fakeFetch).send(msg)).ok, true);
  assert.equal((await makeMailgun('k', 'd', false, b.fakeFetch).send(msg)).ok, true);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd form-backend && node --test test/providers.test.ts`
Expected: FAIL — cannot find module `#lib/providers/brevo`.

- [ ] **Step 3: Write `form-backend/lib/providers/types.ts`**

```ts
// A pluggable email provider. Add one by implementing EmailProvider and
// registering it in ./index.ts. Nothing outside this directory knows which
// provider is active.

export type Attachment = {
  filename: string;
  contentType: string;
  content: Buffer;
};

export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  fromEmail: string;
  fromName: string;
  replyTo?: string;
  attachments?: Attachment[];
};

export type SendResult = {
  ok: boolean;
  providerId?: string | null;
  statusCode?: number;   // drives the worker's retry logic
  retryAfter?: number;   // seconds, from a Retry-After header when present
  error?: string;
};

export interface EmailProvider {
  send(msg: EmailMessage): Promise<SendResult>;
}
```

- [ ] **Step 4: Write `form-backend/lib/providers/brevo.ts`**

```ts
import type { EmailMessage, EmailProvider, SendResult } from '#lib/providers/types';

const ENDPOINT = 'https://api.brevo.com/v3/smtp/email';

export function makeBrevo(apiKey: string, fetchImpl: any = fetch): EmailProvider {
  return {
    async send(msg: EmailMessage): Promise<SendResult> {
      const body: any = {
        sender: { email: msg.fromEmail, name: msg.fromName },
        to: [{ email: msg.to }],
        subject: msg.subject,
        textContent: msg.text,
      };
      if (msg.replyTo) body.replyTo = { email: msg.replyTo };
      if (msg.attachments && msg.attachments.length) {
        body.attachment = msg.attachments.map((a) => ({
          name: a.filename,
          content: a.content.toString('base64'),
        }));
      }

      try {
        const res = await fetchImpl(ENDPOINT, {
          method: 'POST',
          headers: { 'api-key': apiKey, 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify(body),
        });
        const payload: any = await res.json().catch(() => ({}));
        if (!res.ok) {
          return {
            ok: false,
            statusCode: res.status,
            retryAfter: Number(res.headers?.get?.('retry-after')) || undefined,
            error: payload?.message || `Brevo responded ${res.status}`,
          };
        }
        return { ok: true, providerId: payload?.messageId ?? null, statusCode: res.status };
      } catch (err: any) {
        // Network-level failure — retryable.
        return { ok: false, error: err.message };
      }
    },
  };
}
```

- [ ] **Step 5: Write `form-backend/lib/providers/mailgun.ts`**

```ts
import type { EmailMessage, EmailProvider, SendResult } from '#lib/providers/types';

export function makeMailgun(
  apiKey: string,
  domain: string,
  eu: boolean,
  fetchImpl: any = fetch
): EmailProvider {
  const host = eu ? 'https://api.eu.mailgun.net' : 'https://api.mailgun.net';
  return {
    async send(msg: EmailMessage): Promise<SendResult> {
      const form = new FormData();
      form.append('from', `${msg.fromName} <${msg.fromEmail}>`);
      form.append('to', msg.to);
      form.append('subject', msg.subject);
      form.append('text', msg.text);
      if (msg.replyTo) form.append('h:Reply-To', msg.replyTo);
      for (const a of msg.attachments || []) {
        form.append('attachment', new Blob([a.content], { type: a.contentType }), a.filename);
      }

      try {
        const res = await fetchImpl(`${host}/v3/${domain}/messages`, {
          method: 'POST',
          headers: { authorization: 'Basic ' + Buffer.from(`api:${apiKey}`).toString('base64') },
          body: form,
        });
        const payload: any = await res.json().catch(() => ({}));
        if (!res.ok) {
          return {
            ok: false,
            statusCode: res.status,
            retryAfter: Number(res.headers?.get?.('retry-after')) || undefined,
            error: payload?.message || `Mailgun responded ${res.status}`,
          };
        }
        return { ok: true, providerId: payload?.id ?? null, statusCode: res.status };
      } catch (err: any) {
        return { ok: false, error: err.message };
      }
    },
  };
}
```

- [ ] **Step 6: Write `form-backend/lib/providers/index.ts`**

```ts
import { makeBrevo } from '#lib/providers/brevo';
import { makeMailgun } from '#lib/providers/mailgun';
import type { EmailMessage, EmailProvider, SendResult } from '#lib/providers/types';

function selected(): EmailProvider {
  const name = (process.env.EMAIL_PROVIDER || 'brevo').toLowerCase();
  if (name === 'mailgun') {
    return makeMailgun(
      process.env.MAILGUN_API_KEY || '',
      process.env.MAILGUN_DOMAIN || '',
      String(process.env.MAILGUN_EU || 'false') === 'true'
    );
  }
  return makeBrevo(process.env.BREVO_API_KEY || '');
}

export async function sendEmail(msg: EmailMessage): Promise<SendResult> {
  return selected().send(msg);
}

export type { EmailMessage, EmailProvider, SendResult };
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `cd form-backend && node --test test/providers.test.ts`
Expected: PASS — 7 passing.

- [ ] **Step 8: Commit**

```bash
git add form-backend/lib/providers form-backend/test/providers.test.ts
git commit -m "feat(form-backend): email provider layer with attachment support"
```

---

### Task 6: Wire spam defence into the submit endpoint

**Files:**
- Modify: `form-backend/index.ts`, `form-backend/lib/validation.ts`, `form-backend/lib/forms.ts`

**Interfaces:**
- Consumes: `isHoneypotFilled`, `controlFieldsFor`, `checkSubmitRate` from `#lib/spam`.
- Produces: submissions stored with `status: 'spam'` and `spam.reasons: ['honeypot']`; a 429 with `Retry-After` when rate limited.

- [ ] **Step 1: Make `validateFields` take the control-field list**

In `form-backend/lib/validation.ts`, replace the hardcoded set with a parameter so a form can rename its honeypot. Change the `CONTROL_FIELDS` constant to a default and add a parameter:

```ts
const DEFAULT_CONTROL_FIELDS = ['_gotcha', '_redirect', '_subject', '_next'];
```

and extend the signature to:

```ts
export function validateFields(
  defs: FieldDef[],
  data: Record<string, string>,
  strict = false,
  fileFields: string[] = [],
  controlFields: string[] = DEFAULT_CONTROL_FIELDS
): ValidationResult {
```

Inside the strict-mode block, use `new Set(controlFields)` instead of the module-level constant. Every existing call keeps working because the parameter defaults.

- [ ] **Step 2: Run the existing validation tests to confirm nothing broke**

Run: `cd form-backend && node --test test/validation.test.ts`
Expected: PASS — 23 passing, unchanged.

- [ ] **Step 3: Unlock `honeypot` in the forms PATCH allowlist**

In `form-backend/index.ts`, the allowlist comment says `honeypot` and `retentionDays` are both locked. Now that the honeypot is enforced, add `'honeypot'` back to the `allowed` array and update the comment to:

```ts
  // `retentionDays` is deliberately NOT writable: no purge job enforces it, and a
  // knob that silently does nothing could be mistaken for a retention guarantee.
  // `honeypot` IS writable now that the submit endpoint enforces it.
```

- [ ] **Step 4: Add the rate limit and honeypot checks to the submit handler**

In `form-backend/index.ts`, add the import:

```ts
import { isHoneypotFilled, controlFieldsFor, checkSubmitRate } from '#lib/spam';
```

In the `app.all('/f/:formId', ...)` handler, **after** the origin-allowlist check and **before** validation, insert:

```ts
    // Rate limit AFTER parsing: parseBody must remain the first await (the platform
    // consumes the request stream once a handler yields). A flood therefore still
    // costs one buffered body each; the limit protects the database, the queue and
    // the owner's inbox rather than raw bandwidth.
    const conn = await Datastore.open();
    const rate = await checkSubmitRate(conn, form.uuid, req, submitRateLimit());
    if (!rate.allowed) {
      res.set('Retry-After', String(rate.retryAfterSeconds));
      return fail(429, 'Too many submissions. Please try again later.');
    }
```

Then, immediately before `validateFields`, insert the honeypot check:

```ts
    // A filled honeypot means a bot. Store it, mark it spam, answer with an ordinary
    // success, and never enqueue: telling a bot it was detected only helps it adapt,
    // and storing rather than dropping means a false positive is recoverable from the
    // inbox instead of silently lost.
    const isSpam = isHoneypotFilled(parsed.fields, form.honeypot || '');
```

Add the helper near `maxUploadBytes()`:

```ts
function submitRateLimit(): number {
  return Number(process.env.SUBMIT_RATE_LIMIT) || 30;
}
```

Pass the form's control fields to validation:

```ts
    const check = validateFields(
      form.fields || [],
      parsed.fields,
      form.strict,
      parsed.files.filter((f) => f.content.length > 0).map((f) => f.field),
      controlFieldsFor(form.honeypot || '')
    );
```

Strip control fields dynamically instead of the hardcoded list:

```ts
    for (const key of controlFieldsFor(form.honeypot || '')) delete data[key];
```

Set the stored status and skip the enqueue for spam:

```ts
      status: isSpam ? 'spam' : 'new',
      spam: { score: isSpam ? 100 : 0, reasons: isSpam ? ['honeypot'] : [] },
```

and guard the enqueue that Task 7 adds — for now, note in a comment that spam is never enqueued.

- [ ] **Step 5: Deploy and verify the behaviour live**

Run:
```bash
cd form-backend && coho deploy && sleep 3
U=$(coho info | grep -oE 'https://[a-z0-9-]+\.codehooks\.io' | head -1)
# log in and create a form (see README "Verify your deployment")
```
Then confirm: a submission with the honeypot filled returns the SAME status as a clean one (200 for JSON, 302 for a form post), and appears in the inbox with `status: "spam"`. Confirm a clean submission is still `new`. Confirm exceeding `SUBMIT_RATE_LIMIT` returns 429 with `Retry-After`.

- [ ] **Step 6: Run the full unit suite**

Run: `cd form-backend && node --test test/*.test.ts`
Expected: PASS — all previously passing tests plus the new ones.

- [ ] **Step 7: Commit**

```bash
git add form-backend/index.ts form-backend/lib/validation.ts
git commit -m "feat(form-backend): enforce honeypot and rate-limit submissions"
```

---

### Task 7: The outbox and the email channel

**Files:**
- Create: `form-backend/lib/channels/types.ts`, `form-backend/lib/channels/email.ts`
- Modify: `form-backend/index.ts`, `form-backend/lib/forms.ts`

**Interfaces:**
- Consumes: `planAttachments`, `MAX_ATTACH_MB_DEFAULT` (`#lib/attachments`); `buildNotification` (`#lib/notify`); `sendEmail` (`#lib/providers`); `signFileToken` (`#lib/signed-links`).
- Produces:
  - `interface Channel { name: string; targets(form: FormDoc): string[]; deliver(ctx: DeliveryContext): Promise<SendResult> }`
  - `type DeliveryContext = { form: FormDoc; submission: any; target: string; baseUrl: string }`
  - `emailChannel: Channel`

- [ ] **Step 1: Write `form-backend/lib/channels/types.ts`**

```ts
import type { FormDoc } from '#lib/forms';
import type { SendResult } from '#lib/providers/types';

export type DeliveryContext = {
  form: FormDoc;
  submission: any;
  target: string;
  baseUrl: string;
};

// One interface for every notification channel. All retry, backoff and
// transient-vs-permanent logic lives in the `deliver` worker, never here — so
// adding a channel is one file with no delivery logic to duplicate.
export interface Channel {
  name: string;
  /** Recipients for this form, or [] when the channel is not configured. */
  targets(form: FormDoc): string[];
  deliver(ctx: DeliveryContext): Promise<SendResult>;
}
```

- [ ] **Step 2: Write `form-backend/lib/channels/email.ts`**

```ts
import { filestore } from 'codehooks-js';
import { planAttachments, MAX_ATTACH_MB_DEFAULT } from '#lib/attachments';
import { buildNotification } from '#lib/notify';
import { sendEmail } from '#lib/providers';
import type { Channel, DeliveryContext } from '#lib/channels/types';
import type { FormDoc } from '#lib/forms';
import type { SendResult } from '#lib/providers/types';
import type { Attachment } from '#lib/providers/types';

function budgetBytes(): number {
  return (Number(process.env.MAX_ATTACH_MB) || MAX_ATTACH_MB_DEFAULT) * 1024 * 1024;
}

export const emailChannel: Channel = {
  name: 'email',

  targets(form: FormDoc): string[] {
    const cfg: any = (form as any).notify?.email;
    if (!cfg?.enabled) return [];
    return (cfg.recipients || []).filter((r: string) => typeof r === 'string' && r.includes('@'));
  },

  async deliver(ctx: DeliveryContext): Promise<SendResult> {
    const cfg: any = (ctx.form as any).notify?.email || {};
    const files = (ctx.submission.files || []).map((f: any) => ({
      id: f.id, filename: f.filename, contentType: f.contentType, size: f.size, path: f.path,
    }));

    const plan = cfg.attachFiles === false
      ? { attach: [], tooLarge: files }
      : planAttachments(files, budgetBytes());

    const note = buildNotification({
      formName: ctx.form.name,
      subjectTemplate: cfg.subjectTemplate || '',
      fields: ctx.submission.data || {},
      fieldDefs: (ctx.form.fields || []) as any,
      meta: {
        created: ctx.submission.created,
        ip: ctx.submission.meta?.ip || '',
        referer: ctx.submission.meta?.referer || '',
      },
      plan,
      submissionId: ctx.submission._id,
      baseUrl: ctx.baseUrl,
    });

    const attachments: Attachment[] = [];
    for (const file of plan.attach) {
      try {
        const content = await filestore.readFileAsBuffer(file.path);
        attachments.push({ filename: file.filename, contentType: file.contentType, content });
      } catch (err: any) {
        // A missing file must not lose the whole notification — the link is still in
        // the body, so send what we have.
        console.error('Attachment unreadable, sending without it:', file.path, err.message);
      }
    }

    return sendEmail({
      to: ctx.target,
      subject: note.subject,
      text: note.text,
      fromEmail: process.env.FROM_EMAIL || 'forms@example.com',
      fromName: process.env.FROM_NAME || 'Form Backend',
      replyTo: note.replyTo || undefined,
      attachments,
    });
  },
};
```

- [ ] **Step 3: Add `notify` to the form defaults**

In `form-backend/lib/forms.ts`, add to the `FormDoc` type:

```ts
  notify: {
    email: {
      enabled: boolean;
      recipients: string[];
      subjectTemplate: string;
      attachFiles: boolean;
    };
  };
```

and to `defaultForm`:

```ts
    notify: {
      email: { enabled: false, recipients: [], subjectTemplate: '', attachFiles: true },
    },
```

Add `'notify'` to the PATCH allowlist in `index.ts`.

- [ ] **Step 4: Register the workers and the redrive job in `index.ts`**

Add imports:

```ts
import { emailChannel } from '#lib/channels/email';
import type { Channel } from '#lib/channels/types';
```

Add near the other registrations:

```ts
const CHANNELS: Channel[] = [emailChannel];
const MAX_SEND_ATTEMPTS = 5;

// Fan out one deliveries row per channel target, then enqueue a deliver task each.
app.worker('processSubmission', async (req, res) => {
  const { submissionId } = req.body.payload;
  const conn = await Datastore.open();
  const submission: any = await conn.findOneOrNull('submissions', submissionId);
  if (!submission || submission.status === 'spam') return res.end();

  const form = await getFormByUuid(submission.formId);
  if (!form) return res.end();

  for (const channel of CHANNELS) {
    for (const target of channel.targets(form)) {
      const row = await conn.insertOne('deliveries', {
        submissionId, formId: submission.formId, channel: channel.name, target,
        status: 'pending', attempts: 0, lastError: null, lastAttemptAt: null,
        created: new Date().toISOString(), sentAt: null,
      });
      await conn.enqueue('deliver', { deliveryId: (row as any)._id });
    }
  }
  res.end();
});

// All retry logic lives here, so channels stay simple adapters.
app.worker('deliver', async (req, res) => {
  const { deliveryId } = req.body.payload;
  const conn = await Datastore.open();
  const row: any = await conn.findOneOrNull('deliveries', deliveryId);
  if (!row || row.status === 'sent' || row.status === 'skipped') return res.end();

  const channel = CHANNELS.find((c) => c.name === row.channel);
  const submission: any = await conn.findOneOrNull('submissions', row.submissionId);
  const form = submission ? await getFormByUuid(submission.formId) : null;
  if (!channel || !submission || !form) {
    await conn.updateOne('deliveries', deliveryId, { $set: { status: 'skipped' } });
    return res.end();
  }

  const result = await channel.deliver({
    form, submission, target: row.target, baseUrl: resolveBaseUrl(req),
  });

  const attempts = (row.attempts || 0) + 1;
  if (result.ok) {
    await conn.updateOne('deliveries', deliveryId, {
      $set: { status: 'sent', attempts, sentAt: new Date().toISOString(), lastError: null },
    });
  } else {
    const permanent = result.statusCode && result.statusCode >= 400 && result.statusCode < 500 && result.statusCode !== 429;
    const exhausted = attempts >= MAX_SEND_ATTEMPTS;
    await conn.updateOne('deliveries', deliveryId, {
      $set: {
        status: permanent || exhausted ? 'failed' : 'pending',
        attempts,
        lastError: result.error || null,
        lastAttemptAt: new Date().toISOString(),
      },
    });
  }
  res.end();
});

// Re-drive anything still pending. The initial enqueue happens immediately, so
// this only picks up transient failures.
app.job('0 * * * *', async (req, res) => {
  const conn = await Datastore.open();
  await conn.enqueueFromQuery(
    'deliveries',
    { status: 'pending', attempts: { $lt: MAX_SEND_ATTEMPTS } },
    'deliver',
    { limit: 1000 }
  );
  res.end();
});
```

Add a `resolveBaseUrl(req)` helper near the other helpers:

```ts
function resolveBaseUrl(req: any): string {
  const configured = process.env.BASE_URL;
  if (configured) return configured.replace(/\/+$/, '');
  const proto = req?.headers?.['x-forwarded-proto'] || 'https';
  const host = req?.headers?.['x-forwarded-host'] || req?.headers?.host;
  return host ? `${proto}://${host}` : '';
}
```

- [ ] **Step 5: Enqueue `processSubmission` from the submit handler**

In the submit handler, after the submission is inserted and the form stats are updated, and **only when not spam**:

```ts
    if (!isSpam) {
      await conn.enqueue('processSubmission', { submissionId: (submission as any)._id });
    }
```

- [ ] **Step 6: Run the full unit suite and compile**

Run:
```bash
cd form-backend && node --test test/*.test.ts && coho verify
```
Expected: all tests pass; `OK 🙌`.

- [ ] **Step 7: Commit**

```bash
git add form-backend/lib/channels form-backend/lib/forms.ts form-backend/index.ts
git commit -m "feat(form-backend): delivery outbox and email channel"
```

---

### Task 8: The signed download route

**Files:**
- Modify: `form-backend/index.ts`

**Interfaces:**
- Consumes: `verifyFileToken` from `#lib/signed-links`.
- Produces: `GET /files/:token`, public, serving one file.

- [ ] **Step 1: Add the route**

Add the import:

```ts
import { verifyFileToken } from '#lib/signed-links';
```

Add the auth bypass alongside the others:

```ts
app.auth('/files/*', (req, res, next) => next());
```

Add the route before `export default app.init();`:

```ts
// Public, token-scoped file download for links in notification emails. The admin
// route needs a session cookie, which an email cannot carry.
//
// The token grants ONE file and expires, so a leaked email exposes those files
// until exp rather than forever. The response is still attachment + nosniff,
// because the bytes are attacker-supplied.
app.get('/files/:token', async (req, res) => {
  const claims = verifyFileToken(req.params.token);
  if (!claims) return res.status(404).json({ ok: false, error: 'Link is invalid or has expired' });

  const conn = await Datastore.open();
  const row: any = await conn.findOneOrNull('submissions', claims.sid);
  if (!row) return res.status(404).json({ ok: false, error: 'File not found' });
  const file = (row.files || []).find((f: any) => f.id === claims.fid);
  if (!file) return res.status(404).json({ ok: false, error: 'File not found' });

  // Obtain the stream BEFORE writing headers: once they are flushed, a failure
  // would reach the client as a misleading 200 with an error body.
  let stream: any;
  try {
    stream = await filestore.getReadStream(file.path);
  } catch (err: any) {
    console.error('Signed download error:', err.message);
    return res.status(404).json({ ok: false, error: 'File not found' });
  }

  res.set('x-content-type-options', 'nosniff');
  res.set('content-type', file.contentType || 'application/octet-stream');
  res.set('content-disposition', `attachment; filename="${String(file.filename).replace(/["\r\n\\]/g, '')}"`);

  // The platform's stream has no .pipe(); this matches codehooks-js's own app.static.
  stream
    .on('data', (buf: any) => res.write(buf, 'buffer'))
    .on('end', () => res.end())
    .on('error', (err: any) => {
      console.error('Signed download stream error:', err.message);
      res.end();
    });
});
```

- [ ] **Step 2: Deploy and verify**

Run:
```bash
cd form-backend && coho deploy && sleep 3
```
Then, using a submission that has a file, mint a link by triggering a notification (Task 9) or by reading the URL out of the stored delivery, and confirm:
- the link downloads the file **byte-identically** (compare md5 against the uploaded file)
- the response carries `content-disposition: attachment` and `x-content-type-options: nosniff`
- a tampered token returns 404
- a token for a deleted submission returns 404

- [ ] **Step 3: Run the full unit suite**

Run: `cd form-backend && node --test test/*.test.ts`

- [ ] **Step 4: Commit**

```bash
git add form-backend/index.ts
git commit -m "feat(form-backend): signed download route for email links"
```

---

### Task 9: Live verification against Brevo

**Files:**
- Modify: none expected. Fix whatever this surfaces.

This is the acceptance test. Unit tests prove the provider request is correctly *shaped*; only this proves an email actually **arrives** with the attachment intact.

**Prerequisite — the operator must set these; do NOT invent values:**

```bash
coho set-env EMAIL_PROVIDER brevo
coho set-env BREVO_API_KEY '<the key>' --encrypted
coho set-env FROM_EMAIL '<a sender verified in Brevo>'
coho set-env FROM_NAME 'Form Backend'
coho set-env BASE_URL '<the deploy URL>'
coho deploy
```

`FROM_EMAIL` must be a sender Brevo has verified, or every send fails with a 4xx and the delivery row goes straight to `failed`.

- [ ] **Step 1: Configure a form to notify**

```bash
curl -s -b /tmp/jar -X PATCH $U/admin/api/forms/<form _id> \
  -H 'content-type: application/json' \
  -d '{"notify":{"email":{"enabled":true,"recipients":["<your address>"],"subjectTemplate":"New submission: {{form}}","attachFiles":true}}}'
```

- [ ] **Step 2: Submit with a file attached**

```bash
printf 'hello from the acceptance test' > /tmp/accept.txt
curl -s -o /dev/null -w '%{http_code}\n' -X POST $U/f/$FORM \
  -F 'name=Ada Lovelace' -F 'email=ada@example.com' -F 'upload=@/tmp/accept.txt'
```

- [ ] **Step 3: Confirm the delivery row reached `sent`**

```bash
sleep 10
curl -s -b /tmp/jar "$U/admin/api/submissions/<submission _id>/deliveries"
```
Expected: one row, `channel: "email"`, `status: "sent"`, a non-null `providerId`.

If it is `failed`, read `lastError` — a 401 means the API key, a 400 usually means `FROM_EMAIL` is not a verified Brevo sender.

- [ ] **Step 4: Check the actual inbox**

Confirm, in the receiving mailbox:
- the email arrived, with the expected subject
- **the attachment is present and opens** with the right content
- **replying goes to `ada@example.com`**, not to `FROM_EMAIL`
- the download link in the body works and returns the same bytes

- [ ] **Step 5: Confirm spam never emails**

Submit with the honeypot filled, wait, and confirm **no delivery row exists** for that submission and **no email arrives**. This is the property the whole release depends on.

```bash
curl -s -o /dev/null -X POST $U/f/$FORM -d 'name=Bot&_gotcha=filled'
```

- [ ] **Step 6: Confirm a provider failure retries rather than losing the email**

Temporarily set a bad key, submit, confirm the row goes `pending` with an incremented `attempts` rather than `failed`, then restore the key and confirm the hourly redrive (or a manual `POST /admin/api/deliveries/:id/retry`) delivers it.

- [ ] **Step 7: Record the results**

Update `form-backend/README.md` with a "Notifications" section covering the env vars, the per-form `notify.email` settings, the attachment cap, and the fact that `FROM_EMAIL` must be a verified sender. Add a CHANGELOG entry.

- [ ] **Step 8: Commit**

```bash
git add form-backend/README.md CHANGELOG.md
git commit -m "docs(form-backend): notification configuration and Brevo setup"
```

---

### Task 10: Form snippet

**Files:**
- Create: `form-backend/lib/snippet.ts`, `form-backend/test/snippet.test.ts`
- Modify: `form-backend/index.ts`

**Interfaces:**
- Consumes: `FormDoc` from `#lib/forms`.
- Produces:
  - `buildSnippet(form: FormDoc, baseUrl: string): string`
  - `GET /admin/api/forms/:id/snippet` returning `{ ok: true, snippet: string }`

The snippet reflects the form's actual field schema, so a customer pastes working markup rather than hand-assembling an action URL. It was listed in the original spec's API surface and never built.

- [ ] **Step 1: Write the failing tests**

Create `form-backend/test/snippet.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert';
import { buildSnippet } from '#lib/snippet';

const form: any = {
  uuid: 'abc-123',
  name: 'Contact',
  honeypot: '_gotcha',
  fields: [],
};

test('the action points at this form endpoint', () => {
  const html = buildSnippet(form, 'https://api.example.com');
  assert.match(html, /action="https:\/\/api\.example\.com\/f\/abc-123"/);
});

test('it posts as multipart so file inputs work', () => {
  const html = buildSnippet(form, 'https://api.example.com');
  assert.match(html, /method="POST"/);
  assert.match(html, /enctype="multipart\/form-data"/);
});

test('it always includes the honeypot, hidden and untabbable', () => {
  const html = buildSnippet(form, 'https://api.example.com');
  assert.match(html, /name="_gotcha"/);
  assert.match(html, /display:none/);
  assert.match(html, /tabindex="-1"/);
});

test('the honeypot uses the form-configured name', () => {
  const html = buildSnippet({ ...form, honeypot: 'website' }, 'https://api.example.com');
  assert.match(html, /name="website"/);
  assert.ok(!html.includes('name="_gotcha"'));
});

test('a schema-less form still yields a usable starter form', () => {
  const html = buildSnippet(form, 'https://api.example.com');
  assert.match(html, /name="name"/);
  assert.match(html, /name="email"/);
  assert.match(html, /<button/);
});

test('declared fields are rendered with the right input types', () => {
  const html = buildSnippet(
    { ...form, fields: [
      { name: 'email', type: 'email', required: true },
      { name: 'message', type: 'textarea' },
      { name: 'cv', type: 'file' },
    ] },
    'https://api.example.com'
  );
  assert.match(html, /<input[^>]*type="email"[^>]*name="email"[^>]*required/);
  assert.match(html, /<textarea[^>]*name="message"/);
  assert.match(html, /<input[^>]*type="file"[^>]*name="cv"/);
});

test('a select renders its options', () => {
  const html = buildSnippet(
    { ...form, fields: [{ name: 'plan', type: 'select', options: ['free', 'pro'] }] },
    'https://api.example.com'
  );
  assert.match(html, /<select[^>]*name="plan"/);
  assert.match(html, /<option value="free">/);
});

test('field names are escaped so a crafted name cannot break out of the attribute', () => {
  const html = buildSnippet(
    { ...form, fields: [{ name: 'a" onfocus="alert(1)', type: 'text' }] },
    'https://api.example.com'
  );
  assert.ok(!html.includes('onfocus="alert(1)"'));
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd form-backend && node --test test/snippet.test.ts`
Expected: FAIL — cannot find module `#lib/snippet`.

- [ ] **Step 3: Write the implementation**

Create `form-backend/lib/snippet.ts`:

```ts
import type { FormDoc } from '#lib/forms';

// Field names come from an admin-set schema, but they land inside HTML attributes
// in markup a customer pastes into their own site. Escape them.
function attr(value: string): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

const INPUT_TYPE: Record<string, string> = {
  email: 'email',
  url: 'url',
  number: 'number',
  date: 'date',
  rating: 'number',
  phone: 'tel',
  file: 'file',
  text: 'text',
};

function renderField(def: any): string {
  const name = attr(def.name);
  const required = def.required ? ' required' : '';

  if (def.type === 'textarea') {
    return `  <label>${name}<br><textarea name="${name}"${required}></textarea></label>`;
  }
  if (def.type === 'select') {
    const opts = (def.options || [])
      .map((o: string) => `      <option value="${attr(o)}">${attr(o)}</option>`)
      .join('\n');
    return `  <label>${name}<br>\n    <select name="${name}"${required}>\n${opts}\n    </select>\n  </label>`;
  }
  const type = INPUT_TYPE[def.type] || 'text';
  return `  <label>${name}<br><input type="${type}" name="${name}"${required}></label>`;
}

/**
 * Ready-to-paste HTML for this form. Reflects the declared schema; falls back to a
 * sensible starter form when no schema is set (which is the default, since a
 * schema-less form accepts anything).
 */
export function buildSnippet(form: FormDoc, baseUrl: string): string {
  const action = `${String(baseUrl).replace(/\/+$/, '')}/f/${attr(form.uuid)}`;
  const honeypot = attr(form.honeypot || '_gotcha');

  const defs = (form.fields || []) as any[];
  const body = defs.length
    ? defs.map(renderField).join('\n\n')
    : [
        '  <label>name<br><input type="text" name="name" required></label>',
        '',
        '  <label>email<br><input type="email" name="email" required></label>',
        '',
        '  <label>message<br><textarea name="message"></textarea></label>',
      ].join('\n');

  return [
    `<form action="${action}" method="POST" enctype="multipart/form-data">`,
    body,
    '',
    '  <!-- Bots fill this in; people never see it. Leave it in. -->',
    `  <input name="${honeypot}" style="display:none" tabindex="-1" autocomplete="off" aria-hidden="true">`,
    '',
    '  <button type="submit">Send</button>',
    '</form>',
  ].join('\n');
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd form-backend && node --test test/snippet.test.ts`
Expected: PASS — 8 passing.

- [ ] **Step 5: Add the endpoint to `index.ts`**

Add the import and the route (it falls under the existing `/admin/api/*` auth hook):

```ts
import { buildSnippet } from '#lib/snippet';
```

```ts
app.get('/admin/api/forms/:id/snippet', async (req, res) => {
  const form = await resolveForm(req.params.id);
  if (!form) return res.status(404).json({ ok: false, error: 'Form not found' });
  res.json({ ok: true, snippet: buildSnippet(form, resolveBaseUrl(req)) });
});
```

- [ ] **Step 6: Deploy and verify**

Run: `cd form-backend && coho deploy && sleep 3`, then fetch the snippet for a real form with the admin cookie and confirm the action URL matches that form's uuid.

- [ ] **Step 7: Commit**

```bash
git add form-backend/lib/snippet.ts form-backend/test/snippet.test.ts form-backend/index.ts
git commit -m "feat(form-backend): generated copy-paste form snippet"
```

---

### Task 11: Setup page

**Files:**
- Create: `form-backend/public/index.html`
- Modify: `form-backend/index.ts`

**Interfaces:**
- Consumes: every `/admin/api/*` endpoint, plus `GET /admin/api/forms/:id/snippet`.
- Produces: a page at `/setup/` that takes a customer from deploy to a working form.

**This is a setup page, not the admin dashboard.** It does exactly four things: log in, create a form, show its endpoint and snippet, and configure notifications. It deliberately has no inbox, search, or submission browsing — email notifications make the emails the record, so that can wait for its own plan. Do not add those here.

- [ ] **Step 1: Serve the page**

In `form-backend/index.ts`, add the auth bypass with the others:

```ts
app.auth('/setup/*', (req, res, next) => next());
```

and, **after every API route** and before `export default app.init();`:

```ts
// The setup page is a static file. Everything it does goes through /admin/api/*,
// which requires the session cookie, so serving the page itself is not sensitive.
app.static({ route: '/setup', directory: '/public', default: 'index.html' });
```

- [ ] **Step 2: Write the page**

Create `form-backend/public/index.html` — a single self-contained file, no build step, no CDN dependencies. It must:

1. **Log in** — POST `/admin/login` with `{password}`; the cookie is set automatically. Show an error on 401, and a distinct message on 429 (rate limited) using the `Retry-After` header.
2. **List forms** — GET `/admin/api/forms`, showing each form's name and endpoint URL.
3. **Create a form** — POST `/admin/api/forms` with `{name}`.
4. **Show the snippet** — GET `/admin/api/forms/:id/snippet`, in a `<pre>` with a copy button.
5. **Configure notifications** — PATCH `/admin/api/forms/:id` with `notify.email` (`enabled`, `recipients` as a comma-separated field, `attachFiles`). Show whether `FROM_EMAIL`/provider env vars are configured by surfacing a warning if a test send fails.
6. **Configure the allowlist** — PATCH `allowedDomains`, with help text explaining that empty means any origin, and that matching is exact so `example.com` does not cover `www.example.com`.

Requirements on the page itself:
- Responsive down to mobile; visible keyboard focus; `prefers-reduced-motion` respected.
- Every fetch handles a non-2xx by showing the server's `error` field, never a silent failure.
- Escape all server-provided values before inserting into the DOM — form names are admin-set but the page should not model bad practice for people copying it.
- Match the visual language of the hosted `/thanks` page in `lib/pages.ts` so the template looks like one product.

- [ ] **Step 3: Deploy and walk the whole customer path**

Run: `cd form-backend && coho deploy && sleep 3`

Then, in a browser at `https://<your-space>.codehooks.io/setup/`, complete the entire journey without touching curl:
- log in with `ADMIN_PASSWORD`
- create a form
- copy the snippet, paste it into a local HTML file, open it, and submit with a file attached
- confirm the notification email arrives with the attachment
- set an allowlist entry and confirm a submission from a different origin is refused

- [ ] **Step 4: Confirm the page cannot be used without logging in**

With no cookie, confirm `/setup/` still loads (it is a static file) but every action fails with 401 and the page shows the login prompt rather than an empty dashboard.

- [ ] **Step 5: Run the full unit suite**

Run: `cd form-backend && node --test test/*.test.ts`

- [ ] **Step 6: Update the README**

Replace the curl-driven "Quick start" with the setup page as the primary path, keeping the curl calls as the API reference for people automating it.

- [ ] **Step 7: Commit**

```bash
git add form-backend/public form-backend/index.ts form-backend/README.md
git commit -m "feat(form-backend): setup page for form creation and notifications"
```

---

## Done when

- `npm test` passes, with unit coverage on signed links, the attachment budget, spam decisions, notification composition, and both providers.
- A submission produces an email that **arrives**, with the attachment intact and `Reply-To` pointing at the submitter.
- A honeypot submission is stored as spam, produces **no delivery row and no email**, and returns the same status a clean submission does.
- Exceeding the rate limit returns 429 with `Retry-After`.
- A signed link downloads the file byte-identically; a tampered or expired token returns 404.
- A provider failure leaves the delivery `pending` and the hourly job re-drives it.
- A new customer can go from `coho deploy` to a working form **entirely through the setup page**, without running a single curl command.
