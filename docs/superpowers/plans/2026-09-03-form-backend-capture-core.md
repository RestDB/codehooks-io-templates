# form-backend: Capture Core — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the submission-capture half of the `form-backend` template — a deployed backend that accepts JSON, urlencoded, and multipart form posts, validates them, stores files, and exposes a searchable submission inbox API with CSV export.

**Architecture:** A single Codehooks app. `index.ts` registers routes only; all logic lives in focused `lib/` modules. The submit endpoint does the fast path synchronously (parse, validate, store, respond) — notification delivery and spam scoring are deliberately absent here and arrive in Plan 3, so the pipeline stays simple until its foundations are tested.

**Tech Stack:** TypeScript, codehooks-js, Codehooks Datastore + filestore, `jsonwebtoken`, `node --test` for unit tests.

**Spec:** `docs/superpowers/specs/2026-09-02-form-backend-design.md`

**Follow-on plans:** Plan 2 (Admin UI), Plan 3 (Delivery & spam), Plan 4 (AI & docs). This plan covers none of their scope.

## Global Constraints

These apply to every task; they are not repeated per-task.

- **All code is TypeScript.** `package.json` sets `"main": "index.ts"`.
- **Node type-stripping compatible.** Unit tests run via `node --test test/*.test.ts` with no build step, so the code must avoid `enum`, `namespace`, parameter properties (`constructor(private x)`), and decorators. Use plain `type`/`interface` declarations only.
- **Ship our own `tsconfig.json`** with `"esModuleInterop": true`. The CLI generates one only when absent, so ours takes precedence. Without it, CommonJS default imports fail to compile (see RestDB/ndb-cli#96).
- **`@types/node` is a required devDependency** — without it `Buffer` is undefined to the type checker.
- **Every internal module is imported through the `#lib/*` subpath map** — from source and tests alike, e.g. `from '#lib/multipart'`. `package.json` declares `"imports": { "#lib/*": "./lib/*.ts" }` and `tsconfig.json` sets `"module": "esnext"` + `"moduleResolution": "bundler"` so TypeScript honours it.

  This is the only style that satisfies both toolchains at once, which was established by testing all four candidates:

  | Style | `coho verify` (ts-loader) | `node --test` |
  |---|---|---|
  | `'./multipart'` (extensionless) | OK | `ERR_MODULE_NOT_FOUND` |
  | `'./multipart.ts'` | `TS5097` | passes |
  | `'./multipart.ts'` + `allowImportingTsExtensions` | `TS5096` (needs `noEmit`) | passes |
  | `'./multipart.js'` | OK | `ERR_MODULE_NOT_FOUND` |
  | **`'#lib/multipart'` (imports map)** | **OK** | **passes** |

  The map was also confirmed at runtime, not just at compile time — a deployed endpoint using a mapped import returned correctly, proving webpack resolves it into a working bundle.

  `tsconfig.json` still sets `"include": ["index.ts", "lib/**/*.ts"]` to keep `test/` out of the compile graph.
- **Types are imported with `import type`.** Node strips types without a build step, so a type pulled in through a value import (`import { MultipartFile } from '#lib/multipart'`) throws `SyntaxError: does not provide an export named ...` at runtime. Split them: `import type { MultipartFile } from '#lib/multipart'`.
- **Import `crypto` by name**: `import { createHash, randomUUID } from 'crypto'`. Never `import crypto from 'crypto'`.
- **`app.options` does not exist.** codehooks-js registers `get`, `post`, `put`, `patch`, `delete`, and `all`. Handle CORS preflight inside an `app.all()` handler that switches on `req.method`.
- **`filestore.getReadStream(path)` returns a Promise**, not a stream — `await` it before calling `.pipe()`.
- **No `fs`, `path`, or `os`** — Codehooks has no filesystem. Uploads go to the filestore.
- **`conn.getMany()` returns a stream** — call `.toArray()` before sorting, filtering, or mapping.
- **Deploy target:** project `formify-05tc`, space `dev`. Deploy with `coho deploy` from the `form-backend/` directory.
- **Post-deploy staleness:** requests in the first ~2 seconds after a deploy can fail with a spurious `{"error":"Authentication failed"}` from a stale instance. Always `sleep 3` after deploying before testing, and retry once on that specific error.
- **Commit after every task.** Never bundle two tasks into one commit.

---

## File Structure

| File | Responsibility |
|---|---|
| `form-backend/index.ts` | Route registration only. No business logic. |
| `form-backend/lib/multipart.ts` | Raw request bytes -> `{ fields, files }`. Pure, fully unit-tested. |
| `form-backend/lib/body.ts` | Content-type dispatch across JSON / urlencoded / multipart. |
| `form-backend/lib/validation.ts` | Field-schema validation for typed forms. Pure. |
| `form-backend/lib/forms.ts` | Forms collection access + defaults. |
| `form-backend/lib/auth.ts` | Admin JWT cookie issue/verify. |
| `form-backend/lib/files.ts` | Filestore persistence for uploads. |
| `form-backend/lib/csv.ts` | Submission rows -> CSV. Pure. |
| `form-backend/test/*.test.ts` | Unit tests for the pure modules. |

---

### Task 1: Deployable scaffold

**Files:**
- Create: `form-backend/package.json`, `form-backend/tsconfig.json`, `form-backend/.gitignore`, `form-backend/.env.example`, `form-backend/index.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: a deployed app answering `GET /health` with `{ ok: true }`.

- [ ] **Step 1: Create `form-backend/package.json`**

```json
{
  "name": "form-backend",
  "version": "1.0.0",
  "description": "Headless form backend — collect submissions, validate, store files, and notify",
  "main": "index.ts",
  "imports": {
    "#lib/*": "./lib/*.ts"
  },
  "scripts": {
    "deploy": "coho deploy",
    "test": "node --test test/*.test.ts"
  },
  "license": "ISC",
  "dependencies": {
    "codehooks-js": "latest",
    "jsonwebtoken": "latest"
  },
  "devDependencies": {
    "@types/node": "^26.0.0"
  }
}
```

- [ ] **Step 2: Create `form-backend/tsconfig.json`**

`esModuleInterop` is the load-bearing line — see Global Constraints.

```json
{
  "compilerOptions": {
    "lib": ["es2020", "dom"],
    "types": ["node"],
    "resolveJsonModule": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler"
  },
  "include": ["index.ts", "lib/**/*.ts"]
}
```

- [ ] **Step 3: Create `form-backend/.gitignore`**

```
node_modules/
config.json
.env
```

- [ ] **Step 4: Create `form-backend/.env.example`**

```
# Admin authentication (required)
JWT_SECRET=generate-with-openssl-rand-hex-32
ADMIN_PASSWORD=choose-a-strong-password

# Upload limit in megabytes (optional, default 5)
MAX_UPLOAD_MB=5
```

- [ ] **Step 5: Create `form-backend/index.ts`**

```ts
import { app } from 'codehooks-js';

app.auth('/health', (req, res, next) => next());

app.get('/health', (req, res) => {
  res.json({ ok: true, service: 'form-backend' });
});

export default app.init();
```

- [ ] **Step 6: Install and verify it compiles**

Run:
```bash
cd form-backend && npm install && coho verify
```
Expected: `OK 🙌`. If you see `TS1192`, the `tsconfig.json` from Step 2 is missing or wrong.

- [ ] **Step 7: Link the space and deploy**

Do **not** run `coho init` here. It restores the space's currently-deployed code into
the directory, which would overwrite the `index.ts` and `package.json` you just wrote.
Linking only needs `config.json`, which `.gitignore` already excludes:

```bash
cd form-backend
cat > config.json <<'JSON'
{
  "name": "formify-05tc",
  "space": "dev"
}
JSON
coho deploy
```

- [ ] **Step 8: Verify the deployment answers**

Run:
```bash
sleep 3 && curl -s "$(coho info formify-05tc dev | grep -o 'https://[a-z0-9-]*\.codehooks\.io')/health"
```
Expected: `{"ok":true,"service":"form-backend"}`

- [ ] **Step 9: Commit**

```bash
git add form-backend/
git commit -m "feat(form-backend): deployable scaffold with health endpoint"
```

---

### Task 2: Multipart parser

The highest-risk component, already proven in the design spike. Codehooks does not parse `multipart/form-data` — `req.body` is `{}` and `req.rawBody` is `undefined` — but draining the request stream yields exact bytes.

**Files:**
- Create: `form-backend/lib/multipart.ts`, `form-backend/test/multipart.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type MultipartFile = { field: string; filename: string; contentType: string; content: Buffer }`
  - `type MultipartResult = { fields: Record<string, string>; files: MultipartFile[] }`
  - `boundaryFromContentType(contentType: string): string | null`
  - `parseMultipart(buf: Buffer, boundary: string): MultipartResult`
  - `readRequestBody(req: any, maxBytes: number): Promise<Buffer>` — rejects with `Error('PAYLOAD_TOO_LARGE')`

- [ ] **Step 1: Write the failing tests**

Create `form-backend/test/multipart.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert';
import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { boundaryFromContentType, parseMultipart, readRequestBody } from '#lib/multipart';

const B = 'xBoundary123';

function buildBody(parts: Array<{ name: string; value?: string; filename?: string; contentType?: string; content?: Buffer }>): Buffer {
  const chunks: Buffer[] = [];
  for (const p of parts) {
    let head = `--${B}\r\nContent-Disposition: form-data; name="${p.name}"`;
    if (p.filename !== undefined) head += `; filename="${p.filename}"`;
    head += '\r\n';
    if (p.contentType) head += `Content-Type: ${p.contentType}\r\n`;
    head += '\r\n';
    chunks.push(Buffer.from(head, 'utf8'));
    chunks.push(p.content ?? Buffer.from(p.value ?? '', 'utf8'));
    chunks.push(Buffer.from('\r\n', 'utf8'));
  }
  chunks.push(Buffer.from(`--${B}--\r\n`, 'utf8'));
  return Buffer.concat(chunks);
}

test('boundaryFromContentType extracts a bare boundary', () => {
  assert.equal(boundaryFromContentType('multipart/form-data; boundary=abc123'), 'abc123');
});

test('boundaryFromContentType extracts a quoted boundary', () => {
  assert.equal(boundaryFromContentType('multipart/form-data; boundary="a b c"'), 'a b c');
});

test('boundaryFromContentType returns null when absent', () => {
  assert.equal(boundaryFromContentType('application/json'), null);
});

test('parseMultipart reads plain text fields', () => {
  const buf = buildBody([
    { name: 'name', value: 'Ada Lovelace' },
    { name: 'email', value: 'ada@example.com' },
  ]);
  const out = parseMultipart(buf, B);
  assert.deepEqual(out.fields, { name: 'Ada Lovelace', email: 'ada@example.com' });
  assert.equal(out.files.length, 0);
});

test('parseMultipart preserves binary file content byte-for-byte', () => {
  // 1x1 transparent PNG — the exact fixture verified in the design spike
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    'base64'
  );
  const buf = buildBody([
    { name: 'name', value: 'Ada' },
    { name: 'upload', filename: 'tiny.png', contentType: 'image/png', content: png },
  ]);
  const out = parseMultipart(buf, B);
  assert.equal(out.fields.name, 'Ada');
  assert.equal(out.files.length, 1);
  assert.equal(out.files[0].field, 'upload');
  assert.equal(out.files[0].filename, 'tiny.png');
  assert.equal(out.files[0].contentType, 'image/png');
  assert.equal(out.files[0].content.length, png.length);
  assert.equal(
    createHash('md5').update(out.files[0].content).digest('hex'),
    createHash('md5').update(png).digest('hex')
  );
});

