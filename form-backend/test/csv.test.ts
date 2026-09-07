import { test } from 'node:test';
import assert from 'node:assert';
import { toCsv, collectColumns, mapDataColumns } from '#lib/csv';

test('collectColumns unions keys across rows in first-seen order', () => {
  const rows = [{ data: { name: 'a', email: 'b' } }, { data: { email: 'c', phone: 'd' } }];
  assert.deepEqual(collectColumns(rows), ['name', 'email', 'phone']);
});

test('collectColumns renames "created"/"status" data fields rather than dropping them — those are admin-owned export columns, not data, but the submitted value must still survive', () => {
  const rows = [{ data: { name: 'Eve', status: 'read', created: '2001-01-01' } }];
  assert.deepEqual(collectColumns(rows), ['name', 'status (submitted)', 'created (submitted)']);
});

test('mapDataColumns maps every data key to its export header, admin-owned names renamed', () => {
  const rows = [{ data: { name: 'Eve', status: 'read', created: '2001-01-01' } }];
  const map = mapDataColumns(rows);
  assert.equal(map.get('name'), 'name');
  assert.equal(map.get('status'), 'status (submitted)');
  assert.equal(map.get('created'), 'created (submitted)');
});

test('mapDataColumns keeps disambiguating if the renamed header is itself already taken', () => {
  // A submission with both a `status` field AND a field literally named
  // "status (submitted)" — the second must not collide with the first's
  // rename.
  const rows = [{ data: { status: 'read', 'status (submitted)': 'literal field value' } }];
  const map = mapDataColumns(rows);
  assert.equal(map.get('status'), 'status (submitted)');
  assert.equal(map.get('status (submitted)'), 'status (submitted) (2)');
  // Two different data keys must never map to the same header.
  assert.notEqual(map.get('status'), map.get('status (submitted)'));
});

test('mapDataColumns leaves ordinary field names untouched and does not rename across rows redundantly', () => {
  const rows = [{ data: { email: 'a@b.com' } }, { data: { email: 'c@d.com', phone: '123' } }];
  const map = mapDataColumns(rows);
  assert.deepEqual([...map.entries()], [['email', 'email'], ['phone', 'phone']]);
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

test('toCsv neutralises formula injection hidden behind leading whitespace', () => {
  const csv = toCsv([{ a: '\t=1+1', b: ' =1+1' }], ['a', 'b']);
  assert.equal(csv, "a,b\r\n'\t=1+1,' =1+1");
});

test('toCsv does not mangle genuine negative numbers', () => {
  const csv = toCsv([{ a: '-5', b: '-5.5' }], ['a', 'b']);
  assert.equal(csv, 'a,b\r\n-5,-5.5');
});
