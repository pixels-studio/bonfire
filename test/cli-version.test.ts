import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compareVersions, parseVersion } from '../electron/main/cli-version';

test('CLI versions are read from each CLI’s output', () => {
  assert.equal(parseVersion('2.1.277 (Claude Code)\n'), '2.1.277');
  assert.equal(parseVersion('codex-cli 0.153.4\n'), '0.153.4');
  assert.equal(parseVersion('command not found'), undefined);
});

test('CLI versions compare part by part, not as text', () => {
  assert.ok(compareVersions('2.1.277', '2.1.287') < 0);
  assert.ok(compareVersions('0.153.4', '0.155.1') < 0);
  assert.ok(compareVersions('2.1.1000', '2.1.287') > 0);
  assert.ok(compareVersions('2.10.0', '2.9.9') > 0);
  assert.equal(compareVersions('2.1.287', '2.1.287'), 0);
});