test('parseMultipart survives a 2MB binary spanning many chunks', () => {
  const big = Buffer.alloc(2 * 1024 * 1024);
  for (let i = 0; i < big.length; i++) big[i] = i % 256;
  const buf = buildBody([{ name: 'f', filename: 'big.bin', contentType: 'application/octet-stream', content: big }]);
  const out = parseMultipart(buf, B);
  assert.equal(out.files[0].content.length, big.length);
  assert.ok(out.files[0].content.equals(big));
});

test('parseMultipart ignores an empty file input', () => {
  const buf = buildBody([
    { name: 'upload', filename: '', contentType: 'application/octet-stream', content: Buffer.alloc(0) },
    { name: 'name', value: 'Ada' },
  ]);
  const out = parseMultipart(buf, B);
  assert.equal(out.files.length, 0);
  assert.equal(out.fields.name, 'Ada');
});

test('readRequestBody concatenates streamed chunks', async () => {
  const req: any = new EventEmitter();
  const p = readRequestBody(req, 1024);
  req.emit('data', Buffer.from('hello '));
  req.emit('data', Buffer.from('world'));
  req.emit('end');
  assert.equal((await p).toString(), 'hello world');
});

test('readRequestBody rejects a body over the cap', async () => {
  const req: any = new EventEmitter();
  const p = readRequestBody(req, 4);
  req.emit('data', Buffer.from('toolong'));
  await assert.rejects(p, /PAYLOAD_TOO_LARGE/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd form-backend && node --test test/multipart.test.ts`
Expected: FAIL — cannot find module `../lib/multipart.ts`.

- [ ] **Step 3: Write the implementation**

Create `form-backend/lib/multipart.ts`:

```ts
export type MultipartFile = {
  field: string;
  filename: string;
  contentType: string;
  content: Buffer;
};

export type MultipartResult = {
  fields: Record<string, string>;
  files: MultipartFile[];
};

export function boundaryFromContentType(contentType: string): string | null {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || '');
  if (!m) return null;
  const b = (m[1] || m[2] || '').trim();
  return b || null;
}

export function parseMultipart(buf: Buffer, boundary: string): MultipartResult {
  const result: MultipartResult = { fields: {}, files: [] };
  const delim = Buffer.from('--' + boundary);

  let start = buf.indexOf(delim);
  if (start < 0) return result;
  start += delim.length;

  while (start < buf.length) {
    // "--" immediately after a boundary marks the closing delimiter
    if (buf[start] === 0x2d && buf[start + 1] === 0x2d) break;
    start += 2; // skip the CRLF that follows the boundary

    const headerEnd = buf.indexOf('\r\n\r\n', start);
    if (headerEnd < 0) break;
    const headers = buf.slice(start, headerEnd).toString('utf8');

    const bodyStart = headerEnd + 4;
    let next = buf.indexOf(delim, bodyStart);
    if (next < 0) next = buf.length;

    // -2 strips the CRLF that precedes the next boundary
    const content = buf.slice(bodyStart, Math.max(bodyStart, next - 2));

    const nameMatch = /name="([^"]*)"/.exec(headers);
    const fileMatch = /filename="([^"]*)"/.exec(headers);
    const typeMatch = /content-type:\s*([^\r\n]+)/i.exec(headers);

    if (nameMatch) {
      const field = nameMatch[1];
      if (fileMatch && fileMatch[1] !== '') {
        result.files.push({
          field,
          filename: fileMatch[1],
          contentType: typeMatch ? typeMatch[1].trim() : 'application/octet-stream',
          content,
        });
      } else if (!fileMatch) {
        result.fields[field] = content.toString('utf8');
      }
      // filename="" is an empty file input — ignore it entirely
    }

    start = next + delim.length;
  }

  return result;
}

