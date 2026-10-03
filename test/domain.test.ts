import assert from 'node:assert/strict';
import { test } from 'node:test';
import { errorMessage, reorderLayout } from '../shared/domain';

test('reorderLayout keeps hidden panes in their slots', () => {
  assert.deepEqual(
    reorderLayout(['a', 'archived', 'b', 'terminal', 'c'], ['c', 'a', 'b']),
    ['c', 'archived', 'a', 'terminal', 'b'],
  );
});

test('reorderLayout rejects unknown or repeated panes', () => {
  assert.throws(() => reorderLayout(['a', 'b'], ['a', 'z']));
  assert.throws(() => reorderLayout(['a', 'b'], ['a', 'a']));
});

test('errors from main lose the IPC wrapping', () => {
  assert.equal(
    errorMessage(
      Error(
        "Error invoking remote method 'git.checkout': Error: No such branch",
      ),
    ),
    'No such branch',
  );
  assert.equal(errorMessage('plain'), 'plain');
});
