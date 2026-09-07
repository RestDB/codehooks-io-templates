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