// Codehooks does not parse multipart bodies, but req is a readable stream.
// Draining it yields the exact bytes; verified byte-perfect up to 2MB.
export function readRequestBody(req: any, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };

    req.on('data', (c: any) => {
      const b = Buffer.isBuffer(c) ? c : Buffer.from(c);
      total += b.length;
      if (total > maxBytes) {
        return settle(() => reject(new Error('PAYLOAD_TOO_LARGE')));
      }
      chunks.push(b);
    });
    req.on('end', () => settle(() => resolve(Buffer.concat(chunks))));
    req.on('error', (e: any) => settle(() => reject(e)));
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd form-backend && node --test test/multipart.test.ts`
Expected: PASS — 9 passing, 0 failing.

- [ ] **Step 5: Commit**

```bash
git add form-backend/lib/multipart.ts form-backend/test/multipart.test.ts
git commit -m "feat(form-backend): multipart/form-data parser with binary integrity tests"
```

---

### Task 3: Content-type dispatch

**Files:**
- Create: `form-backend/lib/body.ts`, `form-backend/test/body.test.ts`

**Interfaces:**
- Consumes: `parseMultipart`, `boundaryFromContentType`, `readRequestBody`, `MultipartFile` from `lib/multipart.ts`.
- Produces:
  - `type ParsedBody = { fields: Record<string, string>; files: MultipartFile[] }`
  - `parseBody(req: any, maxBytes: number): Promise<ParsedBody>`
  - `flattenValue(v: unknown): string`

Nested JSON values are flattened to strings so submissions stay a flat key/value map — the inbox, CSV export, and notification templates all assume that shape.

- [ ] **Step 0: Adopt the `#lib/*` imports map**

This task is the first where one source module imports another, which is what forced the
imports map (see Global Constraints). Retrofit it before writing any new code.

Add the map to `form-backend/package.json`, directly after `"main"`:

```json
  "imports": {
    "#lib/*": "./lib/*.ts"
  },
```

Add the two resolution options to `form-backend/tsconfig.json`'s `compilerOptions`:

```json
    "module": "esnext",
    "moduleResolution": "bundler"
```

Then migrate the one existing test to the new style, so the codebase has a single
convention — in `form-backend/test/multipart.test.ts` change:

```ts
import { boundaryFromContentType, parseMultipart, readRequestBody } from '../lib/multipart.ts';
```

to:

```ts
import { boundaryFromContentType, parseMultipart, readRequestBody } from '#lib/multipart';
```

Verify both toolchains still work before continuing:

```bash
cd form-backend && node --test test/multipart.test.ts && coho verify
```
Expected: 10/10 passing, then `OK 🙌`. If either fails, stop and report — do not proceed to Step 1.

- [ ] **Step 1: Write the failing tests**

Create `form-backend/test/body.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert';
import { EventEmitter } from 'node:events';
import { parseBody, flattenValue } from '#lib/body';

test('flattenValue passes strings through', () => {
  assert.equal(flattenValue('hi'), 'hi');
});

test('flattenValue stringifies numbers and booleans', () => {
  assert.equal(flattenValue(42), '42');
  assert.equal(flattenValue(true), 'true');
});

test('flattenValue joins arrays with commas', () => {
  assert.equal(flattenValue(['a', 'b']), 'a, b');
});

test('flattenValue JSON-encodes objects', () => {
  assert.equal(flattenValue({ a: 1 }), '{"a":1}');
});

test('flattenValue renders null and undefined as empty', () => {
  assert.equal(flattenValue(null), '');
  assert.equal(flattenValue(undefined), '');
});

test('parseBody reads a pre-parsed JSON body', async () => {
  const req: any = {
    headers: { 'content-type': 'application/json' },
    body: { name: 'Ada', age: 36, tags: ['x', 'y'] },
  };
  const out = await parseBody(req, 1024);
  assert.deepEqual(out.fields, { name: 'Ada', age: '36', tags: 'x, y' });
  assert.equal(out.files.length, 0);
});

test('parseBody reads a pre-parsed urlencoded body', async () => {
  const req: any = {
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: { name: 'Ada', msg: 'hello world' },
  };
  const out = await parseBody(req, 1024);
  assert.deepEqual(out.fields, { name: 'Ada', msg: 'hello world' });
});

test('parseBody streams and parses a multipart body', async () => {
  const B = 'zzz';
  const req: any = new EventEmitter();
  req.headers = { 'content-type': `multipart/form-data; boundary=${B}` };
  req.body = {};
  const p = parseBody(req, 1024 * 1024);
  const body =
    `--${B}\r\nContent-Disposition: form-data; name="name"\r\n\r\nAda\r\n` +
    `--${B}--\r\n`;
  req.emit('data', Buffer.from(body, 'utf8'));
  req.emit('end');
  const out = await p;
  assert.deepEqual(out.fields, { name: 'Ada' });
});

test('parseBody returns empty for a body-less request', async () => {
  const req: any = { headers: {}, body: {} };
  const out = await parseBody(req, 1024);
  assert.deepEqual(out.fields, {});
  assert.equal(out.files.length, 0);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd form-backend && node --test test/body.test.ts`
Expected: FAIL — cannot find module `../lib/body.ts`.

- [ ] **Step 3: Write the implementation**

Create `form-backend/lib/body.ts`:

```ts
import {
  boundaryFromContentType,
  parseMultipart,
  readRequestBody,
  MultipartFile,
} from '#lib/multipart';

export type ParsedBody = {
  fields: Record<string, string>;
  files: MultipartFile[];
};

// Submissions are a flat string map: the inbox, CSV export, and notification
// templates all render values directly, so nested structures are collapsed here.
export function flattenValue(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return v.map(flattenValue).join(', ');
  return JSON.stringify(v);
}

export async function parseBody(req: any, maxBytes: number): Promise<ParsedBody> {
  const contentType = String(req.headers?.['content-type'] || '');

  // Codehooks does not parse multipart — stream the raw bytes and parse them ourselves.
  if (contentType.toLowerCase().startsWith('multipart/form-data')) {
    const boundary = boundaryFromContentType(contentType);
    if (!boundary) return { fields: {}, files: [] };
    const raw = await readRequestBody(req, maxBytes);
    return parseMultipart(raw, boundary);
  }

  // JSON and urlencoded arrive pre-parsed on req.body.
  const fields: Record<string, string> = {};
  const body = req.body;
  if (body && typeof body === 'object') {
    for (const [k, v] of Object.entries(body)) {
      fields[k] = flattenValue(v);
    }
  }
  return { fields, files: [] };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd form-backend && node --test test/body.test.ts`
