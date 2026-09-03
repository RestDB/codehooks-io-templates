import { test } from 'node:test';
import assert from 'node:assert';
import { thanksPage, errorPage, escapeHtml } from '#lib/pages';

test('escapeHtml neutralises every HTML-significant character', () => {
  assert.equal(escapeHtml(`<script>"&'`), '&lt;script&gt;&quot;&amp;&#39;');
});

test('thanksPage renders the form name escaped', () => {
  const html = thanksPage('<img onerror=alert(1)>');
  assert.match(html, /Thank you/);
  assert.ok(!html.includes('<img'));
});

test('errorPage shows the message and a go-back link', () => {
  const html = errorPage('Validation failed');
  assert.match(html, /Validation failed/);
  assert.match(html, /history\.back\(\)/);
});

test('errorPage escapes attacker-controlled field names', () => {
  const html = errorPage('Validation failed', [
    { field: '<img src=x onerror=alert(1)>', message: 'Unknown field' },
  ]);
  assert.ok(!html.includes('<img'));
  assert.match(html, /&lt;img/);
});
