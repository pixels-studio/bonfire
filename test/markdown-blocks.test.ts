import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { marked } from 'marked';
import { MarkdownBlocks } from '../src/lib/markdown-blocks';

const SAMPLE = [
  readFileSync('README.md', 'utf8'),
  '# Plan\n\nSome text\nthat wraps.\n\n- one\n- two\n\n- loose three\n\n  continued\n\n1. a\n2. b\n\n> quote\nlazy line\n\n```ts\nconst x = 1;\n\nconst y = 2;\n```\n\nPara\n===\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n    indented code\n\n<div>\nhtml\n</div>\n\n[ref]: https://example.com\n\nEnd with **bold** and `code`.\n',
  '- a\n\n\n- b\n\n* c\n\n---\n\nText\n- list right after\n\n```\nunclosed fence\n\n- not a list\n',
].join('\n\n');

const full = (text: string) =>
  marked.lexer(text, { gfm: true }).map((token) => token.raw);

test('streamed markdown splits into the same blocks as the whole text', () => {
  let seed = 7;
  const random = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
  for (let run = 0; run < 40; run++) {
    const blocks = new MarkdownBlocks();
    let length = 0;
    while (length < SAMPLE.length) {
      length = Math.min(SAMPLE.length, length + 1 + Math.floor(random() * 40));
      const text = SAMPLE.slice(0, length);
      assert.deepEqual(blocks.update(text), full(text), `at ${length}`);
    }
  }
});

test('text that is replaced rather than extended is read afresh', () => {
  const blocks = new MarkdownBlocks();
  blocks.update('# One\n\nTwo\n\nThree');
  assert.deepEqual(blocks.update('Other\n\ntext'), full('Other\n\ntext'));
  assert.deepEqual(blocks.update('a\r\n\r\nb\r\n'), full('a\r\n\r\nb\r\n'));
  assert.deepEqual(
    blocks.update('a\r\n\r\nb\r\n\r\nc'),
    full('a\r\n\r\nb\r\n\r\nc'),
  );
});
