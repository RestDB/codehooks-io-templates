import { test } from 'node:test';
import assert from 'node:assert';
import { buildSnippet } from '#lib/snippet';

const form: any = {
  uuid: 'abc-123',
  name: 'Contact',
  honeypot: '_gotcha',
  fields: [],
};

test('the action points at this form endpoint', () => {
  const html = buildSnippet(form, 'https://api.example.com');
  assert.match(html, /action="https:\/\/api\.example\.com\/f\/abc-123"/);
});

test('it posts as multipart so file inputs work', () => {
  const html = buildSnippet(form, 'https://api.example.com');
  assert.match(html, /method="POST"/);
  assert.match(html, /enctype="multipart\/form-data"/);
});

test('it always includes the honeypot, hidden and untabbable', () => {
  const html = buildSnippet(form, 'https://api.example.com');
  assert.match(html, /name="_gotcha"/);
  assert.match(html, /display:none/);
  assert.match(html, /tabindex="-1"/);
});

test('the honeypot uses the form-configured name', () => {
  const html = buildSnippet({ ...form, honeypot: 'website' }, 'https://api.example.com');
  assert.match(html, /name="website"/);
  assert.ok(!html.includes('name="_gotcha"'));
});

test('a schema-less form still yields a usable starter form', () => {
  const html = buildSnippet(form, 'https://api.example.com');
  assert.match(html, /name="name"/);
  assert.match(html, /name="email"/);
  assert.match(html, /<button/);
});

test('declared fields are rendered with the right input types', () => {
  const html = buildSnippet(
    { ...form, fields: [
      { name: 'email', type: 'email', required: true },
      { name: 'message', type: 'textarea' },
      { name: 'cv', type: 'file' },
    ] },
    'https://api.example.com'
  );
  assert.match(html, /<input[^>]*type="email"[^>]*name="email"[^>]*required/);
  assert.match(html, /<textarea[^>]*name="message"/);
  assert.match(html, /<input[^>]*type="file"[^>]*name="cv"/);
});

test('a select renders its options', () => {
  const html = buildSnippet(
    { ...form, fields: [{ name: 'plan', type: 'select', options: ['free', 'pro'] }] },
    'https://api.example.com'
  );
  assert.match(html, /<select[^>]*name="plan"/);
  assert.match(html, /<option value="free">/);
});

test('field names are escaped so a crafted name cannot break out of the attribute', () => {
  const html = buildSnippet(
    { ...form, fields: [{ name: 'a" onfocus="alert(1)', type: 'text' }] },
    'https://api.example.com'
  );
  assert.ok(!html.includes('onfocus="alert(1)"'));
});
