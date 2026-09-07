// Exercises GET /admin/api/forms/:formId/submissions through its REAL route
// handler, not a reimplementation of it. Until codehooks-js 1.4.11 (this repo
// now depends on ^1.4.11), index.ts could not be imported under `node --test`
// at all — see the now-stale comments in test/counting.test.ts and
// test/stats.test.ts saying so. That restriction is gone: index.ts is a plain
// ES module and `app.init()` hands back a manifest whose `routehooks` map is
// exactly what the platform dispatches to in production, keyed the same way
// ("GET /admin/api/forms/:formId/submissions"). Calling a handler straight out
// of that map, with req/res built by hand, exercises the literal code path a
// real request takes — query parsing, resolveForm, countCapped and all —
// without needing a live datastore, an HTTP server, or auth (auth is wired by
// the deployed platform around this map, not inside it, so bypassing it here
// is the same boundary a route-level unit test always has).
//
// The one piece that does need faking is Datastore.open(): it resolves
// whatever `app.setDatastore(...)` last set on the shared codehooks-js
// singleton. `fakeDatastore()` below is an in-memory stand-in supporting only
// the two calls this route's code path makes — `getMany(...).toArray()` and
// `findOneOrNull(...)` — with just enough query matching ($gte/$lte for the
// date range, otherwise exact equality) and sort/limit/offset to be honest
// about what a real page of results looks like.

import { test } from 'node:test';
import assert from 'node:assert';

// Read at module-evaluation time by index.ts's boot-time checkConfig() guard,
// so these must be set before index.ts is imported. They are not otherwise
// used by the submissions route.
process.env.JWT_SECRET = 'submissions-route-test-secret';
process.env.ADMIN_PASSWORD = 'submissions-route-test-password';

const { app } = await import('codehooks-js');
const indexModule = await import('../index.ts');
const manifest = indexModule.default;

const listHandler = manifest.routehooks['GET /admin/api/forms/:formId/submissions'][0];

// --- fakes -------------------------------------------------------------------

function matchesQuery(doc: any, query: Record<string, unknown>): boolean {
  for (const [key, expected] of Object.entries(query || {})) {
    if (expected && typeof expected === 'object' && !Array.isArray(expected)) {
      for (const [op, opVal] of Object.entries(expected as Record<string, unknown>)) {
        if (op === '$gte' && !(doc[key] >= (opVal as any))) return false;
        if (op === '$lte' && !(doc[key] <= (opVal as any))) return false;
      }
    } else if (doc[key] !== expected) {
      return false;
    }
  }
  return true;
}

function fakeDatastore(collections: Record<string, any[]>) {
  return {
    getMany(name: string, query: Record<string, unknown> = {}, options: any = {}) {
      let rows = (collections[name] || []).filter((d) => matchesQuery(d, query));
      if (options.sort) {
        const [[field, dir]] = Object.entries(options.sort) as [string, number][];
        rows = [...rows].sort((a, b) => {
          if (a[field] === b[field]) return 0;
          const cmp = a[field] < b[field] ? -1 : 1;
          return dir === -1 ? -cmp : cmp;
        });
      }
      const offset = options.offset || 0;
      let sliced = rows.slice(offset);
      if (typeof options.limit === 'number') sliced = sliced.slice(0, options.limit);
      return { async toArray() { return sliced; } };
    },
    async findOneOrNull(name: string, id: string) {
      return (collections[name] || []).find((d) => d._id === id) || null;
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
    data: {},
    files: [],
    status: 'new',
    starred: false,
    ...overrides,
  };
}

const FORM = { _id: 'form-doc-1', uuid: 'uuid-1', name: 'Test form' };

async function callList(collections: Record<string, any[]>, query: Record<string, unknown> = {}) {
  app.setDatastore(fakeDatastore(collections));
  const req = { params: { formId: 'uuid-1' }, query };
  const res = fakeRes();
  await listHandler(req, res);
  return res;
}

// --- non-search path: total/exact -------------------------------------------

test('GET submissions: returns total and exact on the non-search path', async () => {
  const subs = [
    submission('s1', { created: '2026-09-01T00:00:00.000Z' }),
    submission('s2', { created: '2026-09-02T00:00:00.000Z' }),
    submission('s3', { created: '2026-09-03T00:00:00.000Z' }),
  ];
  const res = await callList({ forms: [FORM], submissions: subs });

  assert.equal(res.body.ok, true);
  assert.equal(res.body.total, 3);
  assert.equal(res.body.exact, true);
  assert.equal(res.body.data.length, 3);
  // Newest first: the route sorts { created: -1 }.
  assert.deepEqual(res.body.data.map((d: any) => d._id), ['s3', 's2', 's1']);
});

test('GET submissions: 404s for a form that does not resolve', async () => {
  app.setDatastore(fakeDatastore({ forms: [FORM], submissions: [] }));
  const req = { params: { formId: 'not-a-real-form' }, query: {} };
  const res = fakeRes();
  await listHandler(req, res);
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.ok, false);
});

// --- status filter narrows the result ----------------------------------------

