// Exercises GET/PATCH/DELETE /admin/api/submissions/:id through their REAL
// route handlers, not a reimplementation of them — same technique as
// test/submissions-route.test.ts (see the comments there for why this is
// possible now, and what fakeDatastore stands in for). This file's fake adds
// `updateOne` and `removeOne`, the two calls the detail routes make that the
// list route's fake didn't need.
//
// The DELETE route also calls `filestore.deleteFile(f.path)` for every
// uploaded file on the submission being removed. That is not mocked here:
// index.ts already wraps the call in its own try/catch ("Log rather than
// swallow: the row is deleted either way..."), and `codehooks-js`'s
// `filestore.deleteFile` reaches an undefined `_coho_fs` outside the platform
// runtime, which throws synchronously the moment it is called — a throw the
// route's try/catch already absorbs. So a delete-with-files test exercises
// the real catch path (and prints a harmless "Failed to delete uploaded
// file" line) rather than needing a filestore fake.

import { test } from 'node:test';
import assert from 'node:assert';

process.env.JWT_SECRET = 'submission-detail-route-test-secret';
process.env.ADMIN_PASSWORD = 'submission-detail-route-test-password';

const { app } = await import('codehooks-js');
const indexModule = await import('../index.ts');
const manifest = indexModule.default;

const getHandler = manifest.routehooks['GET /admin/api/submissions/:id'][0];
const patchHandler = manifest.routehooks['PATCH /admin/api/submissions/:id'][0];
const deleteHandler = manifest.routehooks['DELETE /admin/api/submissions/:id'][0];

// --- fakes -------------------------------------------------------------------

function fakeDatastore(collections: Record<string, any[]>) {
  return {
    async findOneOrNull(name: string, id: string) {
      return (collections[name] || []).find((d) => d._id === id) || null;
    },
    async updateOne(name: string, id: string, update: any) {
      const rows = collections[name] || [];
      const doc = rows.find((d) => d._id === id);
      if (!doc) return null;
      if (update.$set) Object.assign(doc, update.$set);
      if (update.$push) {
        for (const [key, val] of Object.entries(update.$push)) {
          if (!Array.isArray(doc[key])) doc[key] = [];
          doc[key].push(val);
        }
      }
      return doc;
    },
    async removeOne(name: string, id: string) {
      const rows = collections[name] || [];
      const idx = rows.findIndex((d) => d._id === id);
      if (idx === -1) return null;
      const [removed] = rows.splice(idx, 1);
      return removed;
    },
  };
}

function fakeRes() {
  return {
    statusCode: 200,
    body: undefined as any,
    status(code: number) { this.statusCode = code; return this; },
    json(payload: any) { this.body = payload; return this; },
  };
}

function submission(id: string, overrides: Record<string, unknown> = {}) {
  return {
    _id: id,
    formId: 'uuid-1',
    submissionId: 'sub-' + id,
    created: '2026-09-01T00:00:00.000Z',
    data: { name: 'Ada Lovelace', email: 'ada@example.com' },
    files: [],
    meta: { ip: '203.0.113.44', userAgent: 'test-agent', referer: 'https://example.com' },
    status: 'new',
    starred: false,
    notes: [],
    ...overrides,
  };
}

async function callGet(collections: Record<string, any[]>, id: string) {
  app.setDatastore(fakeDatastore(collections));
  const req = { params: { id } };
  const res = fakeRes();
  await getHandler(req, res);
  return res;
}

async function callPatch(collections: Record<string, any[]>, id: string, body: Record<string, unknown>) {
  app.setDatastore(fakeDatastore(collections));
  const req = { params: { id }, body };
  const res = fakeRes();
  await patchHandler(req, res);
  return res;
}

async function callDelete(collections: Record<string, any[]>, id: string) {
  app.setDatastore(fakeDatastore(collections));
  const req = { params: { id } };
  const res = fakeRes();
  await deleteHandler(req, res);
  return res;
}

// --- GET -----------------------------------------------------------------

test('GET submission: returns the submission when found', async () => {
  const subs = [submission('s1')];
  const res = await callGet({ submissions: subs }, 's1');
  assert.equal(res.body.ok, true);
  assert.equal(res.body.data._id, 's1');
  assert.deepEqual(res.body.data.data, { name: 'Ada Lovelace', email: 'ada@example.com' });
});

