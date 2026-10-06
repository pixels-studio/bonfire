import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  cloneUrl,
  editedPaths,
  errorMessage,
  reorderLayout,
  repositoryName,
} from '../shared/domain';
import type { ConversationMessage } from '../shared/contracts';
import { LANDMARKS, landmarkLabel, landmarkName } from '../shared/landmarks';
import { slug } from '../shared/domain';

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

function tool(
  name: string,
  input: string,
): Pick<ConversationMessage, 'kind' | 'tool'> {
  return { kind: 'tool', tool: { name, input, output: '' } };
}

test('editedPaths collects each file-editing tool call once, in order', () => {
  assert.deepEqual(
    editedPaths([
      tool('Read', '/a.ts'),
      tool('Edit', '/a.ts'),
      tool('Write', '/b.ts'),
      tool('Edit', '/a.ts'),
      tool('Bash', 'ls'),
      { kind: 'text', tool: undefined },
    ]),
    ['/a.ts', '/b.ts'],
  );
});

test('editedPaths splits a Codex fileChange covering several paths at once', () => {
  assert.deepEqual(editedPaths([tool('Edit', 'a.ts, b.ts')]), ['a.ts', 'b.ts']);
});

test('landmarks are valid folder and branch names, each once', () => {
  assert.equal(new Set(LANDMARKS).size, LANDMARKS.length);
  for (const name of LANDMARKS) assert.equal(slug(name), name);
  assert.equal(landmarkLabel('machu-picchu'), 'Machu Picchu');
});

test('a new workspace takes a free landmark, then numbered ones once all are taken', () => {
  const taken = new Set<string>(LANDMARKS.slice(1));
  assert.equal(landmarkName(taken), LANDMARKS[0]);
  taken.add(LANDMARKS[0]);
  assert.equal(
    landmarkName(taken, () => 0),
    `${LANDMARKS[0]}-2`,
  );
});

test('slugs are lowercase words joined by hyphens', () => {
  assert.equal(slug('  Abhi Ñandú!! '), 'abhi-nandu');
});
