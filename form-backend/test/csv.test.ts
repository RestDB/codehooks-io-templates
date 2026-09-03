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