test('GET submission: 404s for an id that does not resolve', async () => {
  const res = await callGet({ submissions: [submission('s1')] }, 'not-a-real-id');
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.ok, false);
});

// --- PATCH: status ---------------------------------------------------------

test('PATCH submission: a valid status is applied and returned', async () => {
  const subs = [submission('s1', { status: 'new' })];
  const res = await callPatch({ submissions: subs }, 's1', { status: 'read' });
  assert.equal(res.body.ok, true);
  assert.equal(res.body.data.status, 'read');
  assert.equal(subs[0].status, 'read');
});

test('PATCH submission: an invalid status is silently dropped, not applied', async () => {
  const subs = [submission('s1', { status: 'new' })];
  const res = await callPatch({ submissions: subs }, 's1', { status: 'deleted-forever' });
  // No valid field to update and no note: the route reports 400 rather than
  // silently no-op'ing a request the caller thought did something.
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.ok, false);
  assert.equal(subs[0].status, 'new');
});

test('PATCH submission: 404s for an id that does not resolve', async () => {
  const res = await callPatch({ submissions: [submission('s1')] }, 'nope', { status: 'read' });
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.ok, false);
});

// --- PATCH: starred ---------------------------------------------------------

test('PATCH submission: starred true/false is applied and returned', async () => {
  const subs = [submission('s1', { starred: false })];

  const on = await callPatch({ submissions: subs }, 's1', { starred: true });
  assert.equal(on.body.ok, true);
  assert.equal(on.body.data.starred, true);

  const off = await callPatch({ submissions: subs }, 's1', { starred: false });
  assert.equal(off.body.data.starred, false);
});

// --- PATCH: note append ------------------------------------------------------

test('PATCH submission: a note is appended, not replaced, with a timestamp', async () => {
  const subs = [submission('s1', { notes: [{ text: 'first', at: '2026-09-01T00:00:00.000Z' }] })];
  const res = await callPatch({ submissions: subs }, 's1', { note: 'second' });

  assert.equal(res.body.ok, true);
  assert.equal(res.body.data.notes.length, 2);
  assert.equal(res.body.data.notes[0].text, 'first');
  assert.equal(res.body.data.notes[1].text, 'second');
  assert.equal(typeof res.body.data.notes[1].at, 'string');
  assert.ok(!Number.isNaN(new Date(res.body.data.notes[1].at).getTime()));
});

test('PATCH submission: a note is truncated to 2000 characters', async () => {
  const subs = [submission('s1')];
  const long = 'x'.repeat(2500);
  const res = await callPatch({ submissions: subs }, 's1', { note: long });
  assert.equal(res.body.data.notes[0].text.length, 2000);
});

test('PATCH submission: status and a note can land in the same request', async () => {
  const subs = [submission('s1', { status: 'new' })];
  const res = await callPatch({ submissions: subs }, 's1', { status: 'read', note: 'triaged' });
  assert.equal(res.body.data.status, 'read');
  assert.equal(res.body.data.notes[0].text, 'triaged');
});

test('PATCH submission: an empty body with nothing to update is a 400', async () => {
  const subs = [submission('s1')];
  const res = await callPatch({ submissions: subs }, 's1', {});
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.ok, false);
});

// --- DELETE ------------------------------------------------------------------

test('DELETE submission: removes the row and reports deleted', async () => {
  const subs = [submission('s1'), submission('s2')];
  const res = await callDelete({ submissions: subs }, 's1');
  assert.equal(res.body.ok, true);
  assert.equal(res.body.deleted, true);
  assert.equal(subs.length, 1);
  assert.equal(subs[0]._id, 's2');
});

test('DELETE submission: 404s for an id that does not resolve', async () => {
  const res = await callDelete({ submissions: [submission('s1')] }, 'nope');
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.ok, false);
});

test('DELETE submission: a submission with attached files is still removed', async () => {
  // Exercises the per-file filestore.deleteFile() loop and its try/catch —
  // see the file header for why this does not need a filestore fake.
  const subs = [submission('s1', {
    files: [{ id: 'f1', filename: 'a.pdf', path: '/uploads/uuid-1/sub-s1/f1-a.pdf', size: 10, contentType: 'application/pdf' }],
  })];
  const res = await callDelete({ submissions: subs }, 's1');
  assert.equal(res.body.ok, true);
  assert.equal(res.body.deleted, true);
  assert.equal(subs.length, 0);
});
