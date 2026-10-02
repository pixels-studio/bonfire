import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  MAX_TOOL_OUTPUT,
  clipOutput,
  partialToolInput,
  toolInput,
} from '../electron/main/tool-text';

test('clipOutput leaves short output alone', () => {
  assert.equal(clipOutput('hello'), 'hello');
});

test('clipOutput keeps the start and the end of long output', () => {
  const text = `START${'x'.repeat(MAX_TOOL_OUTPUT * 2)}END`;
  const clipped = clipOutput(text);
  assert(clipped.startsWith('START'));
  assert(clipped.endsWith('END'));
  assert.match(clipped, /characters omitted/);
  assert(clipped.length < MAX_TOOL_OUTPUT + 100);
});

test('toolInput picks the most telling argument', () => {
  assert.equal(toolInput({ command: 'ls', description: 'list' }), 'ls');
  assert.equal(toolInput({ file_path: '/a/b.ts', content: 'x' }), '/a/b.ts');
  assert.equal(toolInput({ other: 1 }), '{"other":1}');
  assert.equal(toolInput(null), '');
});

test('partialToolInput reads an argument before the JSON is complete', () => {
  assert.equal(partialToolInput(''), '');
  assert.equal(partialToolInput('{"comm'), '');
  assert.equal(partialToolInput('{"command":"npm te'), 'npm te');
  assert.equal(
    partialToolInput('{"command":"npm test","timeout":5'),
    'npm test',
  );
});

test('partialToolInput decodes escapes and ignores a cut-off one', () => {
  assert.equal(partialToolInput('{"command":"echo \\"hi\\"'), 'echo "hi"');
  assert.equal(partialToolInput('{"command":"a\\nb'), 'a\nb');
  assert.equal(partialToolInput('{"command":"a\\'), 'a');
  assert.equal(partialToolInput('{"command":"a\\u00'), 'a');
  assert.equal(partialToolInput('{"command":"a\\\\'), 'a\\');
});
