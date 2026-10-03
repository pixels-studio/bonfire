import { randomUUID } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import { basename } from 'node:path';
import {
  assistantProvider,
  events,
  type AssistantEvent,
  type AssistantProvider,
  type AssistantSendInput,
  type Backend,
  type GithubSignInEnd,
  type Pane,
  type PaneType,
  type Preferences,
  type Project,
  type Session,
} from '../../shared/contracts';
import {
  DEFAULT_TITLE,
  MAX_PANES,
  PROVIDER_LABELS,
  errorMessage,
  isDefaultTitle,
  reorderLayout,
  resolvePreferences,
  titleFrom,
} from '../../shared/domain';
import type { AssistantHost } from './assistant';
import { ClaudeAssistant } from './claude';
import { CodexAssistant } from './codex';
import { favicon } from './favicon';
import { Filesystem } from './filesystem';
import * as git from './git';
import { GitHub } from './github';
import { KeepAwake, type Power } from './keep-awake';
import { MergeWatcher } from './merge-watcher';
import { TurnNotifier, type Notice } from './notifier';
import { Store } from './persistence';
import { Terminals } from './terminal';
import { cleanTitle, titlePrompt } from './titles';
import { TokenUsage } from './token-usage';

export type ServiceOptions = AssistantHost & {
  dataDirectory: string;
  chooseDirectory: () => Promise<string | undefined>;
  send: (channel: string, data: unknown) => void;
  openHelp: () => Promise<void>;
  isFullscreen: () => boolean;
  copyText: (text: string) => void;
  /** Shows a system notification; the shell decides whether it is worth interrupting for. */
  notify: (notice: Notice) => void;
  power: Power;
};

