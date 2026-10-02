import { randomUUID } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import { basename } from 'node:path';
import {
  events,
  type Backend,
  type Pane,
  type PaneType,
  type Project,
  type Session,
} from '../../shared/contracts';
import { DEFAULT_TITLE, MAX_PANES, reorderLayout } from '../../shared/domain';
import type { ChooseImage } from './assistant';
import { ClaudeAssistant } from './claude';
import { CodexAssistant } from './codex';
import { favicon } from './favicon';
import { Filesystem } from './filesystem';
import * as git from './git';
import { Store } from './persistence';
import { Terminals } from './terminal';

export type ServiceOptions = {
  dataDirectory: string;
  chooseDirectory: () => Promise<string | undefined>;
  chooseImage: ChooseImage;
  send: (channel: string, data: unknown) => void;
  openHelp: () => Promise<void>;
  isFullscreen: () => boolean;
};

export function services(options: ServiceOptions) {
  const store = new Store(options.dataDirectory);
  const files = new Filesystem();
  const terminals = new Terminals(store, (event) =>
    options.send(events.terminalData, event),
  );
  const emitAssistantEvent = (event: unknown) =>
    options.send(events.assistantEvent, event);
  const assistants = {
    claude: new ClaudeAssistant(store, emitAssistantEvent, options.chooseImage),
    codex: new CodexAssistant(store, emitAssistantEvent, options.chooseImage),
  };

  const assistantFor = (paneId: string) =>
    assistants[store.pane(paneId).type === 'claude' ? 'claude' : 'codex'];
  const worktree = (sessionId: string) => store.session(sessionId).worktreePath;
  const hasStarted = (pane: Pane) => pane.messages.length > 0;

  async function createSession(project: Project, title: string) {
    const session: Session = {
      id: randomUUID(),
      projectId: project.id,
      title,
      worktreePath: project.path,
      branch: (await git.status(project.path)).branch,
      createdAt: Date.now(),
      lastOpenedAt: Date.now(),
    };
    store.state.sessions.push(session);
    return session;
  }

  /** The project's most recently opened session, created on first use. */
  async function latestSession(project: Project) {
    const latest = store.state.sessions
      .filter((session) => session.projectId === project.id)
      .sort((first, second) => second.lastOpenedAt - first.lastOpenedAt)[0];
    return latest ?? createSession(project, 'Workspace');
  }

  /** Binds the pane to the project's session and makes it the default for new panes. */
  async function assignProject(pane: Pane, project: Project) {
    const session = await latestSession(project);
    if (pane.sessionId !== session.id) terminals.closePane(pane.id);
    pane.sessionId = session.id;
    project.lastOpenedAt = session.lastOpenedAt = Date.now();
    store.state.lastProjectId = project.id;
  }

  /** Adds a pane at the front of the layout, defaulting to the last-used project, provider, and model. */
  async function addPane(type?: PaneType, model?: string) {
    const open = store.state.panes.filter(
      (pane) => !pane.archived && pane.type !== 'terminal',
    );
    if (type !== 'terminal' && open.length >= MAX_PANES)
      throw new Error(`You can have up to ${MAX_PANES} panes open.`);
    const { lastProvider, lastModels } = store.state.settings;
    const paneType = type ?? lastProvider ?? 'claude';
    const pane: Pane = {
      id: randomUUID(),
      type: paneType,
      title: paneType === 'terminal' ? 'Terminal' : DEFAULT_TITLE,
      messages: [],
      model:
        model ??
        (paneType === 'terminal' ? '' : (lastModels?.[paneType] ?? '')),
      reasoningEffort: 'medium',
      archived: false,
    };
    const { lastProjectId } = store.state;
    if (lastProjectId) await assignProject(pane, store.project(lastProjectId));
    store.state.panes.push(pane);
    store.state.layout.paneIds.unshift(pane.id);
    return pane;
  }

  const api: Backend = {
    state: { get: async () => store.state },
    projects: {
      add: async () => {
        const selected = await options.chooseDirectory();
        if (!selected) return null;
        const path = await realpath(selected);
        let project = store.state.projects.find((item) => item.path === path);
        if (!project) {
          project = {
            id: randomUUID(),
            name: basename(path),
            path,
            createdAt: Date.now(),
            lastOpenedAt: Date.now(),
          };
          store.state.projects.push(project);
        }
        store.save();
        return project;
      },
      remove: async (id) => {
        store.project(id);
        const sessionIds = new Set(
          store.state.sessions
            .filter((session) => session.projectId === id)
            .map((session) => session.id),
        );
        for (const sessionId of sessionIds) {
          terminals.closeSession(sessionId);
          await files.unwatch(sessionId);
        }
        const { state } = store;
        // Unstarted panes stay open and can pick another project; conversations go with it.
        const affected = (pane: Pane) =>
          !!pane.sessionId && sessionIds.has(pane.sessionId);
        for (const pane of state.panes)
          if (affected(pane) && !hasStarted(pane)) delete pane.sessionId;
        state.panes = state.panes.filter((pane) => !affected(pane));
        const paneIds = new Set(state.panes.map((pane) => pane.id));
        state.layout.paneIds = state.layout.paneIds.filter((paneId) =>
          paneIds.has(paneId),
        );
        state.sessions = state.sessions.filter(
          (session) => !sessionIds.has(session.id),
        );
        state.projects = state.projects.filter((project) => project.id !== id);
        if (state.lastProjectId === id) delete state.lastProjectId;
        store.save();
      },
      favicon: async (id) => favicon(store.project(id).path),
    },
    sessions: {
      create: async ({ projectId, title }) => {
        const session = await createSession(store.project(projectId), title);
        store.state.lastProjectId = projectId;
        store.save();
        return session;
      },
    },
    panes: {
      add: async (type, model) => {
        const pane = await addPane(type, model);
        store.save();
        return pane;
      },
      setProject: async (id, projectId) => {
        const pane = store.pane(id);
        if (hasStarted(pane))
          throw Error(
            'Cannot change project after the conversation has started',
          );
        await assignProject(pane, store.project(projectId));
        store.save();
        return pane;
      },
      retype: async (id, type, model) => {
        const pane = store.pane(id);
        if (hasStarted(pane))
          throw Error(
            'Cannot change provider after the conversation has started',
          );
        pane.type = type;
        pane.model = model;
        store.save();
        return pane;
      },
      archive: async (id) => {
        const pane = store.pane(id);
        // An archived pane has no view left to show or answer its turn.
        if (pane.type !== 'terminal') assistantFor(id).cancel(id);
        pane.archived = true;
        store.save();
      },
      reorder: async (ids) => {
        const { layout } = store.state;
        layout.paneIds = reorderLayout(layout.paneIds, ids);
        store.save();
      },
    },
    assistant: {
      send: async (input) => assistantFor(input.paneId).send(input),
      cancel: async (paneId) => assistantFor(paneId).cancel(paneId),
      respond: async (input) => assistantFor(input.paneId).respond(input),
      snapshot: async (paneId) => assistantFor(paneId).snapshot(paneId),
      models: async (provider) => assistants[provider].models(),
      pickAttachment: async (paneId) =>
        assistantFor(paneId).pickAttachment(paneId),
    },
    navigation: { help: options.openHelp },
    app: { isFullscreen: async () => options.isFullscreen() },
    terminal: {
      create: async (input) => terminals.create(input),
      write: async (id, data) => terminals.write(id, data),
      resize: async (id, cols, rows) => terminals.resize(id, cols, rows),
      snapshot: async (id) => terminals.snapshot(id),
    },
    git: {
      status: async (sessionId) => git.status(worktree(sessionId)),
      branches: async (projectId) =>
        git.branches(store.project(projectId).path),
      diff: async (sessionId, path) => {
        const root = worktree(sessionId);
        if (path.includes('\0') || path.split(/[\\/]/).includes('..'))
          throw Error('Invalid path');
        const change = (await git.status(root)).changes.find(
          (item) => item.path === path,
        );
        if (!change) throw Error('File is not a current change');
        if (change.index === '?')
          return `Untracked file\n\n${await files.read(root, path)}`;
        return git.diff(root, path);
      },
      checkout: async (sessionId, branch) => {
        const session = store.session(sessionId);
        await git.checkout(session.worktreePath, branch);
        session.branch = branch;
        store.save();
      },
    },
    filesystem: {
      list: async (sessionId, path) => files.list(worktree(sessionId), path),
      readFile: async (sessionId, path) =>
        files.read(worktree(sessionId), path),
      watch: async (sessionId) =>
        files.watch(sessionId, worktree(sessionId), (event) =>
          options.send(events.fileChange, event),
        ),
      unwatch: async (sessionId) => {
        store.session(sessionId);
        await files.unwatch(sessionId);
      },
    },
  };

  return {
    api,
    store,
    close: async () => {
      terminals.close();
      assistants.claude.close();
      assistants.codex.close();
      store.flush();
      await files.close();
    },
  };
}
