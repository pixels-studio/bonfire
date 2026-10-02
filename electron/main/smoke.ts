import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BrowserWindow } from 'electron';
import { git } from './git';
import { Store } from './persistence';
import type { services } from './services';

const PROJECT_NAME = 'Smoke repository';
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

async function verifyRestart(
  mainWindow: BrowserWindow,
  backend: ReturnType<typeof services>,
) {
  await sleep(1800);
  assert.equal(backend.store.state.sessions.length, 1);
  assert.equal(backend.store.state.panes.length, EXPECTED_PANE_COUNT);
  assert.match(await pageText(mainWindow), new RegExp(PROJECT_NAME));
  console.log('BONFIRE_RESTART_OK: project, session, and pane layout restored');
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

  const session = await api.sessions.create({
    projectId: project.id,
    title: 'Implement Meeting Link',
  });
  assert.equal(session.worktreePath, repository);
  assert.equal(
    await readFile(join(session.worktreePath, 'hello.txt'), 'utf8'),
    'original\n',
  );

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
    sessionId: session.id,
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
    await api.filesystem.readFile(session.id, 'hello.txt'),
    'shared change\n',
  );
  const gitStatus = await api.git.status(session.id);
  assert(gitStatus.changes.some((change) => change.path === 'hello.txt'));
  assert.match(await api.git.diff(session.id, 'hello.txt'), /shared change/);

  const secondShellPane = await api.panes.add('terminal');
  const secondTerminalId = await api.terminal.create({
    sessionId: session.id,
    paneId: secondShellPane.id,
    type: 'shell',
  });
  assert.notEqual(secondTerminalId, firstTerminalId);
  assert.equal(
    (await api.terminal.snapshot(firstTerminalId)).exitCode,
    undefined,
  );

  await assert.rejects(() =>
    api.filesystem.readFile(session.id, '../outside/secret.txt'),
  );
  await symlink(outsideDirectory, join(session.worktreePath, 'escape'));
  await assert.rejects(() =>
    api.filesystem.readFile(session.id, 'escape/secret.txt'),
  );

  for (const provider of ['claude', 'codex'] as const) {
    const chatPane = await api.panes.add(provider);
    const cliTerminalId = await api.terminal.create({
      sessionId: session.id,
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
      sessionId: session.id,
      paneId: chatPane.id,
      type: 'shell',
    });
    assert.notEqual(
      chatShellTerminalId,
      cliTerminalId,
      'chat panes can host their own shell',
    );
  }

  backend.store.flush();
  const restoredStore = new Store(process.env.BONFIRE_USER_DATA!);
  assert(restoredStore.state.sessions.some(({ id }) => id === session.id));
  assert.equal(
    restoredStore.state.panes.filter((pane) => pane.sessionId === session.id)
      .length,
    EXPECTED_PANE_COUNT,
  );

  await reloadAndWait(mainWindow, 1500);
  assert.match(await pageText(mainWindow), new RegExp(PROJECT_NAME));
  await saveScreenshot(mainWindow);
  console.log(
    'BONFIRE_SMOKE_OK: renderer, isolated IPC, concurrent PTYs, CLIs, Git diff, confined files, persistence',
  );
}
