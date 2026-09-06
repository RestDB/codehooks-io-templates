import { test } from 'node:test';
import assert from 'node:assert';
import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { boundaryFromContentType, parseMultipart, readRequestBody } from '#lib/multipart';

const B = 'xBoundary123';

function buildBody(parts: Array<{ name: string; value?: string; filename?: string; contentType?: string; content?: Buffer }>): Buffer {
  const chunks: Buffer[] = [];
  for (const p of parts) {
    let head = `--${B}\r\nContent-Disposition: form-data; name="${p.name}"`;
    if (p.filename !== undefined) head += `; filename="${p.filename}"`;
    head += '\r\n';
    if (p.contentType) head += `Content-Type: ${p.contentType}\r\n`;
    head += '\r\n';
    chunks.push(Buffer.from(head, 'utf8'));
    chunks.push(p.content ?? Buffer.from(p.value ?? '', 'utf8'));
    chunks.push(Buffer.from('\r\n', 'utf8'));
  }
  chunks.push(Buffer.from(`--${B}--\r\n`, 'utf8'));
  return Buffer.concat(chunks);
}

test('boundaryFromContentType extracts a bare boundary', () => {
  assert.equal(boundaryFromContentType('multipart/form-data; boundary=abc123'), 'abc123');
});

test('boundaryFromContentType extracts a quoted boundary', () => {
  assert.equal(boundaryFromContentType('multipart/form-data; boundary="a b c"'), 'a b c');
});

test('boundaryFromContentType returns null when absent', () => {
  assert.equal(boundaryFromContentType('application/json'), null);
});

test('parseMultipart reads plain text fields', () => {
  const buf = buildBody([
    { name: 'name', value: 'Ada Lovelace' },
    { name: 'email', value: 'ada@example.com' },
  ]);
  const out = parseMultipart(buf, B);
  assert.deepEqual(out.fields, { name: 'Ada Lovelace', email: 'ada@example.com' });
  assert.equal(out.files.length, 0);
});

test('parseMultipart preserves binary file content byte-for-byte', () => {
  // 1x1 transparent PNG — the exact fixture verified in the design spike
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    'base64'
  );
  const buf = buildBody([
    { name: 'name', value: 'Ada' },
    { name: 'upload', filename: 'tiny.png', contentType: 'image/png', content: png },
  ]);
  const out = parseMultipart(buf, B);
  assert.equal(out.fields.name, 'Ada');
  assert.equal(out.files.length, 1);
  assert.equal(out.files[0].field, 'upload');
  assert.equal(out.files[0].filename, 'tiny.png');
  assert.equal(out.files[0].contentType, 'image/png');
  assert.equal(out.files[0].content.length, png.length);
  assert.equal(
    createHash('md5').update(out.files[0].content).digest('hex'),
    createHash('md5').update(png).digest('hex')
  );
});

test('parseMultipart survives a 2MB binary spanning many chunks', () => {
  const big = Buffer.alloc(2 * 1024 * 1024);
  for (let i = 0; i < big.length; i++) big[i] = i % 256;
  const buf = buildBody([{ name: 'f', filename: 'big.bin', contentType: 'application/octet-stream', content: big }]);
  const out = parseMultipart(buf, B);
  assert.equal(out.files[0].content.length, big.length);
  assert.ok(out.files[0].content.equals(big));
});

test('parseMultipart ignores an empty file input', () => {
  const buf = buildBody([
    { name: 'upload', filename: '', contentType: 'application/octet-stream', content: Buffer.alloc(0) },
    { name: 'name', value: 'Ada' },
  ]);
  const out = parseMultipart(buf, B);
  assert.equal(out.files.length, 0);
  assert.equal(out.fields.name, 'Ada');
});

test('readRequestBody concatenates streamed chunks', async () => {
  const req: any = new EventEmitter();
  const p = readRequestBody(req, 1024);
  req.emit('data', Buffer.from('hello '));
  req.emit('data', Buffer.from('world'));
  req.emit('end');
  assert.equal((await p).toString(), 'hello world');
});

test('readRequestBody rejects a body over the cap', async () => {
  const req: any = new EventEmitter();
  const p = readRequestBody(req, 4);
  req.emit('data', Buffer.from('toolong'));
  await assert.rejects(p, /PAYLOAD_TOO_LARGE/);
});

test('parseMultipart survives --boundary in file content (no preceding CRLF)', () => {
  // File content containing the literal boundary bytes WITHOUT preceding CRLF.
  // The old parser would incorrectly treat this as a delimiter and truncate.
  // The fixed parser must identify that \r\n is NOT before it and treat it as data.
  const maliciousContent = Buffer.from('start--xBoundary123end');
  const buf = buildBody([
    { name: 'f', filename: 'tricky.bin', contentType: 'application/octet-stream', content: maliciousContent },
    { name: 'name', value: 'Ada' },
  ]);
  const out = parseMultipart(buf, B);
  assert.equal(out.files.length, 1, 'Must preserve the file with boundary-like content');
  assert.equal(out.files[0].content.length, maliciousContent.length, 'Content length must match exactly');
  assert.ok(out.files[0].content.equals(maliciousContent), 'Content must be byte-identical');
  assert.equal(out.fields.name, 'Ada', 'Text field after the file must be preserved');
});

test('parseMultipart keeps every value for a repeated field name', () => {
  const buf = buildBody([
    { name: 'topics', value: 'sales' },
    { name: 'topics', value: 'support' },
    { name: 'topics', value: 'billing' },
  ]);
  const out = parseMultipart(buf, B);
  assert.deepEqual(out.fields.topics, ['sales', 'support', 'billing']);
});

test('parseMultipart leaves a single occurrence as a plain string', () => {
  const out = parseMultipart(buildBody([{ name: 'topics', value: 'sales' }]), B);
  assert.equal(out.fields.topics, 'sales');
});

test('parseMultipart stores a field named after an Object.prototype member', () => {
  // A plain object would return the inherited function here, sending this down the
  // repeated-name path and corrupting the value.
  const buf = buildBody([{ name: 'constructor', value: 'Acme Corp' }]);
  const out = parseMultipart(buf, B);
  assert.equal(out.fields.constructor, 'Acme Corp');
});

test('parseMultipart still joins genuinely repeated names', () => {
  const buf = buildBody([
    { name: 'topics', value: 'sales' },
    { name: 'topics', value: 'billing' },
  ]);
  const out = parseMultipart(buf, B);
  assert.deepEqual(out.fields.topics, ['sales', 'billing']);
});