Expected: PASS — 9 passing.

- [ ] **Step 5: Commit**

```bash
git add form-backend/lib/body.ts form-backend/test/body.test.ts
git commit -m "feat(form-backend): content-type dispatch for JSON, urlencoded, and multipart"
```

---

### Task 4: Field validation

**Files:**
- Create: `form-backend/lib/validation.ts`, `form-backend/test/validation.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type FieldType = 'text' | 'textarea' | 'email' | 'phone' | 'url' | 'number' | 'date' | 'rating' | 'select' | 'file'`
  - `type FieldDef = { name: string; type: FieldType; required?: boolean; label?: string; min?: number; max?: number; options?: string[] }`
  - `type ValidationResult = { ok: boolean; errors: Array<{ field: string; message: string }> }`
  - `validateFields(defs: FieldDef[], data: Record<string, string>, strict?: boolean): ValidationResult`

Per the spec: an empty `defs` array accepts anything, and `strict` is ignored when `defs` is empty (with no schema every field would be "unknown").

- [ ] **Step 1: Write the failing tests**

Create `form-backend/test/validation.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert';
import { validateFields, FieldDef } from '#lib/validation';

test('an empty schema accepts anything', () => {
  const r = validateFields([], { anything: 'goes', more: 'fields' });
  assert.equal(r.ok, true);
  assert.equal(r.errors.length, 0);
});

test('strict is ignored when the schema is empty', () => {
  const r = validateFields([], { unknown: 'x' }, true);
  assert.equal(r.ok, true);
});

test('a missing required field fails', () => {
  const defs: FieldDef[] = [{ name: 'email', type: 'email', required: true }];
  const r = validateFields(defs, {});
  assert.equal(r.ok, false);
  assert.equal(r.errors[0].field, 'email');
  assert.match(r.errors[0].message, /required/i);
});

test('an empty string counts as missing for a required field', () => {
  const defs: FieldDef[] = [{ name: 'email', type: 'email', required: true }];
  assert.equal(validateFields(defs, { email: '   ' }).ok, false);
});

test('an optional field left blank passes', () => {
  const defs: FieldDef[] = [{ name: 'phone', type: 'phone' }];
  assert.equal(validateFields(defs, { phone: '' }).ok, true);
});

test('email format is enforced', () => {
  const defs: FieldDef[] = [{ name: 'email', type: 'email' }];
  assert.equal(validateFields(defs, { email: 'ada@example.com' }).ok, true);
  assert.equal(validateFields(defs, { email: 'not-an-email' }).ok, false);
});

test('url must be http or https', () => {
  const defs: FieldDef[] = [{ name: 'site', type: 'url' }];
  assert.equal(validateFields(defs, { site: 'https://example.com' }).ok, true);
  assert.equal(validateFields(defs, { site: 'javascript:alert(1)' }).ok, false);
});

test('number rejects non-numeric input and honours min/max', () => {
  const defs: FieldDef[] = [{ name: 'qty', type: 'number', min: 1, max: 10 }];
  assert.equal(validateFields(defs, { qty: '5' }).ok, true);
  assert.equal(validateFields(defs, { qty: 'abc' }).ok, false);
  assert.equal(validateFields(defs, { qty: '0' }).ok, false);
  assert.equal(validateFields(defs, { qty: '11' }).ok, false);
});

test('date must be ISO formatted', () => {
  const defs: FieldDef[] = [{ name: 'when', type: 'date' }];
  assert.equal(validateFields(defs, { when: '2026-09-03' }).ok, true);
  assert.equal(validateFields(defs, { when: '03/09/2026' }).ok, false);
});

test('rating must fall within its range', () => {
  const defs: FieldDef[] = [{ name: 'stars', type: 'rating', min: 1, max: 5 }];
  assert.equal(validateFields(defs, { stars: '4' }).ok, true);
  assert.equal(validateFields(defs, { stars: '9' }).ok, false);
});

test('select must match one of its options', () => {
  const defs: FieldDef[] = [{ name: 'plan', type: 'select', options: ['free', 'pro'] }];
  assert.equal(validateFields(defs, { plan: 'pro' }).ok, true);
  assert.equal(validateFields(defs, { plan: 'enterprise' }).ok, false);
});

test('strict rejects unknown fields when a schema exists', () => {
  const defs: FieldDef[] = [{ name: 'email', type: 'email' }];
  assert.equal(validateFields(defs, { email: 'a@b.com', extra: 'x' }, true).ok, false);
  assert.equal(validateFields(defs, { email: 'a@b.com', extra: 'x' }, false).ok, true);
});

test('honeypot and control fields are exempt from strict mode', () => {
  const defs: FieldDef[] = [{ name: 'email', type: 'email' }];
  const r = validateFields(defs, { email: 'a@b.com', _gotcha: '', _redirect: '/thanks' }, true);
  assert.equal(r.ok, true);
});

test('all failures are reported, not just the first', () => {
  const defs: FieldDef[] = [
    { name: 'email', type: 'email', required: true },
    { name: 'qty', type: 'number' },
  ];
  const r = validateFields(defs, { qty: 'abc' });
  assert.equal(r.errors.length, 2);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd form-backend && node --test test/validation.test.ts`
Expected: FAIL — cannot find module `../lib/validation.ts`.

- [ ] **Step 3: Write the implementation**

Create `form-backend/lib/validation.ts`:

```ts
export type FieldType =
  | 'text' | 'textarea' | 'email' | 'phone' | 'url'
  | 'number' | 'date' | 'rating' | 'select' | 'file';

export type FieldDef = {
  name: string;
  type: FieldType;
  required?: boolean;
  label?: string;
  min?: number;
  max?: number;
  options?: string[];
};

export type ValidationResult = {
  ok: boolean;
  errors: Array<{ field: string; message: string }>;
};

// Fields the submit endpoint interprets itself; never part of a form's schema.
const CONTROL_FIELDS = new Set(['_gotcha', '_redirect', '_subject', '_next']);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?[0-9][0-9\s().-]{5,}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function checkOne(def: FieldDef, raw: string): string | null {
  const value = (raw ?? '').trim();

  if (!value) {
    return def.required ? `${def.label || def.name} is required` : null;
  }

  switch (def.type) {
    case 'email':
      return EMAIL_RE.test(value) ? null : 'Must be a valid email address';
    case 'phone':
      return PHONE_RE.test(value) ? null : 'Must be a valid phone number';
    case 'url':
      return /^https?:\/\/[^\s]+$/i.test(value) ? null : 'Must be a valid http(s) URL';
    case 'date':
      if (!DATE_RE.test(value)) return 'Must be an ISO date (YYYY-MM-DD)';
      return Number.isNaN(Date.parse(value)) ? 'Must be a valid date' : null;
    case 'number':
    case 'rating': {
      const n = Number(value);
      if (!Number.isFinite(n)) return 'Must be a number';
      if (def.min !== undefined && n < def.min) return `Must be at least ${def.min}`;
      if (def.max !== undefined && n > def.max) return `Must be at most ${def.max}`;
      return null;
    }
    case 'select':
      if (def.options && def.options.length && !def.options.includes(value)) {
        return `Must be one of: ${def.options.join(', ')}`;
      }
      return null;
    default: {
      if (def.max !== undefined && value.length > def.max) {
        return `Must be at most ${def.max} characters`;
      }
      return null;
    }
  }
}

export function validateFields(
  defs: FieldDef[],
  data: Record<string, string>,
  strict = false
): ValidationResult {
  const errors: Array<{ field: string; message: string }> = [];

  // No schema means accept anything — strict has nothing to measure against.
  if (!defs || defs.length === 0) return { ok: true, errors };

  for (const def of defs) {
    if (def.type === 'file') continue; // files are validated during persistence
    const message = checkOne(def, data[def.name]);
    if (message) errors.push({ field: def.name, message });
  }

  if (strict) {
    const known = new Set(defs.map((d) => d.name));
    for (const key of Object.keys(data)) {
      if (!known.has(key) && !CONTROL_FIELDS.has(key)) {
        errors.push({ field: key, message: 'Unknown field' });
      }
    }
  }

  return { ok: errors.length === 0, errors };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd form-backend && node --test test/validation.test.ts`
