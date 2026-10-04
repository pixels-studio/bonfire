import assert from 'node:assert/strict';
import { test } from 'node:test';
import { promptMarkdown, type PromptNode } from '../src/lib/prompt-markdown';

const doc = (...content: PromptNode[]): PromptNode => ({
  type: 'doc',
  content,
});
const p = (...content: PromptNode[]): PromptNode => ({
  type: 'paragraph',
  content,
});
const text = (value: string, ...marks: string[]): PromptNode => ({
  type: 'text',
  text: value,
  ...(marks.length ? { marks: marks.map((type) => ({ type })) } : {}),
});
const item = (...content: PromptNode[]): PromptNode => ({
  type: 'listItem',
  content,
});

test('plain lines are sent exactly as typed', () => {
  assert.equal(
    promptMarkdown(
      doc(p(text('first line')), p(), p(text('  indented * not bold _x_'))),
    ),
    'first line\n\n  indented * not bold _x_',
  );
});

test('leading blank lines and trailing whitespace are dropped', () => {
  assert.equal(promptMarkdown(doc(p(), p(text('hi  ')), p())), 'hi');
  assert.equal(promptMarkdown(doc(p())), '');
});

test('bullet and numbered lists become markdown lists', () => {
  assert.equal(
    promptMarkdown(
      doc(
        p(text('Do this:')),
        {
          type: 'bulletList',
          content: [item(p(text('one'))), item(p(text('two')))],
        },
        {
          type: 'orderedList',
          attrs: { start: 3 },
          content: [item(p(text('three'))), item(p(text('four')))],
        },
        p(text('Thanks')),
      ),
    ),
    'Do this:\n\n- one\n- two\n\n3. three\n4. four\n\nThanks',
  );
});

test('nested lists and multi-line items are indented under their marker', () => {
  assert.equal(
    promptMarkdown(
      doc({
        type: 'orderedList',
        content: [
          item(p(text('parent'), { type: 'hardBreak' }, text('more')), {
            type: 'bulletList',
            content: [item(p(text('child')))],
          }),
          item(p(text('next'))),
        ],
      }),
    ),
    '1. parent\n   more\n   - child\n2. next',
  );
});

test('marks become delimiters, with spaces kept outside them', () => {
  assert.equal(
    promptMarkdown(
      doc(
        p(
          text('make '),
          text('this ', 'bold'),
          text('and', 'bold', 'italic'),
          text(' ', 'bold'),
          text('that', 'strike'),
          text(' run '),
          text('npm test', 'code'),
        ),
      ),
    ),
    'make **this *and*** ~~that~~ run `npm test`',
  );
});

test('inline code with backticks gets a longer fence', () => {
  assert.equal(promptMarkdown(doc(p(text('a`b', 'code')))), '``a`b``');
});

test('code blocks are fenced and keep their text', () => {
  assert.equal(
    promptMarkdown(
      doc(p(text('look:')), {
        type: 'codeBlock',
        attrs: { language: 'ts' },
        content: [text('if (a) {\n  b();\n}\n```')],
      }),
    ),
    'look:\n\n````ts\nif (a) {\n  b();\n}\n```\n````',
  );
});

test('headings, quotes and links', () => {
  assert.equal(
    promptMarkdown(
      doc(
        { type: 'heading', attrs: { level: 2 }, content: [text('Title')] },
        { type: 'blockquote', content: [p(text('quoted')), p(text('more'))] },
        p({
          type: 'text',
          text: 'docs',
          marks: [{ type: 'link', attrs: { href: 'https://x.dev' } }],
        }),
      ),
    ),
    '## Title\n\n> quoted\n> more\n\n[docs](https://x.dev)',
  );
});

test('attachment chips are sent as their markers, in place', () => {
  assert.equal(
    promptMarkdown(
      doc(
        p(
          text('see '),
          { type: 'attachment', attrs: { id: 'abc-1', name: 'a.png' } },
          text(' here'),
        ),
        {
          type: 'bulletList',
          content: [
            item(p({ type: 'attachment', attrs: { id: 'def', name: 'b' } })),
          ],
        },
      ),
    ),
    'see [[attachment:abc-1]] here\n\n- [[attachment:def]]',
  );
});

test('skills are sent as their markers, in place', () => {
  const skill = (name: string): PromptNode => ({
    type: 'skill',
    attrs: { name },
  });
  assert.equal(
    promptMarkdown(
      doc(
        p(text('use '), skill('review'), text(' on this')),
        p(skill('plugin:plan'), text(' first')),
      ),
    ),
    'use [[skill:review]] on this\n[[skill:plugin:plan]] first',
  );
});
