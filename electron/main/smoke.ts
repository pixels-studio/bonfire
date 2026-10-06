import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { app, webContents, type BrowserWindow } from 'electron';
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

/**
 * A browser pane opens once per project, remembers its page, and shows it in a webview
 * that has neither Node nor the app's API.
 */
async function verifyBrowserPane(
  mainWindow: BrowserWindow,
  backend: ReturnType<typeof services>,
) {
  const { api } = backend;
  const server = createServer((_request, response) =>
    response.end('<title>BONFIRE_BROWSER</title><p>BONFIRE_BROWSER_OK</p>'),
  );
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
    const pane = await api.panes.add('browser');
    assert.equal((await api.panes.add('browser')).id, pane.id);
    await api.panes.navigate(pane.id, url);
    backend.store.flush();
    const restored = new Store(process.env.BONFIRE_USER_DATA!);
    assert.equal(
      restored.state.panes.find(({ id }) => id === pane.id)?.url,
      url,
    );

    await reloadAndWait(mainWindow, 1500);
    let guest: Electron.WebContents | undefined;
    for (let tries = 0; tries < 50; tries++) {
      guest = webContents
        .getAllWebContents()
        .find(
          (contents) =>
            contents.getType() === 'webview' && contents.getURL() === url,
        );
      if (guest && !guest.isLoading()) break;
      await sleep(100);
    }
    assert(guest, 'the browser pane shows its page');
    assert.match(
      await guest.executeJavaScript('document.body.textContent'),
      /BONFIRE_BROWSER_OK/,
    );
    assert.equal(
      await guest.executeJavaScript(
        'typeof window.require + typeof window.bonfire + typeof process',
      ),
      'undefinedundefinedundefined',
    );
    await api.panes.archive(pane.id);
  } finally {
    server.close();
  }
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
  await backend.terminals.write(
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

/**
 * A program flooding a terminal whose view has fallen behind is paused, and carries on once
 * the view catches up. The flood counts its lines into a file, which stops while it waits.
 */
async function verifyFlowControl(
  backend: ReturnType<typeof services>,
  folder: string,
  terminalId: string,
) {
  const counter = join(folder, 'flood-count.txt');
  const count = async () =>
    Number((await readFile(counter, 'utf8').catch(() => '0')).trim() || 0);
  // The view says it is watching, then never draws another character.
  await backend.terminals.ack(terminalId, 0);
  await backend.terminals.write(
    terminalId,
    "i=0; while :; do i=$((i+1)); printf '%0200d\\n' $i; echo $i > flood-count.txt; done\r",
  );
  // It runs until the view is half a megabyte behind, then waits; how soon depends on the
  // computer's speed, so the count is watched until it stops.
  let paused = 0;
  let before = -1;
  for (let tries = 0; tries < 40 && (!paused || paused !== before); tries++) {
    before = paused;
    await sleep(250);
    paused = await count();
  }
  assert(paused > 0, 'the flood must start');
  await sleep(500);
  assert.equal(await count(), paused, 'a flood the view is behind on pauses');
  await backend.terminals.ack(terminalId, 1 << 30);
  await sleep(300);
  assert(
    (await count()) > paused,
    'the flood carries on once the view catches up',
  );
  await backend.terminals.write(terminalId, '\x03');
  await sleep(300);
  await rm(counter, { force: true });
  console.log('BONFIRE_FLOW_OK: a flooding terminal pauses and resumes');
}

/**
 * Types a command into a terminal from the page, as a person would, and returns the output
 * the page hears back. The command should print something only its output contains.
 */
async function typeInPage(
  page: BrowserWindow['webContents'],
  terminalId: string,
  command: string,
  expected = /BONFIRE_\w+_\d/,
) {
  const id = JSON.stringify(terminalId);
  await page.executeJavaScript(`
    window.heard = '';
    window.stopHearing?.();
    window.stopHearing = window.bonfire.terminal.onData((event) => {
      if (event.terminalId === ${id}) window.heard += event.data ?? '';
    });
    window.bonfire.terminal.write(${id}, ${JSON.stringify(`${command}\r`)});
  `);
  let heard = '';
  for (let tries = 0; tries < 25 && !expected.test(heard); tries++) {
    await sleep(200);
    heard = await page.executeJavaScript('window.heard');
  }
  return heard;
}

/** The process id of a utility process the app moved work out to, if it runs. */
function hostPid(name: string) {
  return app
    .getAppMetrics()
    .find((metric) => metric.type === 'Utility' && metric.name === name)?.pid;
}

/**
 * Terminals and agents run in utility processes of their own, out of main. One that dies
 * takes only its own work along: its terminals end, and the next request starts it again,
 * with a new channel to the window.
 */
async function verifyHosts(
  backend: ReturnType<typeof services>,
  page: BrowserWindow['webContents'],
  projectId: string,
  terminalId: string,
) {
  const { api } = backend;
  const terminals = hostPid('Bonfire Terminals');
  assert(terminals, 'terminals run in their own process');
  // Any request starts the agent host; whether it succeeds depends on the account signed in.
  await api.limits.get('claude').catch(() => {});
  const agents = hostPid('Bonfire Agents');
  assert(agents, 'agents run in their own process');

  process.kill(terminals, 'SIGKILL');
  await sleep(500);
  await assert.rejects(() => api.terminal.snapshot(terminalId), /not found/);
  const pane = await api.panes.add('terminal');
  const fresh = await api.terminal.create({
    projectId,
    paneId: pane.id,
    type: 'shell',
  });
  // The page types into the new host and hears it back, over the channel it was given.
  assert.match(
    await typeInPage(page, fresh, 'echo BONFIRE_HOST_$((1+1))'),
    /BONFIRE_HOST_2/,
  );
  assert.notEqual(hostPid('Bonfire Terminals'), terminals);
  await api.panes.archive(pane.id);

  process.kill(agents, 'SIGKILL');
  await sleep(500);
  await api.limits.get('claude').catch(() => {});
  const restarted = hostPid('Bonfire Agents');
  assert(restarted && restarted !== agents, 'the agent host starts again');
  console.log('BONFIRE_HOSTS_OK: terminals and agents run apart and restart');
}

/**
 * The terminal and agent hosts on any platform, Windows included: a terminal's output and
 * typing over the window's own channel, both hosts restarting after a crash, and a pane's
 * shell ended as it closes. Commands are ones every platform's shell runs.
 */
async function verifyHostsAnywhere(
  mainWindow: BrowserWindow,
  backend: ReturnType<typeof services>,
) {
  const { api } = backend;
  const folder = await realpath(
    await mkdtemp(join(tmpdir(), 'bonfire-hosts-')),
  );
  const project = await api.projects.create({
    name: PROJECT_NAME,
    path: folder,
  });
  const pane = await api.panes.add('terminal');
  await reloadAndWait(mainWindow, 1500);
  const page = mainWindow.webContents;
  const create = (paneId: string) =>
    api.terminal.create({ projectId: project.id, paneId, type: 'shell' });
  // PowerShell and POSIX shells both print the sum, which the typed command doesn't contain.
  const sum = (name: string) =>
    process.platform === 'win32'
      ? `Write-Output ("BONFIRE_${name}_" + (40+2))`
      : `echo BONFIRE_${name}_$((40+2))`;
  const first = await create(pane.id);
  await sleep(2000);
  assert.match(await typeInPage(page, first, sum('TYPED')), /BONFIRE_TYPED_42/);

  const terminals = hostPid('Bonfire Terminals');
  assert(terminals, 'terminals run in their own process');
  process.kill(terminals);
  await sleep(1000);
  const again = await create(pane.id);
  await sleep(2000);
  assert.match(await typeInPage(page, again, sum('AGAIN')), /BONFIRE_AGAIN_42/);

  await api.limits.get('claude').catch(() => {});
  const agents = hostPid('Bonfire Agents');
  assert(agents, 'agents run in their own process');
  process.kill(agents);
  await sleep(1000);
  await api.limits.get('claude').catch(() => {});
  assert.notEqual(hostPid('Bonfire Agents') ?? agents, agents);

  // Closing the pane ends its shell; on Windows that runs node-pty's helper script.
  await api.panes.archive(pane.id);
  await sleep(1000);
  await assert.rejects(() => api.terminal.snapshot(again));
  console.log(
    'BONFIRE_HOSTS_ANYWHERE_OK: terminals and agents on this platform',
  );
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
  if (process.env.BONFIRE_SMOKE === 'hosts')
    return verifyHostsAnywhere(mainWindow, backend);

  const { api } = backend;
  // The window may be behind others, where it would draw only now and then.
  mainWindow.webContents.setBackgroundThrottling(false);
  const { repository, outsideDirectory } = await createSmokeRepository();
  const project = {
    id: randomUUID(),
    name: PROJECT_NAME,
    path: repository,
    createdAt: Date.now(),
    lastOpenedAt: Date.now(),
  };
  backend.store.projects.add(project);

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
  await backend.terminals.resize(firstTerminalId, 100, 30);
  await backend.terminals.write(
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
  await verifyFlowControl(backend, project.path, firstTerminalId);

  await assert.rejects(() =>
    api.filesystem.readFile(project.id, '../outside/secret.txt'),
  );
  await symlink(outsideDirectory, join(repository, 'escape'));
  await assert.rejects(() =>
    api.filesystem.readFile(project.id, 'escape/secret.txt'),
  );

  let secondChatShell: string | undefined;
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
    secondChatShell = chatShellTerminalId;
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
  // Typing from the page reaches the terminal, and its output reaches the page, straight
  // between the page and the terminal host; the sum shows only in the output.
  const page = mainWindow.webContents;
  await page.executeJavaScript(
    `document.querySelector('[data-pane-id="${firstShellPane.id}"]')?.scrollIntoView({ inline: 'nearest' })`,
  );
  assert.match(
    await typeInPage(page, firstTerminalId, 'echo BONFIRE_LIVE_$((40+2))'),
    /BONFIRE_LIVE_42/,
  );
  // A busy terminal in view draws with WebGL where the GPU allows, and with the DOM otherwise.
  await typeInPage(
    page,
    firstTerminalId,
    'seq 1 100000; echo BONFIRE_BURST_$((1+2))',
    /BONFIRE_BURST_3/,
  );
  const renderer = await page.executeJavaScript(
    `document.querySelector('[data-pane-id="${firstShellPane.id}"] [data-renderer]')?.dataset.renderer`,
  );
  assert(['webgl', 'dom'].includes(renderer), 'the terminal is drawn');
  console.log(`BONFIRE_RENDERER: ${renderer}`);
  await saveScreenshot(mainWindow);
  await verifyHosts(
    backend,
    mainWindow.webContents,
    project.id,
    secondChatShell!,
  );
  await verifyBrowserPane(mainWindow, backend);
  console.log(
    'BONFIRE_SMOKE_OK: renderer, isolated IPC, concurrent PTYs, CLIs, Git diff, confined files, persistence',
  );
}
