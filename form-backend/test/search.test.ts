import { test } from 'node:test';
import assert from 'node:assert';
import { filterAndPaginate, clampInt } from '#lib/search';

const rows = (n: number, hit: number[] = []) =>
  Array.from({ length: n }, (_, i) => ({
    _id: String(i),
    data: { name: hit.includes(i) ? 'Ada Lovelace' : `person ${i}` },
  }));

test('a match beyond the first page is still found', () => {
  const page = filterAndPaginate(rows(12, [11]), 'lovelace', 0, 5, 1000);
  assert.equal(page.total, 1);
  assert.equal(page.data.length, 1);
  assert.equal(page.data[0]._id, '11');
});

test('total counts every match, not just the returned page', () => {
  const page = filterAndPaginate(rows(30, [1, 5, 9, 20, 29]), 'lovelace', 0, 2, 1000);
  assert.equal(page.total, 5);
  assert.equal(page.data.length, 2);
});

test('offset pages through the filtered set', () => {
  const page = filterAndPaginate(rows(30, [1, 5, 9]), 'lovelace', 2, 2, 1000);
  assert.equal(page.total, 3);
  assert.deepEqual(page.data.map((r) => r._id), ['9']);
});

test('truncated is false at exactly the cap', () => {
  const page = filterAndPaginate(rows(10, [0]), 'lovelace', 0, 5, 10);
  assert.equal(page.truncated, false);
  assert.equal(page.total, 1);
});

test('truncated is true only when a row beyond the cap was returned', () => {
  const page = filterAndPaginate(rows(11, [0]), 'lovelace', 0, 5, 10);
  assert.equal(page.truncated, true);
});

test('the row beyond the cap is dropped rather than searched', () => {
  const page = filterAndPaginate(rows(11, [10]), 'lovelace', 0, 5, 10);
  assert.equal(page.total, 0);
  assert.equal(page.truncated, true);
});

test('an empty search term returns every scanned row', () => {
  const page = filterAndPaginate(rows(4), '', 0, 10, 1000);
  assert.equal(page.total, 4);
  assert.equal(page.data.length, 4);
});

test('no matches returns an empty page with a zero total', () => {
  const page = filterAndPaginate(rows(5), 'nobody', 0, 10, 1000);
  assert.deepEqual(page.data, []);
  assert.equal(page.total, 0);
  assert.equal(page.truncated, false);
});

test('search is case-insensitive across all data values', () => {
  const page = filterAndPaginate(
    [{ _id: 'a', data: { note: 'Interested in BILLING' } }],
    'billing',
    0,
    10,
    1000
  );
  assert.equal(page.total, 1);
});

test('a row with no data object does not throw', () => {
  const page = filterAndPaginate([{ _id: 'a' } as any], 'x', 0, 10, 1000);
  assert.equal(page.total, 0);
});

test('clampInt falls back for a non-numeric value', () => {
  assert.equal(clampInt('abc', 50, 1, 500), 50);
  assert.equal(clampInt(undefined, 50, 1, 500), 50);
});

test('clampInt bounds a value to the allowed range', () => {
  assert.equal(clampInt('99999', 50, 1, 500), 500);
  assert.equal(clampInt('-3', 0, 0, 1000), 0);
  assert.equal(clampInt('25', 50, 1, 500), 25);
});
