// Exercises PATCH/DELETE /admin/api/forms/:id and GET /admin/api/forms/:id/snippet
// through their REAL route handlers, not a reimplementation — same technique as
// test/submissions-route.test.ts and test/submission-detail-route.test.ts (see
// the comments there for why this is possible and what fakeDatastore stands in
// for). These are the three endpoints public/settings.js (Task 8) drives: Save
// settings (PATCH), the paste-in snippet (GET .../snippet), and Delete form
// (DELETE), including its cascade into submissions and deliveries.
//
// The DELETE route also calls `filestore.deleteFile(f.path)` for every uploaded
// file on every submission being removed. As in test/submission-detail-route.
// test.ts, that is not mocked: the route already wraps the call in its own
// try/catch, and codehooks-js's filestore.deleteFile throws synchronously
// outside the platform runtime — a throw the route's catch already absorbs. A
// delete-with-files test below exercises that real catch path.

import { test } from 'node:test';
import assert from 'node:assert';

process.env.JWT_SECRET = 'settings-route-test-secret';
process.env.ADMIN_PASSWORD = 'settings-route-test-password';

const { app } = await import('codehooks-js');
const indexModule = await import('../index.ts');
const manifest = indexModule.default;

const patchHandler = manifest.routehooks['PATCH /admin/api/forms/:id'][0];
const deleteHandler = manifest.routehooks['DELETE /admin/api/forms/:id'][0];
const snippetHandler = manifest.routehooks['GET /admin/api/forms/:id/snippet'][0];

// --- fakes -------------------------------------------------------------------

function matchesQuery(doc: any, query: Record<string, unknown>): boolean {
  for (const [key, expected] of Object.entries(query || {})) {
    if (doc[key] !== expected) return false;
  }
  return true;
}

function fakeDatastore(collections: Record<string, any[]>) {
  return {
    getMany(name: string, query: Record<string, unknown> = {}) {
      const rows = (collections[name] || []).filter((d) => matchesQuery(d, query));
      return { async toArray() { return rows; } };
    },
    async findOneOrNull(name: string, id: string) {
      return (collections[name] || []).find((d) => d._id === id) || null;
    },
    async updateOne(name: string, id: string, update: any) {
      const rows = collections[name] || [];
      const doc = rows.find((d) => d._id === id);
      if (!doc) return null;
      if (update.$set) Object.assign(doc, update.$set);
      return doc;
    },
    async removeOne(name: string, id: string) {
      const rows = collections[name] || [];
      const idx = rows.findIndex((d) => d._id === id);
      if (idx === -1) return null;
      const [removed] = rows.splice(idx, 1);
      return removed;
    },
    async removeMany(name: string, query: Record<string, unknown> = {}) {
      // Mutates the array IN PLACE (splice), not by reassigning
      // `collections[name]` to a new filtered array — the caller holds its own
      // reference to the original array (e.g. the `submissions` variable in a
      // test), and a reassignment here would leave that reference stale.
      const rows = collections[name] || [];
      let removed = 0;
      for (let i = rows.length - 1; i >= 0; i--) {
        if (matchesQuery(rows[i], query)) { rows.splice(i, 1); removed++; }
      }
      return { removed };
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

function form(id: string, overrides: Record<string, unknown> = {}) {
  return {
    _id: id,
    uuid: 'uuid-' + id,
    name: 'Test form',
    enabled: true,
    fields: [],
    strict: false,
    redirectUrl: '',
    allowRedirectOverride: false,
    allowedDomains: [],
    honeypot: '_gotcha',
    retentionDays: 0,
    created: '2026-09-01T00:00:00.000Z',
    updated: '2026-09-01T00:00:00.000Z',
    statsTotal: 0,
    statsSpam: 0,
    statsLastSubmissionAt: null,
    notify: { email: { enabled: false, recipients: [], subjectTemplate: '', attachFiles: true } },
    ...overrides,
  };
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

async function callSnippet(collections: Record<string, any[]>, id: string) {
  app.setDatastore(fakeDatastore(collections));
  const req = { params: { id }, headers: {} };
  const res = fakeRes();
  await snippetHandler(req, res);
  return res;
}

// --- PATCH: the shape settings.js's Save button sends ------------------------

test('PATCH form: notify + allowedDomains save together and round-trip', async () => {
  const forms = [form('f1')];
  const res = await callPatch({ forms }, 'f1', {
    notify: { email: { enabled: true, recipients: ['a@example.com', 'b@example.com'], subjectTemplate: 'New: {{form}}', attachFiles: false } },
    allowedDomains: ['example.com', 'sub.example.com'],
  });

  assert.equal(res.body.ok, true);
  assert.equal(res.body.data.notify.email.enabled, true);
  assert.deepEqual(res.body.data.notify.email.recipients, ['a@example.com', 'b@example.com']);
  assert.equal(res.body.data.notify.email.subjectTemplate, 'New: {{form}}');
  assert.equal(res.body.data.notify.email.attachFiles, false);
  assert.deepEqual(res.body.data.allowedDomains, ['example.com', 'sub.example.com']);
  // updated is server-stamped, not client-writable.
  assert.notEqual(forms[0].updated, '2026-09-01T00:00:00.000Z');
});

test('PATCH form: 404s for an id that does not resolve', async () => {
  const res = await callPatch({ forms: [form('f1')] }, 'nope', { allowedDomains: [] });
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.ok, false);
});

// --- PATCH: validation rejections --------------------------------------------
// The client (settings.js) pre-checks recipients with the same regex, but the
// server is the authority: it must reject regardless of what the client sent,
// per lib/recipients.ts checkNotifyPatch / checkRecipients.

test('PATCH form: an invalid recipient address is rejected with a named cause', async () => {
  const forms = [form('f1')];
  const res = await callPatch({ forms }, 'f1', {
    notify: { email: { enabled: true, recipients: ['team.customer.example'], subjectTemplate: '', attachFiles: true } },
  });
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.ok, false);
  assert.match(res.body.error, /team\.customer\.example/);
  // Rejected as a whole, not partially applied.
  assert.deepEqual(forms[0].notify.email.recipients, []);
});

test('PATCH form: notify.email as a non-object is a 400, not a platform crash', async () => {
  // Regression for the exact bug documented in index.ts: PATCH {"notify":
  // {"email": "a@b.com"}} used to throw inside the normalising assignment
  // rather than return a 400.
  const forms = [form('f1')];
  const res = await callPatch({ forms }, 'f1', { notify: { email: 'a@b.com' } });
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.ok, false);
  assert.match(res.body.error, /notify\.email must be an object/);
});

test('PATCH form: notify as a non-object is a 400', async () => {
  const res = await callPatch({ forms: [form('f1')] }, 'f1', { notify: 'on' });
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.ok, false);
  assert.match(res.body.error, /notify must be an object/);
});

