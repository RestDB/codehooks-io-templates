// Exercises GET /admin/api/forms/:formId/export.csv through its REAL route
// handler (see submissions-route.test.ts for why this is possible and what it
// proves). This pins Finding 3 of the 2026-09-06 final review: a submission
// with a data field literally named "status" or "created" must never be able
// to overwrite the admin's real triage status or timestamp in the export, or
// produce a duplicate CSV header.

import { test } from 'node:test';
import assert from 'node:assert';

process.env.JWT_SECRET = 'export-route-test-secret';
process.env.ADMIN_PASSWORD = 'export-route-test-password';

const { app } = await import('codehooks-js');
const indexModule = await import('../index.ts');
const manifest = indexModule.default;

const exportHandler = manifest.routehooks['GET /admin/api/forms/:formId/export.csv'][0];

function fakeDatastore(collections: Record<string, any[]>) {
  return {
    getMany(name: string, query: Record<string, unknown> = {}) {
      const rows = (collections[name] || []).filter((d) =>
        Object.entries(query || {}).every(([k, v]) => d[k] === v)
      );
      return { async toArray() { return rows; } };
    },
    async findOneOrNull(name: string, id: string) {
      return (collections[name] || []).find((d) => d._id === id) || null;
    },
  };
}

function fakeRes() {
  return {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: undefined as any,
    status(code: number) { this.statusCode = code; return this; },
    set(key: string, value: string) { this.headers[key] = value; return this; },
    json(payload: any) { this.body = payload; return this; },
    send(payload: any) { this.body = payload; return this; },
  };
}

const FORM = { _id: 'form-doc-1', uuid: 'uuid-1', name: 'Test form' };

async function callExport(collections: Record<string, any[]>) {
  app.setDatastore(fakeDatastore(collections));
  const req = { params: { formId: 'uuid-1' }, query: {} };
  const res = fakeRes();
  await exportHandler(req, res);
  return res;
}

test('export.csv: a submitted "status"/"created" field cannot overwrite the real triage columns', async () => {
  const subs = [
    {
      _id: 's1',
      formId: 'uuid-1',
      created: '2026-09-01T00:00:00.000Z',
      status: 'spam',
      data: { name: 'Eve', status: 'read', created: '2001-01-01' },
    },
  ];
  const res = await callExport({ forms: [FORM], submissions: subs });

  const [header, ...rows] = String(res.body).split('\r\n');
  // No duplicate "status"/"created" headers — the submitted fields sharing
  // those names are excluded from the data columns.
  assert.equal(header, 'created,status,name');
  // The real admin values survive, not the submitted lookalikes.
  assert.equal(rows[0], '2026-09-01T00:00:00.000Z,spam,Eve');
});

test('export.csv: a form with no name/status collisions is unaffected', async () => {
  const subs = [
    { _id: 's1', formId: 'uuid-1', created: '2026-09-01T00:00:00.000Z', status: 'new', data: { email: 'a@b.com' } },
  ];
  const res = await callExport({ forms: [FORM], submissions: subs });
  const [header, ...rows] = String(res.body).split('\r\n');
  assert.equal(header, 'created,status,email');
  assert.equal(rows[0], '2026-09-01T00:00:00.000Z,new,a@b.com');
});