Expected: PASS — 14 passing.

- [ ] **Step 5: Commit**

```bash
git add form-backend/lib/validation.ts form-backend/test/validation.test.ts
git commit -m "feat(form-backend): typed field validation with strict mode"
```

---

### Task 5: Admin auth and forms CRUD

**Files:**
- Create: `form-backend/lib/auth.ts`, `form-backend/lib/forms.ts`
- Modify: `form-backend/index.ts`

**Interfaces:**
- Consumes: `FieldDef` from `lib/validation.ts`.
- Produces:
  - `lib/auth.ts`: `signToken(): string`, `verifyRequest(req: any): boolean`, `parseCookies(header: string): Record<string, string>`, `passwordMatches(candidate: string): boolean`
  - `lib/forms.ts`: `type FormDoc`, `defaultForm(name: string): FormDoc`, `getFormByUuid(uuid: string): Promise<FormDoc | null>`

- [ ] **Step 1: Write `form-backend/lib/auth.ts`**

```ts
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
```

- [ ] **Step 2: Write `form-backend/lib/forms.ts`**

```ts
import { Datastore } from 'codehooks-js';
import { randomUUID } from 'crypto';
import type { FieldDef } from '#lib/validation';

export type FormDoc = {
  _id?: string;
  uuid: string;
  name: string;
  enabled: boolean;
  fields: FieldDef[];
  strict: boolean;
  redirectUrl: string;
  allowRedirectOverride: boolean;
  allowedDomains: string[];
  honeypot: string;
  retentionDays: number;
  created: string;
  updated: string;
  stats: { total: number; spam: number; lastSubmissionAt: string | null };
};

export function defaultForm(name: string): FormDoc {
  const now = new Date().toISOString();
  return {
    uuid: randomUUID(),
    name: String(name || 'Untitled').trim().slice(0, 100) || 'Untitled',
    enabled: true,
    fields: [],
    strict: false,
    redirectUrl: '',
    allowRedirectOverride: false,
    allowedDomains: [],
    honeypot: '_gotcha',
    retentionDays: 0,
    created: now,
    updated: now,
    stats: { total: 0, spam: 0, lastSubmissionAt: null },
  };
}

export async function getFormByUuid(uuid: string): Promise<FormDoc | null> {
  const conn = await Datastore.open();
  const rows = await conn.getMany('forms', { uuid }).toArray();
  return rows.length ? (rows[0] as FormDoc) : null;
}
```

- [ ] **Step 3: Replace `form-backend/index.ts` with auth and forms routes**

```ts
import { app, Datastore } from 'codehooks-js';
import { signToken, verifyRequest, passwordMatches } from '#lib/auth';
import { defaultForm, getFormByUuid } from '#lib/forms';
import type { FormDoc } from '#lib/forms';

// Boot-time guard — a missing JWT_SECRET would make admin sessions forgeable.
(function checkConfig() {
  const missing: string[] = [];
  if (!process.env.JWT_SECRET) missing.push('JWT_SECRET (admin sessions would be forgeable)');
  if (!process.env.ADMIN_PASSWORD) missing.push('ADMIN_PASSWORD (admin login unprotected)');
  if (missing.length) {
    console.error('⚠️  form-backend: missing required env var(s): ' + missing.join(', '));
  }
})();

app.auth('/health', (req, res, next) => next());
app.auth('/admin/login', (req, res, next) => next());
app.auth('/admin/logout', (req, res, next) => next());

// Admin API — bypass the platform API key, require our JWT cookie instead.
app.auth('/admin/api/*', (req, res, next) => {
  if (verifyRequest(req)) return next();
  res.status(401).json({ error: 'Not authenticated' });
  res.end();
});

app.get('/health', (req, res) => {
  res.json({ ok: true, service: 'form-backend' });
});

app.post('/admin/login', (req, res) => {
  if (!passwordMatches(req.body?.password)) {
    return res.status(401).json({ ok: false, error: 'Invalid password' });
  }
  // Secure is safe unconditionally — Codehooks serves HTTPS only, and this cookie
  // is the session for the entire admin surface.
  res.set('Set-Cookie', `token=${signToken()}; HttpOnly; Secure; Path=/; SameSite=Strict; Max-Age=604800`);
  res.json({ ok: true });
});

app.post('/admin/logout', (req, res) => {
  res.set('Set-Cookie', 'token=; HttpOnly; Secure; Path=/; SameSite=Strict; Max-Age=0');
  res.json({ ok: true });
});

app.get('/admin/api/forms', async (req, res) => {
  const conn = await Datastore.open();
  const forms = await conn.getMany('forms', {}, { sort: { created: -1 } }).toArray();
  res.json({ ok: true, data: forms });
});

app.post('/admin/api/forms', async (req, res) => {
  const conn = await Datastore.open();
  const form = await conn.insertOne('forms', defaultForm(req.body?.name));
  res.status(201).json({ ok: true, data: form });
});

app.get('/admin/api/forms/:id', async (req, res) => {
  const conn = await Datastore.open();
  const form = await conn.findOneOrNull('forms', req.params.id);
  if (!form) return res.status(404).json({ ok: false, error: 'Form not found' });
  res.json({ ok: true, data: form });
});

app.patch('/admin/api/forms/:id', async (req, res) => {
  const conn = await Datastore.open();
  const existing = await conn.findOneOrNull('forms', req.params.id);
  if (!existing) return res.status(404).json({ ok: false, error: 'Form not found' });

  // uuid, created and stats are server-owned and never client-writable.
  const allowed: Array<keyof FormDoc> = [
    'name', 'enabled', 'fields', 'strict', 'redirectUrl',
    'allowRedirectOverride', 'allowedDomains', 'honeypot', 'retentionDays',
  ];
  const patch: any = { updated: new Date().toISOString() };
  for (const key of allowed) {
    if (req.body && key in req.body) patch[key] = req.body[key];
  }
  const updated = await conn.updateOne('forms', req.params.id, { $set: patch });
  res.json({ ok: true, data: updated });
});

app.delete('/admin/api/forms/:id', async (req, res) => {
  const conn = await Datastore.open();
  const form: any = await conn.findOneOrNull('forms', req.params.id);
  if (!form) return res.status(404).json({ ok: false, error: 'Form not found' });
  await conn.removeMany('submissions', { formId: form.uuid });
  await conn.removeOne('forms', req.params.id);
  res.json({ ok: true, deleted: true });
});

export default app.init();
```