test('PATCH form: a honeypot name colliding with a field is rejected', async () => {
  const forms = [form('f1', { fields: [{ name: 'email', type: 'email' }] })];
  const res = await callPatch({ forms }, 'f1', { honeypot: 'email' });
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.ok, false);
  assert.match(res.body.error, /honeypot cannot be "email"/);
});

// --- GET snippet ---------------------------------------------------------------

test('GET snippet: returns a paste-ready snippet posting to this form\'s endpoint', async () => {
  const forms = [form('f1', { uuid: 'the-uuid' })];
  const res = await callSnippet({ forms }, 'f1');
  assert.equal(res.body.ok, true);
  assert.match(res.body.snippet, /\/f\/the-uuid/);
  assert.match(res.body.snippet, /<form action=/);
});

test('GET snippet: 404s for a form that does not resolve', async () => {
  const res = await callSnippet({ forms: [form('f1')] }, 'not-a-real-form');
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.ok, false);
});

// --- DELETE, with its cascade --------------------------------------------------

test('DELETE form: removes the form itself', async () => {
  const forms = [form('f1'), form('f2')];
  const res = await callDelete({ forms, submissions: [], deliveries: [] }, 'f1');
  assert.equal(res.body.ok, true);
  assert.equal(res.body.deleted, true);
  assert.equal(forms.length, 1);
  assert.equal(forms[0]._id, 'f2');
});

test('DELETE form: cascades to its submissions and deliveries, sparing other forms\'', async () => {
  const forms = [form('f1', { uuid: 'uuid-f1' }), form('f2', { uuid: 'uuid-f2' })];
  const submissions = [
    { _id: 's1', formId: 'uuid-f1', files: [] },
    { _id: 's2', formId: 'uuid-f1', files: [] },
    { _id: 's3', formId: 'uuid-f2', files: [] },
  ];
  const deliveries = [
    { _id: 'd1', formId: 'uuid-f1' },
    { _id: 'd2', formId: 'uuid-f2' },
  ];

  const res = await callDelete({ forms, submissions, deliveries }, 'f1');

  assert.equal(res.body.ok, true);
  assert.deepEqual(submissions.map((s) => s._id), ['s3']);
  assert.deepEqual(deliveries.map((d) => d._id), ['d2']);
  assert.deepEqual(forms.map((f) => f._id), ['f2']);
});

test('DELETE form: a submission with uploaded files is still removed (filestore call is caught, not fatal)', async () => {
  const forms = [form('f1', { uuid: 'uuid-f1' })];
  const submissions = [
    { _id: 's1', formId: 'uuid-f1', files: [{ id: 'file1', filename: 'a.pdf', path: '/uploads/uuid-f1/s1/file1-a.pdf' }] },
  ];
  const res = await callDelete({ forms, submissions, deliveries: [] }, 'f1');
  assert.equal(res.body.ok, true);
  assert.equal(res.body.deleted, true);
  assert.equal(submissions.length, 0);
  assert.equal(forms.length, 0);
});

test('DELETE form: 404s for an id that does not resolve', async () => {
  const res = await callDelete({ forms: [form('f1')], submissions: [], deliveries: [] }, 'nope');
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.ok, false);
});
