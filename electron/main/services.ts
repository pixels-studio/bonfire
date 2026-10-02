import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import { realpath } from 'node:fs/promises';
import { Store } from './persistence';
import { Filesystem } from './filesystem';
import { Terminals } from './terminal';
import { Assistant } from './assistant';
import { ClaudeAssistant } from './claude';
import { favicon } from './favicon';
import * as git from './git';
import type { API, AssistantEvent, Session } from '../../shared/contracts';
export function services(
  root: string,
  choose: () => Promise<string | undefined>,
  chooseAttachment: () => Promise<{ name: string; path: string } | undefined>,
  emit: (channel: string, data: unknown) => void,
  openHelp: () => Promise<void>,
  isFullscreen: () => boolean,
) {
  const store = new Store(root),
    fs = new Filesystem(),
    terminal = new Terminals(store, (e) => emit('terminal:data', e)),
    assistantEmit = (e: AssistantEvent) => emit('assistant:event', e),
    assistant = new Assistant(store, assistantEmit, chooseAttachment),
    claudeAssistant = new ClaudeAssistant(store, assistantEmit, chooseAttachment),
    assistantFor = (paneId: string) =>
      store.pane(paneId).type === 'claude' ? claudeAssistant : assistant;
  const createPane = (sessionId: string) => ({
    id: randomUUID(),
    sessionId,
    type: 'codex' as const,
    title: 'New Conversation',
    messages: [],
    model: '',
    reasoningEffort: 'medium' as const,
    archived: false,
  });
  const ensureSession = async (projectId: string) => {
    const existing = store.state.sessions
      .filter((session) => session.projectId === projectId)
      .sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)[0];
    if (existing) return existing;
    const project = store.project(projectId);
    const sessionId = randomUUID();
    const pane = createPane(sessionId);
    const session: Session = {
      id: sessionId,
      projectId,
      title: 'Workspace',
      worktreePath: project.path,
      branch: (await git.status(project.path)).branch,
      createdAt: Date.now(),
      lastOpenedAt: Date.now(),
      layout: { paneIds: [pane.id], activePaneId: pane.id },
    };
    store.state.sessions.push(session);
    store.state.panes.push(pane);
    return session;
  };
  const removeSession = async (id: string) => {
    store.session(id);
    terminal.closeSession(id);
    await fs.unwatch(id);
    store.state.sessions = store.state.sessions.filter((s) => s.id !== id);
    store.state.panes = store.state.panes.filter((p) => p.sessionId !== id);
    if (store.state.lastSessionId === id) delete store.state.lastSessionId;
    store.save();
  };
  const api: Omit<API, 'terminal' | 'filesystem' | 'assistant' | 'app'> & {
    terminal: Omit<API['terminal'], 'onData'>;
    filesystem: Omit<API['filesystem'], 'onChange'>;
    assistant: Omit<API['assistant'], 'onEvent'>;
    app: Omit<API['app'], 'onFullscreenChange'>;
  } = {
    state: { get: async () => store.state },
    projects: {
      list: async () => store.state.projects,
      add: async () => {
        const selected = await choose();
        if (!selected) return null;
        const path = await realpath(selected);
        let p = store.state.projects.find((p) => p.path === path);
        if (!p) {
          p = {
            id: randomUUID(),
            name: basename(path),
            path,
            createdAt: Date.now(),
            lastOpenedAt: Date.now(),
          };
          store.state.projects.push(p);
        }
        store.state.lastProjectId = p.id;
        const session = await ensureSession(p.id);
        store.state.lastSessionId = session.id;
        store.save();
        return p;
      },
      select: async (id) => {
        store.project(id).lastOpenedAt = Date.now();
        store.state.lastProjectId = id;
        const session = await ensureSession(id);
        session.lastOpenedAt = Date.now();
        store.state.lastSessionId = session.id;
        store.save();
      },
      remove: async (id) => {
        store.project(id);
        for (const s of store.state.sessions.filter(
          (s) => s.projectId === id,
        )) {
          terminal.closeSession(s.id);
          await fs.unwatch(s.id);
        }
        const ids = new Set(
          store.state.sessions
            .filter((s) => s.projectId === id)
            .map((s) => s.id),
        );
        store.state.panes = store.state.panes.filter(
          (p) => !ids.has(p.sessionId),
        );
        store.state.sessions = store.state.sessions.filter(
          (s) => s.projectId !== id,
        );
        store.state.projects = store.state.projects.filter((p) => p.id !== id);
        if (store.state.lastProjectId === id) {
          delete store.state.lastProjectId;
          delete store.state.lastSessionId;
        }
        store.save();
      },
      favicon: async (id) => favicon(store.project(id).path),
    },
    sessions: {
      create: async (input) => {
        const p = store.project(input.projectId),
          id = randomUUID();
        const s: Session = {
          id,
          projectId: p.id,
          title: input.title,
          worktreePath: p.path,
          branch: (await git.status(p.path)).branch,
          createdAt: Date.now(),
          lastOpenedAt: Date.now(),
          layout: { paneIds: [] },
        };
        store.state.sessions.push(s);
        store.state.lastProjectId = p.id;
        store.state.lastSessionId = s.id;
        store.save();
        return s;
      },
      select: async (id) => {
        const s = store.session(id);
        s.lastOpenedAt = Date.now();
        store.state.lastSessionId = id;
        store.state.lastProjectId = s.projectId;
        store.save();
      },
      remove: removeSession,
    },
    panes: {
      add: async (sessionId, type) => {
        const s = store.session(sessionId);
        const p = {
          id: randomUUID(),
          sessionId,
          type,
          title:
            type === 'terminal'
              ? 'Terminal'
              : type === 'claude'
                ? 'Claude'
                : 'Codex',
          messages: [],
          model: '',
          reasoningEffort: 'medium' as const,
          archived: false,
        };
        store.state.panes.push(p);
        s.layout.paneIds.unshift(p.id);
        s.layout.activePaneId = p.id;
        store.save();
        return p;
      },
      select: async (id) => {
        const p = store.pane(id);
        store.session(p.sessionId).layout.activePaneId = id;
        store.save();
      },
      remove: async (id) => {
        const p = store.pane(id),
          s = store.session(p.sessionId);
        terminal.closePane(id);
        store.state.panes = store.state.panes.filter((p) => p.id !== id);
        s.layout.paneIds = s.layout.paneIds.filter((pid) => pid !== id);
        if (s.layout.activePaneId === id)
          s.layout.activePaneId = s.layout.paneIds[0];
        store.save();
      },
      archive: async (id) => {
        const pane = store.pane(id);
        pane.archived = true;
        store.save();
      },
    },
    assistant: {
      send: async (input) => assistantFor(input.paneId).send(input),
      cancel: async (paneId) => assistantFor(paneId).cancel(paneId),
      pickAttachment: async (paneId) =>
        assistantFor(paneId).pickAttachment(paneId),
    },
    navigation: { help: openHelp },
    app: { isFullscreen: async () => isFullscreen() },
    terminal: {
      create: async (i) => terminal.create(i),
      write: async (id, data) => terminal.write(id, data),
      resize: async (id, c, r) => terminal.resize(id, c, r),
      kill: async (id) => terminal.kill(id),
      snapshot: async (id) => {
        const r = terminal.get(id);
        return { data: r.data, sequence: r.sequence, exitCode: r.exitCode };
      },
    },
    git: {
      status: async (id) => git.status(store.session(id).worktreePath),
      branches: async (id) => git.branches(store.project(id).path),
      diff: async (id, path) => {
        const root = store.session(id).worktreePath;
        if (path.includes('\0') || path.split(/[\\/]/).includes('..'))
          throw Error('Invalid path');
        const s = await git.status(root);
        const change = s.changes.find((c) => c.path === path);
        if (!change) throw Error('File is not a current change');
        if (change.index === '?')
          return 'Untracked file\n\n' + (await fs.read(root, path));
        return git.diff(root, path);
      },
      checkout: async (id, branch) => {
        const s = store.session(id);
        await git.checkout(s.worktreePath, branch);
        s.branch = branch;
        store.save();
      },
    },
    filesystem: {
      list: async (id, path) => fs.list(store.session(id).worktreePath, path),
      readFile: async (id, path) =>
        fs.read(store.session(id).worktreePath, path),
      stat: async (id, path) => fs.stat(store.session(id).worktreePath, path),
      watch: async (id) =>
        fs.watch(id, store.session(id).worktreePath, (e) =>
          emit('filesystem:change', e),
        ),
      unwatch: async (id) => {
        store.session(id);
        await fs.unwatch(id);
      },
    },
    settings: {
      update: async (settings) => {
        store.state.settings = settings;
        store.save();
      },
    },
  };
  return {
    api,
    store,
    terminal,
    close: async () => {
      terminal.close();
      assistant.close();
      claudeAssistant.close();
      await fs.close();
    },
  };
}
