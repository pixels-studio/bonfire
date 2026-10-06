import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { SshConnection } from '../shared/contracts';
import * as git from '../electron/main/git';
import {
  FileTooLargeError,
  SshMachine,
  quote,
  remoteCommand,
  sshOptions,
} from '../electron/main/machines';

const FAKE_SSH = join(process.cwd(), 'test/fixtures/fake-ssh.sh');

const connection = (host = 'dev@box'): SshConnection => ({
  id: crypto.randomUUID(),
  name: 'Box',
  host,
  auth: 'default',
});

async function withFolder(use: (folder: string) => Promise<void>) {
  const folder = await mkdtemp(join(tmpdir(), 'bonfire machine '));
  try {
    await use(folder);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}

test('quote leaves plain words alone and survives quotes', () => {
  assert.equal(quote('origin/main'), 'origin/main');
  assert.equal(quote("it's here"), `'it'\\''s here'`);
  assert.equal(
    execFileSync('/bin/sh', ['-c', `printf %s ${quote("a 'b' $HOME")}`], {
      encoding: 'utf8',
    }),
    "a 'b' $HOME",
  );
});

test('remote commands run in the folder with the given variables', () => {
  const command = remoteCommand('printenv', ['GREETING'], {
    cwd: '/tmp',
    env: { GREETING: "hello 'there'", 'BAD NAME': 'x' },
  });
  assert.doesNotMatch(command, /BAD NAME/);
  assert.equal(
    execFileSync('/bin/sh', ['-c', command], {
      encoding: 'utf8',
      env: { ...process.env, SHELL: '/bin/sh' },
    }),
    "hello 'there'\n",
  );
});

test('ssh options carry the port and key only when set', () => {
  const plain = sshOptions(connection());
  assert.ok(!plain.includes('-p') && !plain.includes('-i'));
  assert.ok(plain.includes('BatchMode=yes'));
  const keyed = sshOptions({
    ...connection(),
    port: 2222,
    auth: 'identity',
    identityFile: '/keys/id_ed25519',
  });
  assert.deepEqual(keyed.slice(keyed.indexOf('-p'), keyed.indexOf('-p') + 2), [
    '-p',
    '2222',
  ]);
  assert.ok(keyed.includes('/keys/id_ed25519'));
  // A key file is ignored unless the connection signs in with it.
  assert.ok(
    !sshOptions({ ...connection(), identityFile: '/keys/x' }).includes('-i'),
  );
});

test('an ssh machine lists, reads, and copies files', () =>
  withFolder(async (folder) => {
    const machine = new SshMachine(connection(), FAKE_SSH);
    await mkdir(join(folder, 'src dir'));
    await writeFile(join(folder, "it's.txt"), 'hello');
    await writeFile(join(folder, '.env'), 'SECRET=1');
    await symlink(join(folder, 'src dir'), join(folder, 'link'));

    const items = await machine.readdir(folder);
    assert.deepEqual(
      items.sort((a, b) => a.name.localeCompare(b.name)),
      [
        { name: '.env', directory: false, symlink: false },
        { name: "it's.txt", directory: false, symlink: false },
        { name: 'link', directory: false, symlink: true },
        { name: 'src dir', directory: true, symlink: false },
      ],
    );
    assert.equal(
      (await machine.readFile(join(folder, "it's.txt"), 100)).toString(),
      'hello',
    );
    await assert.rejects(
      () => machine.readFile(join(folder, "it's.txt"), 2),
      FileTooLargeError,
    );
    assert.equal(await machine.exists(join(folder, 'src dir')), true);
    assert.equal(await machine.exists(join(folder, 'missing')), false);
    assert.equal(
      await machine.realpath(join(folder, 'link')),
      await machine.realpath(join(folder, 'src dir')),
    );
    assert.equal(await machine.home(), process.env.HOME);
  }));

test('git runs on an ssh machine', () =>
  withFolder(async (folder) => {
    const machine = new SshMachine(connection(), FAKE_SSH);
    execFileSync('git', ['init', '-q', '-b', 'main', folder]);
    execFileSync('git', [
      '-C',
      folder,
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.com',
      'commit',
      '-q',
      '--allow-empty',
      '-m',
      'start',
    ]);
    const place = { machine, path: folder };
    assert.equal(await git.currentBranch(place), 'main');
    const worktree = `${folder}-feature`;
    await git.addWorktree(place, worktree, 'feature/x', 'main');
    assert.deepEqual(await git.head({ machine, path: worktree }), {
      isGit: true,
      branch: 'feature/x',
    });
    await git.removeWorktree(place, worktree);
    assert(await git.hasRef(place, 'refs/heads/feature/x'));
    assert.deepEqual(await git.head({ machine, path: tmpdir() }), {
      isGit: false,
    });
  }));

test('an unreachable machine says so by name', async () => {
  const machine = new SshMachine(
    { ...connection('unreachable'), name: 'Build box' },
    FAKE_SSH,
  );
  await assert.rejects(
    () => machine.home(),
    /Could not reach Build box: .*refused/,
  );
});

test('a command without the profile runs in a plain POSIX shell', () => {
  const command = remoteCommand('printenv', ['GREETING'], {
    env: { GREETING: 'hi' },
    profile: false,
  });
  assert.equal(
    execFileSync('/bin/sh', ['-c', command], {
      encoding: 'utf8',
      // A login shell that can't run would fail the command if it were used.
      env: { ...process.env, SHELL: '/nonexistent' },
    }),
    'hi\n',
  );
});

test('a program only the profile puts on the PATH is found on a second try', () =>
  withFolder(async (home) => {
    await mkdir(join(home, 'tools'));
    const tool = join(home, 'tools', 'profiled-tool');
    await writeFile(tool, '#!/bin/sh\necho found\n', { mode: 0o755 });
    await writeFile(
      join(home, '.profile'),
      `PATH="${join(home, 'tools')}:$PATH"\nexport PATH\n`,
    );
    const previous = process.env.BONFIRE_FAKE_SSH_HOME;
    process.env.BONFIRE_FAKE_SSH_HOME = home;
    try {
      const machine = new SshMachine(connection(), FAKE_SSH);
      assert.equal(
        await machine.exec('profiled-tool', [], { profile: false }),
        'found\n',
      );
    } finally {
      if (previous === undefined) delete process.env.BONFIRE_FAKE_SSH_HOME;
      else process.env.BONFIRE_FAKE_SSH_HOME = previous;
    }
  }));