- [ ] **Step 4: Deploy and set the required env vars**

Run:
```bash
cd form-backend
coho set-env JWT_SECRET "$(openssl rand -hex 32)" --encrypted
coho set-env ADMIN_PASSWORD 'test-password-123' --encrypted
coho deploy && sleep 3
```

- [ ] **Step 5: Verify auth and CRUD end to end**

Run (substitute your deploy URL for `$U`):
```bash
U=$(coho info formify-05tc dev | grep -o 'https://[a-z0-9-]*\.codehooks\.io')
# Unauthenticated admin call is rejected
curl -s "$U/admin/api/forms"
# Wrong password is rejected
curl -s -X POST "$U/admin/login" -H 'content-type: application/json' -d '{"password":"wrong"}'
# Correct password sets a cookie
curl -s -c /tmp/fb-cookies -X POST "$U/admin/login" -H 'content-type: application/json' -d '{"password":"test-password-123"}'
# Authenticated create + list
curl -s -b /tmp/fb-cookies -X POST "$U/admin/api/forms" -H 'content-type: application/json' -d '{"name":"Contact"}'
curl -s -b /tmp/fb-cookies "$U/admin/api/forms"
```
Expected: a **401** for the unauthenticated call, then `{"ok":false,...}`, then `{"ok":true}`, then a created form with a `uuid`, then a list containing it.

Note on the 401 body: with no credentials at all, the platform's own auth layer answers first and returns
`{"error":"Authentication failed"}` rather than our handler's `{"error":"Not authenticated"}`. Both are 401
and both deny access; only the text differs. Accept either. Our handler's message appears once a request
carries credentials but no valid admin JWT cookie.

- [ ] **Step 6: Commit**

```bash
git add form-backend/lib/auth.ts form-backend/lib/forms.ts form-backend/index.ts
git commit -m "feat(form-backend): admin JWT auth and forms CRUD"
```

---

### Task 6: The submit endpoint

**Files:**
- Create: `form-backend/lib/files.ts`
- Modify: `form-backend/index.ts`

**Interfaces:**
- Consumes: `parseBody` (`lib/body.ts`), `validateFields` (`lib/validation.ts`), `getFormByUuid` (`lib/forms.ts`), `MultipartFile` (`lib/multipart.ts`).
- Produces:
  - `lib/files.ts`: `type StoredFile = { id: string; field: string; filename: string; contentType: string; size: number; path: string }`, `saveUploads(formId: string, submissionId: string, files: MultipartFile[], maxBytes: number): Promise<StoredFile[]>`

Spam checks and notifications are deliberately out of scope here — Plan 3 adds them.

- [ ] **Step 1: Write `form-backend/lib/files.ts`**

```ts
import { filestore } from 'codehooks-js';
import { PassThrough } from 'stream';
import { randomUUID } from 'crypto';
import type { MultipartFile } from '#lib/multipart';

export type StoredFile = {
  id: string;
  field: string;
  filename: string;
  contentType: string;
  size: number;
  path: string;
};

// Uploads are attacker-supplied, so filenames are never used as storage paths.
function safeName(name: string): string {
  return String(name || 'file').toLowerCase().replace(/[^a-z0-9.-]/g, '-').slice(0, 80);
}

export async function saveUploads(
  formId: string,
  submissionId: string,
  files: MultipartFile[],
  maxBytes: number
): Promise<StoredFile[]> {
  const stored: StoredFile[] = [];
  for (const f of files) {
    if (f.content.length === 0) continue;
    if (f.content.length > maxBytes) {
      throw new Error(`File ${f.filename} exceeds the upload limit`);
    }
    const id = randomUUID();
    const path = `/uploads/${formId}/${submissionId}/${id}-${safeName(f.filename)}`;
    const stream = new PassThrough();
    stream.end(f.content);
    await filestore.saveFile(path, stream);
    stored.push({
      id,
      field: f.field,
      filename: f.filename,
      contentType: f.contentType,
      size: f.content.length,
      path,
    });
  }
  return stored;
}
```

- [ ] **Step 2: Add the submit endpoint to `index.ts`**

Insert these imports at the top, alongside the existing ones:

```ts
import { parseBody } from '#lib/body';
import { validateFields } from '#lib/validation';
import { saveUploads } from '#lib/files';
import { randomUUID } from 'crypto';
```

Add the auth bypasses next to the existing ones:

```ts
app.auth('/f/*', (req, res, next) => next());
app.auth('/thanks/*', (req, res, next) => next());
```

Then add the routes **before** the `export default app.init();` line:

```ts
function maxUploadBytes(): number {
  return (Number(process.env.MAX_UPLOAD_MB) || 5) * 1024 * 1024;
}

function originOf(req: any): string {
  const raw = req.headers?.origin || req.headers?.referer || '';
  try {
    return raw ? new URL(raw).hostname : '';
  } catch {
    return '';
  }
}

function corsHeaders(form: any, req: any): Record<string, string> {
  const list: string[] = form.allowedDomains || [];
  const host = originOf(req);
  const allowed = list.length === 0 || list.includes(host);
  return {
    'Access-Control-Allow-Origin': list.length === 0 ? '*' : allowed ? req.headers.origin : 'null',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

// Only same-origin-ish redirects are honoured — an open redirect would let an
// attacker use the form endpoint as a link launderer.
function safeRedirect(form: any, requested: string): string | null {
  if (!requested) return null;
  if (!form.allowRedirectOverride) return null;
  if (requested.startsWith('/')) return requested;
  try {
    const host = new URL(requested).hostname;
    const list: string[] = form.allowedDomains || [];
    return list.includes(host) ? requested : null;
  } catch {
    return null;
  }
}

// codehooks-js exposes get/post/put/patch/delete/all — there is no app.options —
// so the CORS preflight is handled inside one app.all() dispatcher.
app.all('/f/:formId', async (req, res) => {
  try {
    const form = await getFormByUuid(req.params.formId);
    if (!form) return res.status(404).json({ ok: false, error: 'Form not found' });

    res.headers(corsHeaders(form, req));

    if (req.method === 'OPTIONS') return res.status(204).end();
    if (req.method !== 'POST') {
      return res.status(405).json({ ok: false, error: 'Method not allowed' });
    }

    if (!form.enabled) {
      return res.status(403).json({ ok: false, error: 'This form is not accepting submissions' });
    }

    const list: string[] = form.allowedDomains || [];
    if (list.length > 0 && !list.includes(originOf(req))) {
      return res.status(403).json({ ok: false, error: 'Origin not allowed' });
    }

    let parsed;
    try {
      parsed = await parseBody(req, maxUploadBytes());
    } catch (err: any) {
      if (err.message === 'PAYLOAD_TOO_LARGE') {
        return res.status(413).json({ ok: false, error: 'Submission too large' });
      }
      throw err;
    }

    const wantsJson = String(req.headers['content-type'] || '').includes('application/json');
    const data = { ...parsed.fields };
    const requestedRedirect = data._redirect || '';
    for (const key of ['_gotcha', '_redirect', '_subject', '_next']) delete data[key];

    const check = validateFields(form.fields || [], parsed.fields, form.strict);
    if (!check.ok) {
      return res.status(400).json({ ok: false, error: 'Validation failed', errors: check.errors });
    }

    const conn = await Datastore.open();
    const submissionId = randomUUID();
    const files = await saveUploads(form.uuid, submissionId, parsed.files, maxUploadBytes());

    const submission = await conn.insertOne('submissions', {
      submissionId,
      formId: form.uuid,
      created: new Date().toISOString(),
      data,
      files,
      meta: {
        ip: String(req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || ''),
        userAgent: String(req.headers['user-agent'] || ''),
        referer: String(req.headers.referer || ''),
        origin: String(req.headers.origin || ''),
      },
      status: 'new',
      starred: false,
      notes: [],
      spam: { score: 0, reasons: [] },
      ai: null,
    });

    await conn.updateOne('forms', form._id as string, {
      $inc: { 'stats.total': 1 },
      $set: { 'stats.lastSubmissionAt': new Date().toISOString() },
    });

    if (wantsJson) {
      return res.json({ ok: true, id: (submission as any)._id, submissionId });
    }
    const target = safeRedirect(form, requestedRedirect) || form.redirectUrl || `/thanks/${form.uuid}`;
    return res.redirect(302, target);
  } catch (err: any) {
    console.error('Submit error:', err.message);
    res.status(500).json({ ok: false, error: 'Could not accept submission' });
  }
});

app.get('/thanks/:formId', async (req, res) => {
  const form = await getFormByUuid(req.params.formId);
  const name = form ? form.name : 'the form';
  res.set('content-type', 'text/html');
  res.send(
    `<!doctype html><meta charset="utf-8"><title>Thank you</title>` +
    `<div style="font-family:system-ui;max-width:32rem;margin:20vh auto;text-align:center">` +
    `<h1>Thank you</h1><p>Your submission to ${name.replace(/[<>&]/g, '')} was received.</p></div>`
  );
});
```

- [ ] **Step 3: Deploy**

Run: `cd form-backend && coho deploy && sleep 3`

- [ ] **Step 4: Verify all three content types are accepted**

Run (reusing the cookie jar and `$U` from Task 5):
```bash
U=$(coho info formify-05tc dev | grep -o 'https://[a-z0-9-]*\.codehooks\.io')
FORM=$(curl -s -b /tmp/fb-cookies -X POST "$U/admin/api/forms" -H 'content-type: application/json' -d '{"name":"Smoke"}' | python3 -c 'import sys,json; print(json.load(sys.stdin)["data"]["uuid"])')

echo "--- JSON ---"
curl -s -X POST "$U/f/$FORM" -H 'content-type: application/json' -d '{"name":"Ada","email":"ada@example.com"}'
echo "--- urlencoded (follows redirect) ---"
curl -s -o /dev/null -w '%{http_code} -> %{redirect_url}\n' -X POST "$U/f/$FORM" -d 'name=Ada&email=ada@example.com'
echo "--- multipart with a file ---"
printf 'hello file' > /tmp/fb-test.txt
curl -s -o /dev/null -w '%{http_code}\n' -X POST "$U/f/$FORM" -F 'name=Ada' -F 'upload=@/tmp/fb-test.txt;type=text/plain'
echo "--- CORS preflight ---"
curl -s -o /dev/null -w '%{http_code}\n' -X OPTIONS "$U/f/$FORM" -H 'Origin: https://example.com'
echo "--- stored submissions ---"
coho query -c submissions --space dev 2>/dev/null | tail -5
```
Expected: JSON returns `{"ok":true,...}`; the urlencoded post returns `302` with a `/thanks/...` redirect URL; the multipart post returns `302`; and three submissions exist, the last with a populated `files` array.

- [ ] **Step 5: Commit**

```bash
git add form-backend/lib/files.ts form-backend/index.ts
git commit -m "feat(form-backend): submit endpoint accepting JSON, urlencoded, and multipart"
```

---

### Task 7: Inbox API and CSV export

**Files:**
- Create: `form-backend/lib/csv.ts`, `form-backend/test/csv.test.ts`
- Modify: `form-backend/index.ts`

**Interfaces:**
- Consumes: `verifyRequest` (`lib/auth.ts`).
- Produces: `lib/csv.ts`: `toCsv(rows: Array<Record<string, unknown>>, columns: string[]): string`, `collectColumns(rows: Array<{ data: Record<string, string> }>): string[]`

- [ ] **Step 1: Write the failing CSV tests**

Create `form-backend/test/csv.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert';
import { toCsv, collectColumns } from '#lib/csv';

test('collectColumns unions keys across rows in first-seen order', () => {
  const rows = [{ data: { name: 'a', email: 'b' } }, { data: { email: 'c', phone: 'd' } }];
  assert.deepEqual(collectColumns(rows), ['name', 'email', 'phone']);
});

test('toCsv writes a header row and values in column order', () => {
  const csv = toCsv([{ name: 'Ada', email: 'ada@example.com' }], ['name', 'email']);
  assert.equal(csv, 'name,email\r\nAda,ada@example.com');
});

test('toCsv quotes values containing commas, quotes, or newlines', () => {
  const csv = toCsv([{ a: 'x,y', b: 'say "hi"', c: 'line1\nline2' }], ['a', 'b', 'c']);
  assert.equal(csv, 'a,b,c\r\n"x,y","say ""hi""","line1\nline2"');
});

test('toCsv renders missing values as empty', () => {
  assert.equal(toCsv([{ a: '1' }], ['a', 'b']), 'a,b\r\n1,');
});

test('toCsv neutralises formula injection', () => {
  const csv = toCsv([{ a: '=1+1', b: '+x', c: '-y', d: '@z' }], ['a', 'b', 'c', 'd']);
  assert.equal(csv, "a,b,c,d\r\n'=1+1,'+x,'-y,'@z");
});

test('toCsv emits only a header for no rows', () => {
  assert.equal(toCsv([], ['a', 'b']), 'a,b');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd form-backend && node --test test/csv.test.ts`
Expected: FAIL — cannot find module `../lib/csv.ts`.

- [ ] **Step 3: Write `form-backend/lib/csv.ts`**

```ts
// A leading =, +, - or @ makes spreadsheet software treat a cell as a formula.
// Submissions are untrusted, so prefix those with an apostrophe.
function neutralise(value: string): string {
  return /^[=+\-@]/.test(value) ? `'${value}` : value;
}

