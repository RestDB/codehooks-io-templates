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

test('parseBody joins repeated multipart names exactly like urlencoded', async () => {
  const B = 'zzz';
  const req: any = new EventEmitter();
  req.headers = { 'content-type': `multipart/form-data; boundary=${B}` };
  req.body = {};
  const p = parseBody(req, 1024 * 1024);
  const part = (v: string) =>
    `--${B}\r\nContent-Disposition: form-data; name="topics"\r\n\r\n${v}\r\n`;
  req.emit('data', Buffer.from(part('sales') + part('support') + part('billing') + `--${B}--\r\n`, 'utf8'));
  req.emit('end');
  const multipart = await p;

  const urlencoded = await parseBody(
    {
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: { topics: ['sales', 'support', 'billing'] },
    } as any,
    1024
  );

  assert.equal(multipart.fields.topics, 'sales, support, billing');
  assert.deepEqual(multipart.fields, urlencoded.fields);
});

test('parseBody leaves a single multipart occurrence unchanged', async () => {
  const B = 'zzz';
  const req: any = new EventEmitter();
  req.headers = { 'content-type': `multipart/form-data; boundary=${B}` };
  req.body = {};
  const p = parseBody(req, 1024 * 1024);
  req.emit(
    'data',
    Buffer.from(`--${B}\r\nContent-Disposition: form-data; name="topics"\r\n\r\nsales\r\n--${B}--\r\n`, 'utf8')
  );
  req.emit('end');
  assert.deepEqual((await p).fields, { topics: 'sales' });
});

test('parseBody throws MALFORMED_BODY when the multipart boundary is missing', async () => {
  const req: any = new EventEmitter();
  req.headers = { 'content-type': 'multipart/form-data' };
  req.body = {};
  await assert.rejects(() => parseBody(req, 1024), /MALFORMED_BODY/);
});