test('GET submissions: a status filter narrows the result to that status', async () => {
  const subs = [
    submission('n1', { status: 'new', created: '2026-09-01T00:00:00.000Z' }),
    submission('n2', { status: 'new', created: '2026-09-02T00:00:00.000Z' }),
    submission('r1', { status: 'read', created: '2026-09-03T00:00:00.000Z' }),
    submission('a1', { status: 'archived', created: '2026-09-04T00:00:00.000Z' }),
    submission('sp1', { status: 'spam', created: '2026-09-05T00:00:00.000Z' }),
  ];

  const res = await callList({ forms: [FORM], submissions: subs }, { status: 'new' });
  assert.equal(res.body.ok, true);
  assert.equal(res.body.total, 2);
  assert.deepEqual(new Set(res.body.data.map((d: any) => d._id)), new Set(['n1', 'n2']));
  assert.ok(res.body.data.every((d: any) => d.status === 'new'));

  const spamRes = await callList({ forms: [FORM], submissions: subs }, { status: 'spam' });
  assert.equal(spamRes.body.total, 1);
  assert.equal(spamRes.body.data[0]._id, 'sp1');
});

// --- limit/offset page correctly ---------------------------------------------

test('GET submissions: limit/offset page through the (sorted) result set', async () => {
  const subs = Array.from({ length: 5 }, (_, i) =>
    submission('p' + i, { created: `2026-09-0${i + 1}T00:00:00.000Z` })
  );
  // Newest first: p4 (09-05) .. p0 (09-01).

  const page1 = await callList({ forms: [FORM], submissions: subs }, { limit: 2, offset: 0 });
  assert.equal(page1.body.total, 5);
  assert.equal(page1.body.exact, true);
  assert.deepEqual(page1.body.data.map((d: any) => d._id), ['p4', 'p3']);

  const page2 = await callList({ forms: [FORM], submissions: subs }, { limit: 2, offset: 2 });
  assert.equal(page2.body.total, 5);
  assert.deepEqual(page2.body.data.map((d: any) => d._id), ['p2', 'p1']);

  const page3 = await callList({ forms: [FORM], submissions: subs }, { limit: 2, offset: 4 });
  assert.equal(page3.body.total, 5);
  assert.deepEqual(page3.body.data.map((d: any) => d._id), ['p0']);

  // Past the end: no rows, but the same honest total.
  const page4 = await callList({ forms: [FORM], submissions: subs }, { limit: 2, offset: 6 });
  assert.equal(page4.body.total, 5);
  assert.deepEqual(page4.body.data, []);
});

// --- search path: exercised too, since the route branches on it entirely ----

test('GET submissions: the search path narrows by data content and reports exact', async () => {
  const subs = [
    submission('m1', { data: { message: 'please help with billing' }, created: '2026-09-01T00:00:00.000Z' }),
    submission('m2', { data: { message: 'a totally unrelated note' }, created: '2026-09-02T00:00:00.000Z' }),
    submission('m3', { data: { message: 'BILLING question again' }, created: '2026-09-03T00:00:00.000Z' }),
  ];
  const res = await callList({ forms: [FORM], submissions: subs }, { search: 'billing' });
  assert.equal(res.body.ok, true);
  assert.equal(res.body.total, 2);
  assert.equal(res.body.exact, true);
  assert.deepEqual(new Set(res.body.data.map((d: any) => d._id)), new Set(['m1', 'm3']));
});

// --- date range: `to` is inclusive of the whole day it names -----------------
// The dashboard sends bare `YYYY-MM-DD` values for both `from` and `to`, and
// `created` is stored as a full ISO timestamp. `from` (>=) already includes
// the whole day for free — a bare date sorts before any timestamp on that
// day. `to` (<=) does not: a bare date sorts before every timestamp on that
// day except exact midnight, so without normalising it, a submission made at
// 14:30 on the `to` day is wrongly excluded from both the rows and `total`.

test('GET submissions: a bare `to` date includes a submission made midday on that date', async () => {
  const subs = [
    submission('boundary', { created: '2026-09-06T14:30:00.000Z' }),
  ];
  const res = await callList({ forms: [FORM], submissions: subs }, { from: '2026-09-05', to: '2026-09-06' });
  assert.equal(res.body.ok, true);
  assert.equal(res.body.total, 1);
  assert.deepEqual(res.body.data.map((d: any) => d._id), ['boundary']);
});

test('GET submissions: a bare `to` date excludes a submission made the following day', async () => {
  const subs = [
    submission('next-day', { created: '2026-09-07T00:00:01.000Z' }),
  ];
  const res = await callList({ forms: [FORM], submissions: subs }, { from: '2026-09-05', to: '2026-09-06' });
  assert.equal(res.body.ok, true);
  assert.equal(res.body.total, 0);
  assert.deepEqual(res.body.data, []);
});

test('GET submissions: a bare `from` date already includes a submission made midday on that date', async () => {
  const subs = [
    submission('from-boundary', { created: '2026-09-05T14:30:00.000Z' }),
  ];
  const res = await callList({ forms: [FORM], submissions: subs }, { from: '2026-09-05', to: '2026-09-06' });
  assert.equal(res.body.ok, true);
  assert.equal(res.body.total, 1);
  assert.deepEqual(res.body.data.map((d: any) => d._id), ['from-boundary']);
});