function escapeCell(value: unknown): string {
  const s = neutralise(value === null || value === undefined ? '' : String(value));
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function collectColumns(rows: Array<{ data: Record<string, string> }>): string[] {
  const seen: string[] = [];
  for (const row of rows) {
    for (const key of Object.keys(row.data || {})) {
      if (!seen.includes(key)) seen.push(key);
    }
  }
  return seen;
}

export function toCsv(rows: Array<Record<string, unknown>>, columns: string[]): string {
  const lines = [columns.map(escapeCell).join(',')];
  for (const row of rows) {
    lines.push(columns.map((c) => escapeCell(row[c])).join(','));
  }
  return lines.join('\r\n');
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd form-backend && node --test test/csv.test.ts`
Expected: PASS — 6 passing.

- [ ] **Step 5: Add the inbox routes to `index.ts`**

Add the import alongside the others:

```ts
import { toCsv, collectColumns } from '#lib/csv';
```

and extend the existing codehooks-js import rather than adding a second one:

```ts
import { app, Datastore, filestore } from 'codehooks-js';
```

Add these routes before `export default app.init();`:

```ts
app.get('/admin/api/forms/:formId/submissions', async (req, res) => {
  const conn = await Datastore.open();
  const { search, status, from, to, limit = '50', offset = '0' } = req.query as any;

  const query: any = { formId: req.params.formId };
  if (status) query.status = status;
  if (from || to) {
    query.created = {};
    if (from) query.created.$gte = from;
    if (to) query.created.$lte = to;
  }

  let rows = await conn
    .getMany('submissions', query, {
      sort: { created: -1 },
      limit: parseInt(limit, 10),
      offset: parseInt(offset, 10),
    })
    .toArray();

  // Full-text search across values happens in memory: submission data is a free-form
  // map, so there is no fixed field to index on.
  if (search) {
    const needle = String(search).toLowerCase();
    rows = rows.filter((r: any) =>
      Object.values(r.data || {}).some((v) => String(v).toLowerCase().includes(needle))
    );
  }

  res.json({ ok: true, data: rows });
});

app.get('/admin/api/submissions/:id', async (req, res) => {
  const conn = await Datastore.open();
  const row = await conn.findOneOrNull('submissions', req.params.id);
  if (!row) return res.status(404).json({ ok: false, error: 'Submission not found' });
  res.json({ ok: true, data: row });
});

app.patch('/admin/api/submissions/:id', async (req, res) => {
  const conn = await Datastore.open();
  const existing = await conn.findOneOrNull('submissions', req.params.id);
  if (!existing) return res.status(404).json({ ok: false, error: 'Submission not found' });

  const patch: any = {};
  if (req.body?.status && ['new', 'read', 'archived', 'spam'].includes(req.body.status)) {
    patch.status = req.body.status;
  }
  if (typeof req.body?.starred === 'boolean') patch.starred = req.body.starred;

  const update: any = {};
  if (Object.keys(patch).length) update.$set = patch;
  if (req.body?.note) {
    update.$push = { notes: { text: String(req.body.note).slice(0, 2000), at: new Date().toISOString() } };
  }
  if (!Object.keys(update).length) {
    return res.status(400).json({ ok: false, error: 'Nothing to update' });
  }

  const updated = await conn.updateOne('submissions', req.params.id, update);
  res.json({ ok: true, data: updated });
});

app.delete('/admin/api/submissions/:id', async (req, res) => {
  const conn = await Datastore.open();
  const row: any = await conn.findOneOrNull('submissions', req.params.id);
  if (!row) return res.status(404).json({ ok: false, error: 'Submission not found' });
  for (const f of row.files || []) {
    try { await filestore.deleteFile(f.path); } catch {}
  }
  await conn.removeOne('submissions', req.params.id);
  res.json({ ok: true, deleted: true });
});

// Uploads are attacker-supplied, so they are served only to an authenticated
// admin and never through a public app.storage() route.
app.get('/admin/api/submissions/:id/files/:fileId', async (req, res) => {
  const conn = await Datastore.open();
  const row: any = await conn.findOneOrNull('submissions', req.params.id);
  if (!row) return res.status(404).json({ ok: false, error: 'Submission not found' });
  const file = (row.files || []).find((f: any) => f.id === req.params.fileId);
  if (!file) return res.status(404).json({ ok: false, error: 'File not found' });

  res.set('content-type', file.contentType || 'application/octet-stream');
  res.set('content-disposition', `attachment; filename="${file.filename.replace(/"/g, '')}"`);
  // getReadStream resolves to the stream — it is not itself one.
  const stream = await filestore.getReadStream(file.path);
  stream.pipe(res);
});

app.get('/admin/api/forms/:formId/export.csv', async (req, res) => {
  const conn = await Datastore.open();
  const rows = await conn
    .getMany('submissions', { formId: req.params.formId }, { sort: { created: -1 } })
    .toArray();

  const dataColumns = collectColumns(rows as any);
  const columns = ['created', 'status', ...dataColumns];
  const flat = (rows as any[]).map((r) => ({
    created: r.created,
    status: r.status,
    ...r.data,
  }));

  res.set('content-type', 'text/csv; charset=utf-8');
  res.set('content-disposition', `attachment; filename="submissions-${req.params.formId}.csv"`);
  res.send(toCsv(flat, columns));
});
```

- [ ] **Step 6: Deploy and verify the inbox**

Run:
```bash
cd form-backend && coho deploy && sleep 3
U=$(coho info formify-05tc dev | grep -o 'https://[a-z0-9-]*\.codehooks\.io')
FORM=$(curl -s -b /tmp/fb-cookies "$U/admin/api/forms" | python3 -c 'import sys,json; print(json.load(sys.stdin)["data"][0]["uuid"])')
echo "--- list ---"
curl -s -b /tmp/fb-cookies "$U/admin/api/forms/$FORM/submissions" | head -c 300; echo
echo "--- search ---"
curl -s -b /tmp/fb-cookies "$U/admin/api/forms/$FORM/submissions?search=ada" | python3 -c 'import sys,json; print(len(json.load(sys.stdin)["data"]), "match(es)")'
echo "--- csv ---"
curl -s -b /tmp/fb-cookies "$U/admin/api/forms/$FORM/export.csv"
```
Expected: a JSON list of submissions, a non-zero search match count, and CSV output with a `created,status,name,email` header.

- [ ] **Step 7: Commit**

```bash
git add form-backend/lib/csv.ts form-backend/test/csv.test.ts form-backend/index.ts
git commit -m "feat(form-backend): submission inbox API with search, files, and CSV export"
```

---

### Task 8: Full unit suite green

**Files:**
- Modify: none expected; fix any module surfaced as broken.

- [ ] **Step 1: Run the whole unit suite**

Run: `cd form-backend && npm test`
Expected: PASS — all tests across `multipart`, `body`, `validation`, and `csv` (38 total).

- [ ] **Step 2: Verify the deployed app compiles cleanly**

Run: `cd form-backend && coho verify`
Expected: `OK 🙌`

- [ ] **Step 3: Commit any fixes**

```bash
git add -A form-backend/
git commit -m "test(form-backend): full unit suite green for capture core"
```

---

## Done when

- `npm test` passes with unit coverage on all four pure modules.
- A deployed form accepts JSON, urlencoded, and multipart posts, storing files byte-intact.
- Forms CRUD and the submission inbox (search, status, star, notes, delete, file download, CSV) work against a live space.
- Unauthenticated admin requests are rejected.

Plan 2 (Admin UI) builds the SPA on top of this API.
