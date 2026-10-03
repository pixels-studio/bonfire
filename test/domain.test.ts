import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  cloneUrl,
  errorMessage,
  reorderLayout,
  repositoryName,
} from '../shared/domain';

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

test('cloneUrl accepts URLs, scp-style addresses and GitHub shorthand', () => {
  assert.equal(
    cloneUrl(' https://github.com/o/r.git '),
    'https://github.com/o/r.git',
  );
  assert.equal(cloneUrl('git@github.com:o/r.git'), 'git@github.com:o/r.git');
  assert.equal(cloneUrl('ssh://git@host/o/r'), 'ssh://git@host/o/r');
  assert.equal(cloneUrl('o/r'), 'https://github.com/o/r.git');
  assert.equal(cloneUrl('o/r.git'), 'https://github.com/o/r.git');
});

test('cloneUrl rejects what git would read as an option or command', () => {
  assert.equal(cloneUrl('--upload-pack=touch /tmp/x'), undefined);
  assert.equal(cloneUrl('ext::sh -c touch% /tmp/x'), undefined);
  assert.equal(cloneUrl('not a url'), undefined);
});

test('repositoryName is the last segment without .git', () => {
  assert.equal(repositoryName('https://github.com/o/repo.git'), 'repo');
  assert.equal(repositoryName('git@github.com:o/repo.git'), 'repo');
  assert.equal(repositoryName('git@host:repo.git'), 'repo');
  assert.equal(repositoryName('https://host/o/repo/'), 'repo');
});
