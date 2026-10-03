import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseDiff } from '../src/lib/diff';

const DIFF = `diff --git a/a.ts b/a.ts
index 1..2 100644
--- a/a.ts
+++ b/a.ts
@@ -3,4 +3,4 @@ fn
 keep
-old
+new
+extra
 tail
\\ No newline at end of file
`;

test('parseDiff skips the header and numbers each row', () => {
  assert.deepEqual(parseDiff(DIFF), [
    { kind: 'hunk', text: '@@ -3,4 +3,4 @@ fn' },
    { kind: 'context', text: 'keep', line: 3 },
    { kind: 'delete', text: 'old', line: 4 },
    { kind: 'add', text: 'new', line: 4 },
    { kind: 'add', text: 'extra', line: 5 },
    { kind: 'context', text: 'tail', line: 6 },
  ]);
});

test('parseDiff has no rows for a binary diff', () => {
  assert.deepEqual(parseDiff('diff --git a/x b/x\nBinary files differ\n'), []);
});
