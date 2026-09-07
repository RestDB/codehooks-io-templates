// Exercises GET /admin/api/forms/:formId/export.csv through its REAL route
// handler (see submissions-route.test.ts for why this is possible and what it
// proves). This pins Finding 3 of the 2026-09-06 final review, round 2: a
// submission with a data field literally named "status" or "created" must
// never be able to overwrite the admin's real triage status or timestamp in
// the export, and — round 1 of this fix got this half wrong — that submitted
// field must still survive the export under its own, disambiguated header,
// not be silently dropped.

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

test('export.csv: a submitted "status"/"created" field cannot overwrite the real triage columns, and survives under its own header', async () => {
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
  // No duplicate "status"/"created" headers, but the submitted fields
  // sharing those names are RENAMED into the export, not dropped from it.
  assert.equal(header, 'created,status,name,status (submitted),created (submitted)');
  // The real admin values occupy the real columns...
  assert.equal(rows[0], '2026-09-01T00:00:00.000Z,spam,Eve,read,2001-01-01');
  // ...and the submitter's own "read"/"2001-01-01" are not lost — they are
  // the last two cells, under the disambiguated headers.
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

test('export.csv: header row and value rows stay aligned when only some submissions have the colliding field', async () => {
  const subs = [
    // s1 has no data fields colliding with the admin columns at all.
    { _id: 's1', formId: 'uuid-1', created: '2026-09-01T00:00:00.000Z', status: 'new', data: { email: 'a@b.com' } },
    // s2 introduces the "status" collision — the header set is unioned
    // across ALL rows, so s1's row must still render an empty cell under
    // the new column, not a shifted/misaligned row.
    {
      _id: 's2', formId: 'uuid-1', created: '2026-09-02T00:00:00.000Z', status: 'read',
      data: { email: 'c@d.com', status: 'archived' },
    },
  ];
  const res = await callExport({ forms: [FORM], submissions: subs });
  const [header, row1, row2] = String(res.body).split('\r\n');
  assert.equal(header, 'created,status,email,status (submitted)');
  assert.equal(row1, '2026-09-01T00:00:00.000Z,new,a@b.com,');
  assert.equal(row2, '2026-09-02T00:00:00.000Z,read,c@d.com,archived');
});
