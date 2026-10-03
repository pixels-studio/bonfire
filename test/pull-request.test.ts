import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parsePullRequest, parseRepositories } from '../electron/main/github';

function pull(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    number: 7,
    url: 'https://github.com/o/r/pull/7',
    title: 'Add thing',
    state: 'OPEN',
    baseRefName: 'main',
    isDraft: false,
    mergeable: 'MERGEABLE',
    statusCheckRollup: [],
    ...overrides,
  });
}

test('a pull request is read from gh JSON', () => {
  assert.deepEqual(parsePullRequest(pull()), {
    number: 7,
    url: 'https://github.com/o/r/pull/7',
    title: 'Add thing',
    state: 'open',
    base: 'main',
    draft: false,
    mergeable: 'yes',
    checks: 'none',
  });
  assert.equal(parsePullRequest(pull({ state: 'MERGED' })).state, 'merged');
  assert.equal(parsePullRequest(pull({ state: 'CLOSED' })).state, 'closed');
  assert.equal(
    parsePullRequest(pull({ mergeable: 'CONFLICTING' })).mergeable,
    'no',
  );
  assert.equal(
    parsePullRequest(pull({ mergeable: 'UNKNOWN' })).mergeable,
    'unknown',
  );
});

test('checks fold into one result, failures first', () => {
  const checks = (statusCheckRollup: object[]) =>
    parsePullRequest(pull({ statusCheckRollup })).checks;
  assert.equal(
    checks([
      { status: 'COMPLETED', conclusion: 'SUCCESS' },
      { state: 'SUCCESS' },
      { status: 'COMPLETED', conclusion: 'SKIPPED' },
    ]),
    'passing',
  );
  assert.equal(
    checks([
      { status: 'COMPLETED', conclusion: 'SUCCESS' },
      { status: 'IN_PROGRESS', conclusion: '' },
    ]),
    'pending',
  );
  assert.equal(
    checks([
      { status: 'IN_PROGRESS', conclusion: '' },
      { status: 'COMPLETED', conclusion: 'FAILURE' },
    ]),
    'failing',
  );
});

test('repositories keep what the picker shows', () => {
  const [repository, empty] = parseRepositories(
    JSON.stringify([
      {
        full_name: 'o/r',
        description: 'A thing',
        private: true,
        pushed_at: '2026-01-02T03:04:05Z',
        clone_url: 'https://github.com/o/r.git',
        owner: { avatar_url: 'https://avatars.githubusercontent.com/u/1' },
      },
      {
        full_name: 'o/empty',
        description: '',
        private: false,
        pushed_at: null,
        clone_url: 'https://github.com/o/empty.git',
      },
    ]),
  );
  assert.deepEqual(repository, {
    fullName: 'o/r',
    description: 'A thing',
    private: true,
    pushedAt: Date.parse('2026-01-02T03:04:05Z'),
    cloneUrl: 'https://github.com/o/r.git',
    avatarUrl: 'https://avatars.githubusercontent.com/u/1',
  });
  assert.equal(empty.description, undefined);
  assert.equal(empty.pushedAt, 0);
});