export function services(options: ServiceOptions) {
  const store = new Store(options.dataDirectory);
  const files = new Filesystem();
  const tokenUsage = new TokenUsage();
  const github = new GitHub();
  const terminals = new Terminals(store, (event) =>
    options.send(events.terminalData, event),
  );
  const notifier = new TurnNotifier(store, options.notify);
  const keepAwake = new KeepAwake(
    () => store.preferences.caffeinate,
    options.power,
  );
  const emitAssistantEvent = (event: AssistantEvent) => {
    options.send(events.assistantEvent, event);
    notifier.handle(event);
    keepAwake.handle(event);
  };
  const host: AssistantHost = {
    chooseImage: options.chooseImage,
    openUrl: options.openUrl,
  };
  const assistants = {
    claude: new ClaudeAssistant(store, emitAssistantEvent, host),
    codex: new CodexAssistant(store, emitAssistantEvent, host),
  };
  const providerOf = (pane: Pane): AssistantProvider =>
    pane.type === 'claude' ? 'claude' : 'codex';
  const assistantFor = (paneId: string) =>
    assistants[providerOf(store.pane(paneId))];
  const worktree = (sessionId: string) => store.session(sessionId).worktreePath;
  const hasStarted = (pane: Pane) => pane.messages.length > 0;

  const mergeWatcher = new MergeWatcher({
    store,
    github,
    isBusy: (paneId) => assistantFor(paneId).isRunning(paneId),
    archive: (paneIds) => {
      for (const id of paneIds) archivePane(store.pane(id));
      store.save();
      options.send(events.panesClosed, { paneIds, reason: 'merged' });
    },
  });
  mergeWatcher.start();

  function requireEnabled(provider: AssistantProvider) {
    if (!store.preferences.providers[provider])
      throw Error(`${PROVIDER_LABELS[provider]} is turned off in Settings.`);
  }

  /** The provider and model new panes start with: the chosen default, else the last used. */
  function startingModel() {
    const { defaultModel, providers } = store.preferences;
    if (defaultModel && providers[defaultModel.provider]) return defaultModel;
    const { lastProvider, lastModels } = store.state.settings;
    const provider =
      lastProvider && providers[lastProvider]
        ? lastProvider
        : (assistantProvider.options.find((option) => providers[option]) ??
          'claude');
    return { provider, model: lastModels?.[provider] ?? '' };
  }

  function archivePane(pane: Pane) {
    // An archived pane has no view left to show or answer its turn.
    if (pane.type !== 'terminal') assistantFor(pane.id).discard(pane.id);
    pane.archived = true;
  }

  /** Notes the branch the conversation is about to work on, to spot its pull request merging. */
  async function recordBranch(pane: Pane) {
    if (!pane.sessionId) return;
    const name = await git.currentBranch(worktree(pane.sessionId));
    if (!name) delete pane.workBranch;
    else if (pane.workBranch?.name !== name)
      pane.workBranch = { name, since: Date.now() };
  }

  /** Replaces the placeholder title taken from the first message with a generated one. */
  async function nameConversation(pane: Pane, text: string) {
    const { provider, model } = store.preferences.textModel;
    if (!store.preferences.providers[provider]) return;
    const placeholder = titleFrom(text);
    try {
      const title = cleanTitle(
        await assistants[provider].generate(titlePrompt(text), model),
      );
      // The send may have failed before starting, or the pane may be gone.
      if (!title || pane.archived || pane.title !== placeholder) return;
      pane.title = title;
      store.save();
      emitAssistantEvent({ paneId: pane.id, type: 'title', title });
    } catch (cause) {
      // The placeholder is a fine title, so a failure is only worth a log line.
      console.warn(`Could not name a conversation: ${errorMessage(cause)}`);
    }
  }

  async function send(input: AssistantSendInput) {
    const pane = store.pane(input.paneId);
    const provider = providerOf(pane);
    const assistant = assistants[provider];
    if (assistant.isRunning(pane.id)) return assistant.send(input);
    requireEnabled(provider);
    const naming = !hasStarted(pane) && isDefaultTitle(pane.title);
    await recordBranch(pane);
    const turn = assistant.send(input);
    if (naming) void nameConversation(pane, input.text);
    return turn;
  }

  function updatePreferences(patch: Partial<Preferences>) {
    const stored = { ...store.state.preferences, ...patch };
    const { providers } = resolvePreferences(stored);
    if (!providers.claude && !providers.codex)
      throw Error('Keep at least one provider turned on.');
    store.state.preferences = stored;
    store.save();
    keepAwake.update();
    void mergeWatcher.check();
    return store.preferences;
  }

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
    const starting = startingModel();
    const paneType = type ?? starting.provider;
    const pane: Pane = {
      id: randomUUID(),
      type: paneType,
      title: paneType === 'terminal' ? 'Terminal' : DEFAULT_TITLE,
      messages: [],
      model: model ?? modelFor(paneType, starting),
      reasoningEffort: 'medium',
      approvals: store.preferences.approvals,
      archived: false,
    };
    const { lastProjectId } = store.state;
    if (lastProjectId) await assignProject(pane, store.project(lastProjectId));
    store.state.panes.push(pane);
    store.state.layout.paneIds.unshift(pane.id);
    return pane;
  }

  function modelFor(
    type: PaneType,
    starting: ReturnType<typeof startingModel>,
  ) {
    if (type === 'terminal') return '';
    if (type === starting.provider) return starting.model;
    return store.state.settings.lastModels?.[type] ?? '';
  }

  const api: Backend = {
    state: { get: async () => store.state },
    preferences: {
      get: async () => store.preferences,
      update: async (patch) => updatePreferences(patch),
    },
    providers: {
      account: async (provider) => assistants[provider].account(),
      connect: async (provider) => assistants[provider].connect(),
      cancelConnect: async (provider) => assistants[provider].cancelConnect(),
      outputStyles: async () => assistants.claude.outputStyles(),
    },
    github: {
      status: async () => github.status(),
      connect: async () => {
        const signIn = await github.signIn(async (error) => {
          const end: GithubSignInEnd = {
            status: await github.status(),
            error: error?.message,
          };
          options.send(events.githubSignInEnd, end);
        });
        options.copyText(signIn.userCode);
        await options.openUrl(signIn.verificationUrl);
        return signIn;
      },
      cancelConnect: async () => github.cancelSignIn(),
    },
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
        archivePane(store.pane(id));
        store.save();
      },
      reorder: async (ids) => {
        const { layout } = store.state;
        layout.paneIds = reorderLayout(layout.paneIds, ids);
        store.save();
      },
    },
    assistant: {
      send,
      cancel: async (paneId) => assistantFor(paneId).cancel(paneId),
      respond: async (input) => assistantFor(input.paneId).respond(input),
      snapshot: async (paneId) => assistantFor(paneId).snapshot(paneId),
      models: async (provider) => assistants[provider].models(),
      pickAttachment: async (paneId) =>
        assistantFor(paneId).pickAttachment(paneId),
      attachText: async (paneId, text) =>
        assistantFor(paneId).attachText(paneId, text),
      sendQueued: async (paneId, queuedId) =>
        assistantFor(paneId).sendQueued(paneId, queuedId),
      unqueue: async (paneId, queuedId) =>
        assistantFor(paneId).unqueue(paneId, queuedId),
    },
    tokens: { get: async (range) => tokenUsage.stats(range) },
    limits: { get: async (provider) => assistants[provider].limits() },
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
      notifier.close();
      keepAwake.close();
      mergeWatcher.close();
      github.close();
      terminals.close();
      assistants.claude.close();
      assistants.codex.close();
      store.flush();
      await files.close();
    },
  };
}
