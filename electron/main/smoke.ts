import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, realpath, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BrowserWindow } from 'electron';
import { git } from './git';
import { Store } from './persistence';
import type { services } from './services';

const PROJECT_NAME = 'Smoke repository';
/**
 * Two shells and a pane per provider. The window may add starting agent panes of its own
 * when the project opens empty, depending on which agents this computer is signed in to.
 */
const EXPECTED_PANE_COUNT = 4;

function sleep(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function reloadAndWait(
  mainWindow: BrowserWindow,
  settleMilliseconds: number,
) {
  const loaded = new Promise<void>((resolve) =>
    mainWindow.webContents.once('did-finish-load', () => resolve()),
  );
  mainWindow.webContents.reload();
  await loaded;
  await sleep(settleMilliseconds);
}

function pageText(mainWindow: BrowserWindow) {
  return mainWindow.webContents.executeJavaScript('document.body.innerText');
}

/** Creates a committed Git repository plus a sibling folder the app must never read. */
async function createSmokeRepository() {
  const root = await mkdtemp(join(tmpdir(), 'bonfire-smoke-'));
  const repository = join(root, 'repo');
  const outsideDirectory = join(root, 'outside');
  await mkdir(repository);
  await mkdir(outsideDirectory);
  await writeFile(join(outsideDirectory, 'secret.txt'), 'nope\n');
  await git(repository, ['init', '-b', 'main']);
  await git(repository, ['config', 'user.email', 'test@bonfire.local']);
  await git(repository, ['config', 'user.name', 'Bonfire Test']);
  await writeFile(join(repository, 'hello.txt'), 'original\n');
  await git(repository, ['add', '.']);
  await git(repository, ['commit', '-m', 'Initial']);
  return { repository, outsideDirectory };
}

async function saveScreenshot(mainWindow: BrowserWindow) {
  // The screenshot is an artifact, not an assertion; capture fails when the window is occluded.
  try {
    const artifactsDirectory = join(process.cwd(), 'artifacts');
    await mkdir(artifactsDirectory, { recursive: true });
    const image = await mainWindow.webContents.capturePage();
    await writeFile(join(artifactsDirectory, 'smoke.png'), image.toPNG());
  } catch (error) {
    console.warn('Skipped smoke screenshot:', error);
  }
}

/**
 * Runs a project on an SSH connection end to end. The `ssh` is a stand-in that runs the
 * remote side on this computer, with a home folder of its own.
 */
async function verifyRemote(backend: ReturnType<typeof services>) {
  const { api } = backend;
  const home = await realpath(await mkdtemp(join(tmpdir(), 'bonfire-remote-')));
  process.env.BONFIRE_SSH = join(process.cwd(), 'test/fixtures/fake-ssh.sh');
  process.env.BONFIRE_FAKE_SSH_HOME = home;
  const repository = join(home, 'remote-repo');
  await mkdir(repository);
  await git(repository, ['init', '-b', 'main']);
  await git(repository, ['config', 'user.email', 'test@bonfire.local']);
  await git(repository, ['config', 'user.name', 'Bonfire Test']);
  await writeFile(join(repository, 'hello.txt'), 'remote\n');
  await writeFile(join(home, 'secret.txt'), 'nope\n');
  await git(repository, ['add', '.']);
  await git(repository, ['commit', '-m', 'Initial']);

  const entered = {
    name: 'Build box',
    host: 'dev@box',
    auth: 'default' as const,
  };
  assert.deepEqual(await api.connections.check(entered), { ok: true, home });
  const connection = await api.connections.save(entered);
  const listing = await api.connections.browse(connection.id);
  assert.equal(listing.path, home);
  assert.deepEqual(listing.folders, ['remote-repo']);

  const project = await api.projects.create({
    name: 'Remote repository',
    path: '~/remote-repo',
    connectionId: connection.id,
  });
  assert.equal(project.path, repository);
  await assert.rejects(() => api.connections.remove(connection.id));

  assert.equal(
    await api.filesystem.readFile(project.id, 'hello.txt'),
    'remote\n',
  );
  assert.deepEqual(await api.filesystem.search(project.id, 'hello'), [
    'hello.txt',
  ]);
  await assert.rejects(() =>
    api.filesystem.readFile(project.id, '../secret.txt'),
  );

  const shellPane = await api.panes.add('terminal');
  const terminalId = await api.terminal.create({
    projectId: project.id,
    paneId: shellPane.id,
    type: 'shell',
  });
  await api.terminal.write(
    terminalId,
    "printf 'changed\\n' > hello.txt; printf 'BONFIRE_REMOTE_PTY_OK %s\\n' \"$(pwd)\"\r",
  );
  await sleep(1500);
  assert(
    (await api.terminal.snapshot(terminalId)).data.includes(
      `BONFIRE_REMOTE_PTY_OK ${repository}`,
    ),
  );
  const status = await api.git.status(project.id);
  assert.equal(status.branch, 'main');
  assert(status.changes.some((change) => change.path === 'hello.txt'));
  assert.match(await api.git.diff(project.id, 'hello.txt'), /\+changed/);

  // A new branch takes the uncommitted change along.
  await api.git.createBranch(project.id, 'remote-feature', 'main');
  assert.deepEqual(await api.git.head(project.id), {
    isGit: true,
    branch: 'remote-feature',
  });
  assert.deepEqual(
    (await api.git.localBranches(project.id)).map(({ name }) => name).sort(),
    ['main', 'remote-feature'],
  );
  assert.match(await api.git.diff(project.id, 'hello.txt'), /\+changed/);
  await api.projects.remove(project.id);
  await api.connections.remove(connection.id);
  assert.deepEqual(await api.connections.list(), []);
  console.log('BONFIRE_REMOTE_OK: SSH project, files, git, branches, terminal');
}

async function verifyRestart(
  mainWindow: BrowserWindow,
  backend: ReturnType<typeof services>,
) {
  await sleep(1800);
  assert.equal(backend.store.state.projects.length, 1);
  assert(backend.store.state.panes.length >= EXPECTED_PANE_COUNT);
  assert.match(await pageText(mainWindow), new RegExp(PROJECT_NAME));
  console.log('BONFIRE_RESTART_OK: project and pane layout restored');
}

export async function smoke(
  mainWindow: BrowserWindow,
  backend: ReturnType<typeof services>,
) {
  if (process.env.BONFIRE_SMOKE === 'restart')
    return verifyRestart(mainWindow, backend);

  const { api } = backend;
  const { repository, outsideDirectory } = await createSmokeRepository();
  const project = {
    id: randomUUID(),
    name: PROJECT_NAME,
    path: repository,
    createdAt: Date.now(),
    lastOpenedAt: Date.now(),
  };
  backend.store.state.projects.push(project);
  backend.store.save();

  // Panes work in the project folder itself.
  await api.projects.open(project.id);
  assert.equal(backend.store.state.lastProjectId, project.id);
  assert.deepEqual(await api.git.head(project.id), {
    isGit: true,
    branch: 'main',
  });

  await reloadAndWait(mainWindow, 1000);
  assert.equal(
    await mainWindow.webContents.executeJavaScript(
      'typeof window.bonfire.terminal.create',
    ),
    'function',
  );
  assert.equal(
    await mainWindow.webContents.executeJavaScript('typeof window.require'),
    'undefined',
  );

  const firstShellPane = await api.panes.add('terminal');
  const firstTerminalId = await api.terminal.create({
    projectId: project.id,
    paneId: firstShellPane.id,
    type: 'shell',
  });
  await api.terminal.resize(firstTerminalId, 100, 30);
  await api.terminal.write(
    firstTerminalId,
    "printf 'shared change\\n' > hello.txt; printf 'BONFIRE_PTY_OK\\n'; pwd\r",
  );
  await sleep(1500);
  const firstSnapshot = await api.terminal.snapshot(firstTerminalId);
  assert.match(firstSnapshot.data, /BONFIRE_PTY_OK/);
  assert.equal(
    await api.filesystem.readFile(project.id, 'hello.txt'),
    'shared change\n',
  );
  const gitStatus = await api.git.status(project.id);
  assert(gitStatus.changes.some((change) => change.path === 'hello.txt'));
  assert.match(await api.git.diff(project.id, 'hello.txt'), /shared change/);

  const secondShellPane = await api.panes.add('terminal');
  const secondTerminalId = await api.terminal.create({
    projectId: project.id,
    paneId: secondShellPane.id,
    type: 'shell',
  });
  assert.notEqual(secondTerminalId, firstTerminalId);
  assert.equal(
    (await api.terminal.snapshot(firstTerminalId)).exitCode,
    undefined,
  );

  // A pane's shell is reused while it runs, and ends with the pane.
  assert.equal(
    await api.terminal.create({
      projectId: project.id,
      paneId: secondShellPane.id,
      type: 'shell',
    }),
    secondTerminalId,
  );
  await api.panes.archive(secondShellPane.id);
  await assert.rejects(() => api.terminal.snapshot(secondTerminalId));
  assert.equal(
    (await api.terminal.snapshot(firstTerminalId)).exitCode,
    undefined,
  );

  await assert.rejects(() =>
    api.filesystem.readFile(project.id, '../outside/secret.txt'),
  );
  await symlink(outsideDirectory, join(repository, 'escape'));
  await assert.rejects(() =>
    api.filesystem.readFile(project.id, 'escape/secret.txt'),
  );

  for (const provider of ['claude', 'codex'] as const) {
    const chatPane = await api.panes.add(provider);
    const cliTerminalId = await api.terminal.create({
      projectId: project.id,
      paneId: chatPane.id,
      type: provider,
    });
    await sleep(2500);
    const cliSnapshot = await api.terminal.snapshot(cliTerminalId);
    console.log(
      `${provider} CLI:`,
      JSON.stringify({
        outputBytes: cliSnapshot.data.length,
        exitCode: cliSnapshot.exitCode,
      }),
    );
    assert(
      cliSnapshot.data.length > 0,
      `${provider} must produce terminal output`,
    );
    const chatShellTerminalId = await api.terminal.create({
      projectId: project.id,
      paneId: chatPane.id,
      type: 'shell',
    });
    assert.notEqual(
      chatShellTerminalId,
      cliTerminalId,
      'chat panes can host their own shell',
    );
  }

  // Switching branches is refused only while an agent works; the shared change comes along.
  await api.git.createBranch(project.id, 'feature/smoke', 'main');
  assert.equal((await api.git.head(project.id)).branch, 'feature/smoke');
  assert.equal(
    await api.filesystem.readFile(project.id, 'hello.txt'),
    'shared change\n',
  );
  await assert.rejects(
    () => api.git.createBranch(project.id, 'bad name..', 'main'),
    /valid branch name/,
  );
  await api.git.checkout(project.id, 'main');
  assert.deepEqual(
    (await api.git.localBranches(project.id)).map(({ name }) => name).sort(),
    ['feature/smoke', 'main'],
  );

  await verifyRemote(backend);
  await api.projects.open(project.id);

  backend.store.flush();
  const restoredStore = new Store(process.env.BONFIRE_USER_DATA!);
  assert.equal(restoredStore.state.lastProjectId, project.id);
  const paneIdsOf = (store: Store) =>
    store.state.panes
      .filter((pane) => pane.projectId === project.id)
      .map(({ id }) => id)
      .sort();
  assert.deepEqual(paneIdsOf(restoredStore), paneIdsOf(backend.store));
  assert(paneIdsOf(restoredStore).length >= EXPECTED_PANE_COUNT);

  await reloadAndWait(mainWindow, 1500);
  assert.match(await pageText(mainWindow), new RegExp(PROJECT_NAME));
  await saveScreenshot(mainWindow);
  console.log(
    'BONFIRE_SMOKE_OK: renderer, isolated IPC, concurrent PTYs, CLIs, Git diff, confined files, persistence',
  );
}
