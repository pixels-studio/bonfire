import assert from 'node:assert/strict';
import { test } from 'node:test';
import { toBrowserUrl } from '../src/lib/components/browser-view/browser-url';

test('keeps web URLs as they are', () => {
  assert.equal(
    toBrowserUrl(' https://example.com/a?b=1 '),
    'https://example.com/a?b=1',
  );
  assert.equal(toBrowserUrl('http://example.com'), 'http://example.com/');
});

test('opens local servers over http', () => {
  assert.equal(toBrowserUrl('localhost:3000'), 'http://localhost:3000/');
  assert.equal(toBrowserUrl('localhost'), 'http://localhost/');
  assert.equal(toBrowserUrl('127.0.0.1:5173/app'), 'http://127.0.0.1:5173/app');
  assert.equal(toBrowserUrl('myhost:8080'), 'http://myhost:8080/');
});

test('opens bare domains over https', () => {
  assert.equal(toBrowserUrl('example.com'), 'https://example.com/');
  assert.equal(
    toBrowserUrl('docs.example.dev/path'),
    'https://docs.example.dev/path',
  );
});

test('searches for anything else', () => {
  assert.equal(
    toBrowserUrl('svelte runes'),
    'https://www.google.com/search?q=svelte%20runes',
  );
});

test('refuses other schemes and empty input', () => {
  assert.equal(toBrowserUrl('file:///etc/passwd'), undefined);
  assert.equal(toBrowserUrl('javascript:alert(1)'), undefined);
  assert.equal(toBrowserUrl('   '), undefined);
});
