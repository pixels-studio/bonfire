import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parsePullRequest } from '../electron/main/github';

function pull(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    number: 7,
    url: 'https://github.com/o/r/pull/7',
    title: 'Add thing',
    state: 'OPEN',
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
