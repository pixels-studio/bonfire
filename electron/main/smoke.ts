import type { BrowserWindow } from 'electron';
import type { services } from './services';
import { mkdir, mkdtemp, writeFile, readFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { git } from './git';
import { Store } from './persistence';
import assert from 'node:assert/strict';
export async function smoke(
  win: BrowserWindow,
  backend: ReturnType<typeof services>,
) {
  if (process.env.BONFIRE_SMOKE === 'restart') {
    await new Promise((r) => setTimeout(r, 1800));
    assert.equal(backend.store.state.sessions.length, 1);
    assert.equal(backend.store.state.panes.length, 4);
    assert.equal(backend.terminal.records.size, 4);
    assert.match(
      await win.webContents.executeJavaScript('document.body.innerText'),
      /Smoke repository/,
    );
    console.log(
      'BONFIRE_RESTART_OK: project, session, pane layout restored; four fresh PTYs',
    );
    return;
  }
  const root = await mkdtemp(join(tmpdir(), 'bonfire-smoke-')),
    repo = join(root, 'repo'),
    outside = join(root, 'outside');
  await mkdir(repo);
  await mkdir(outside);
  await writeFile(join(outside, 'secret.txt'), 'nope\n');
  await git(repo, ['init', '-b', 'main']);
  await git(repo, ['config', 'user.email', 'test@bonfire.local']);
  await git(repo, ['config', 'user.name', 'Bonfire Test']);
  await writeFile(join(repo, 'hello.txt'), 'original\n');
  await git(repo, ['add', '.']);
  await git(repo, ['commit', '-m', 'Initial']);
  const { randomUUID } = await import('node:crypto');
  const project = {
    id: randomUUID(),
    name: 'Smoke repository',
    path: repo,
    createdAt: Date.now(),
    lastOpenedAt: Date.now(),
  };
  backend.store.state.projects.push(project);
  backend.store.save();
  const api = backend.api;
  const session = await api.sessions.create({
    projectId: project.id,
    title: 'Implement Meeting Link',
  });
  assert.equal(session.worktreePath, repo);
  assert.equal(
    await readFile(join(session.worktreePath, 'hello.txt'), 'utf8'),
    'original\n',
  );
  await win.webContents.reload();
  await new Promise<void>((r) =>
    win.webContents.once('did-finish-load', () => r()),
  );
  await new Promise((r) => setTimeout(r, 1000));
  assert.equal(
    await win.webContents.executeJavaScript(
      'typeof window.bonfire.terminal.create',
    ),
    'function',
  );
  assert.equal(
    await win.webContents.executeJavaScript('typeof window.require'),
    'undefined',
  );
  const shell = await api.panes.add(session.id, 'terminal');
  const terminalId = await api.terminal.create({
    sessionId: session.id,
    paneId: shell.id,
    type: 'shell',
  });
  await api.terminal.resize(terminalId, 100, 30);
  await api.terminal.write(
    terminalId,
    "printf 'shared change\\n' > hello.txt; printf 'BONFIRE_PTY_OK\\n'; pwd\r",
  );
  await new Promise((r) => setTimeout(r, 1500));
  const snap = await api.terminal.snapshot(terminalId);
  assert.match(snap.data, /BONFIRE_PTY_OK/);
  assert.equal(
    await api.filesystem.readFile(session.id, 'hello.txt'),
    'shared change\n',
  );
  assert(
    (await api.git.status(session.id)).changes.some(
      (c) => c.path === 'hello.txt',
    ),
  );
  assert.match(await api.git.diff(session.id, 'hello.txt'), /shared change/);
  const shell2 = await api.panes.add(session.id, 'terminal');
  const second = await api.terminal.create({
    sessionId: session.id,
    paneId: shell2.id,
    type: 'shell',
  });
  assert.notEqual(second, terminalId);
  await api.sessions.select(session.id);
  assert.equal((await api.terminal.snapshot(terminalId)).exitCode, undefined);
  await assert.rejects(() =>
    api.filesystem.readFile(session.id, '../outside/secret.txt'),
  );
  await symlink(outside, join(session.worktreePath, 'escape'));
  await assert.rejects(() =>
    api.filesystem.readFile(session.id, 'escape/secret.txt'),
  );
  for (const type of ['claude', 'codex'] as const) {
    const pane = await api.panes.add(session.id, type);
    const id = await api.terminal.create({
      sessionId: session.id,
      paneId: pane.id,
      type,
    });
    await new Promise((r) => setTimeout(r, 2500));
    const result = await api.terminal.snapshot(id);
    console.log(
      type + ' CLI:',
      JSON.stringify({
        outputBytes: result.data.length,
        exitCode: result.exitCode,
      }),
    );
    assert(result.data.length > 0, `${type} must produce terminal output`);
  }
  const restored = new Store(process.env.BONFIRE_USER_DATA!);
  assert(restored.state.sessions.some((s) => s.id === session.id));
  assert.equal(
    restored.state.panes.filter((p) => p.sessionId === session.id).length,
    4,
  );
  await win.webContents.reload();
  await new Promise<void>((r) =>
    win.webContents.once('did-finish-load', () => r()),
  );
  await new Promise((r) => setTimeout(r, 1500));
  assert.match(
    await win.webContents.executeJavaScript('document.body.innerText'),
    /Smoke repository/,
  );
  await win.webContents.executeJavaScript(
    "[...document.querySelectorAll('.file-row')].find(e=>e.textContent.includes('hello.txt'))?.click()",
  );
  await new Promise((r) => setTimeout(r, 300));
  await mkdir(join(process.cwd(), 'artifacts'), { recursive: true });
  await writeFile(
    join(process.cwd(), 'artifacts', 'smoke.png'),
    (await win.webContents.capturePage()).toPNG(),
  );
  console.log(
    'BONFIRE_SMOKE_OK: renderer, isolated IPC, concurrent PTYs, CLIs, Git diff, confined files, persistence',
  );
}
