import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { realpath } from 'node:fs/promises';
import { basename, join } from 'node:path';
import {
  assistantProvider,
  events,
  type AssistantEvent,
  type AssistantProvider,
  type ArchiveResult,
  type AssistantSendInput,
  type Backend,
  type GithubSignInEnd,
  type Pane,
  type PaneType,
  type Preferences,
  type Project,
  type Session,
  type SetupStatus,
  type WorkspaceCreateInput,
} from '../../shared/contracts';
import {
  DEFAULT_TITLE,
  MAX_PANES,
  PROVIDER_LABELS,
  errorMessage,
  isDefaultTitle,
  isWorktree,
  pickWorkspaceName,
  reorderLayout,
  resolvePreferences,
  resolveProjectSettings,
  slugify,
  titleFrom,
  uniqueName,
} from '../../shared/domain';
import type { AssistantHost } from './assistant';
import { PendingAttachments } from './attachments';
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
import {
  copyIgnoredFiles,
  filesToCopyPatterns,
  freePort,
  runScript,
  workspaceEnvironment,
  worktreePath,
} from './worktrees';

export type ServiceOptions = AssistantHost & {
  dataDirectory: string;
  chooseDirectory: () => Promise<string | undefined>;
  send: (channel: string, data: unknown) => void;
  openHelp: () => Promise<void>;
  isFullscreen: () => boolean;
  windowControls: {
    minimize: () => void;
    toggleFullscreen: () => void;
    close: () => void;
  };
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
  const attachments = new PendingAttachments();
  const worktreesRoot = join(options.dataDirectory, 'worktrees');
  /** Each project's remote default branch, such as `main`, once looked up. */
  const defaultBranches = new Map<string, string | undefined>();
  /** Setup scripts that ran since the app started, by workspace. */
  const setupStatuses = new Map<string, SetupStatus>();
  const terminals = new Terminals(
    store,
    (event) => options.send(events.terminalData, event),
    (sessionId) => environmentFor(store.session(sessionId)),
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
    attachments,
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

  const projectOf = (session: Session) => store.project(session.projectId);
  const settingsOf = (project: Project) =>
    resolveProjectSettings(project, store.preferences);
  const sessionsOf = (project: Project) =>
    store.state.sessions.filter(({ projectId }) => projectId === project.id);
  const openPanesOf = (session: Session) =>
    store.state.panes.filter(
      (pane) => pane.sessionId === session.id && !pane.archived,
    );

  const mergeWatcher = new MergeWatcher({
    store,
    github,
    isBusy: (paneId) => assistantFor(paneId).isRunning(paneId),
    enabled: (pane) =>
      !!pane.sessionId &&
      settingsOf(projectOf(store.session(pane.sessionId))).archiveOnMerge,
    archive: (paneIds) => {
      // A merged branch finishes its whole workspace; in the project folder only the pane goes.
      const closed = new Set<string>();
      for (const id of paneIds) {
        const pane = store.pane(id);
        if (pane.archived || !pane.sessionId) continue;
        const session = store.session(pane.sessionId);
        if (isWorktree(session)) {
          for (const { id: openId } of openPanesOf(session)) closed.add(openId);
          void archiveWorkspace(session).catch((cause) =>
            console.warn(
              `Could not archive a workspace: ${errorMessage(cause)}`,
            ),
          );
        } else {
          archivePane(pane);
          closed.add(pane.id);
        }
      }
      store.save();
      options.send(events.panesClosed, {
        paneIds: [...closed],
        reason: 'merged',
      });
    },
  });
  mergeWatcher.start();
  void forgetMissingWorktrees();

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
      const session = pane.sessionId
        ? store.session(pane.sessionId)
        : undefined;
      if (session && isWorktree(session) && !session.title)
        await nameWorkspace(session, title);
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

  function environmentFor(session: Session) {
    const project = projectOf(session);
    return workspaceEnvironment(
      session,
      project,
      defaultBranches.get(project.id),
    );
  }

  async function defaultBranchOf(project: Project) {
    if (!defaultBranches.has(project.id))
      defaultBranches.set(project.id, await git.defaultBranch(project.path));
    return defaultBranches.get(project.id);
  }

  /** The branch new workspaces start from unless another is picked. */
  async function defaultBase(project: Project) {
    const { baseBranch } = settingsOf(project);
    if (baseBranch) return baseBranch;
    const remoteDefault = await defaultBranchOf(project);
    if (remoteDefault) return `origin/${remoteDefault}`;
    return (await git.currentBranch(project.path)) ?? 'HEAD';
  }

  /** The workspace on the project folder itself, created on first use. */
  async function defaultWorkspace(project: Project) {
    const existing = sessionsOf(project).find(
      (session) => !isWorktree(session),
    );
    if (existing) return existing;
    const session: Session = {
      id: randomUUID(),
      projectId: project.id,
      title: '',
      worktreePath: project.path,
      branch: await git.currentBranch(project.path),
      createdAt: Date.now(),
      lastOpenedAt: Date.now(),
      archived: false,
    };
    store.state.sessions.push(session);
    return session;
  }

  /** Puts the workspace on screen. */
  function openWorkspace(session: Session) {
    if (session.archived) throw Error('Restore the workspace first.');
    const project = projectOf(session);
    project.lastOpenedAt = session.lastOpenedAt = Date.now();
    store.state.currentSessionId = session.id;
    store.state.lastProjectId = project.id;
  }

  /** The project's most recently opened workspace. */
  async function latestWorkspace(project: Project) {
    const latest = sessionsOf(project)
      .filter((session) => !session.archived)
      .sort((first, second) => second.lastOpenedAt - first.lastOpenedAt)[0];
    return latest ?? defaultWorkspace(project);
  }

  /** Opens another workspace when the one on screen goes away. */
  async function leaveWorkspace(session: Session) {
    if (store.state.currentSessionId !== session.id) return;
    const project = store.state.projects.find(
      ({ id }) => id === session.projectId,
    );
    if (project) return openWorkspace(await latestWorkspace(project));
    const next = store.state.sessions
      .filter((other) => !other.archived && other.id !== session.id)
      .sort((first, second) => second.lastOpenedAt - first.lastOpenedAt)[0];
    if (next) openWorkspace(next);
    else delete store.state.currentSessionId;
  }

  function setSetupStatus(sessionId: string, status: SetupStatus) {
    setupStatuses.set(sessionId, status);
    options.send(events.workspaceSetup, { sessionId, status });
  }

  /** Copies ignored files such as `.env` into a new workspace. */
  async function copyFiles(session: Session, project: Project) {
    try {
      await copyIgnoredFiles(
        project,
        session.worktreePath,
        await filesToCopyPatterns(project),
      );
    } catch (cause) {
      console.warn(`Could not copy files: ${errorMessage(cause)}`);
    }
  }

  /** Runs the project's setup script in the workspace; its output shows in the workspace terminal. */
  function runSetup(session: Session, project: Project) {
    const script = settingsOf(project).setupScript.trim();
    if (!script) return;
    setSetupStatus(session.id, 'running');
    terminals
      .runSetup(session.id, script)
      .then((exitCode) =>
        setSetupStatus(session.id, exitCode === 0 ? 'succeeded' : 'failed'),
      )
      .catch(() => setSetupStatus(session.id, 'failed'));
  }

  async function createWorkspace(input: WorkspaceCreateInput) {
    const project = store.project(input.projectId);
    requireEnabled(input.provider);
    const { branchPrefix } = settingsOf(project);
    // Offline or without a remote, the workspace starts from what the clone already has.
    await git.fetch(project.path).catch(() => {});
    const branches = new Set(await git.branches(project.path));
    const sessions = sessionsOf(project);
    const name = pickWorkspaceName(
      (candidate) =>
        sessions.some((session) => session.name === candidate) ||
        branches.has(`${branchPrefix}${candidate}`) ||
        existsSync(worktreePath(worktreesRoot, project, candidate)),
    );
    const branch = `${branchPrefix}${name}`;
    const path = worktreePath(worktreesRoot, project, name);
    await git.addWorktree(project.path, path, branch, input.base);
    const session: Session = {
      id: randomUUID(),
      projectId: project.id,
      title: '',
      name,
      branch,
      baseBranch: input.base,
      worktreePath: path,
      port: freePort(store.state.sessions),
      createdAt: Date.now(),
      lastOpenedAt: Date.now(),
      archived: false,
    };
    const previous = store.state.currentSessionId;
    store.state.sessions.push(session);
    let pane: Pane;
    try {
      openWorkspace(session);
      pane = await addPane(input.provider, input.model);
      pane.reasoningEffort = input.reasoningEffort;
    } catch (cause) {
      store.state.sessions = store.state.sessions.filter(
        ({ id }) => id !== session.id,
      );
      store.state.currentSessionId = previous;
      await git.removeWorktree(project.path, path).catch(() => {});
      await git.deleteBranch(project.path, branch).catch(() => {});
      throw cause;
    }
    store.save();
    await copyFiles(session, project);
    runSetup(session, project);
    if (!input.text) {
      attachments.discard(input.draftId);
      return session;
    }
    attachments.transfer(input.draftId, pane.id);
    // The pane shows how the turn goes; only a turn that never started needs reporting here.
    send({
      paneId: pane.id,
      text: input.text,
      attachmentIds: input.attachmentIds,
      model: input.model,
      reasoningEffort: input.reasoningEffort,
      approvals: store.preferences.approvals,
    }).catch((cause) =>
      console.warn(`Could not start the first turn: ${errorMessage(cause)}`),
    );
    return session;
  }

  /**
   * Names the workspace after its first conversation, and its branch too while the branch
   * still has its placeholder name and hasn't been pushed.
   */
  async function nameWorkspace(session: Session, title: string) {
    session.title = title;
    store.save();
    options.send(events.workspacesChanged, undefined);
    const project = projectOf(session);
    const placeholder = `${settingsOf(project).branchPrefix}${session.name}`;
    const slug = slugify(title);
    const from = session.branch;
    if (!slug || from !== placeholder) return;
    try {
      if (
        (await git.currentBranch(session.worktreePath)) !== from ||
        (await git.hasUpstream(session.worktreePath, from))
      )
        return;
      const branches = new Set(await git.branches(project.path));
      const to = uniqueName(
        `${settingsOf(project).branchPrefix}${slug}`,
        (name) => branches.has(name),
      );
      await git.renameBranch(session.worktreePath, from, to);
      session.branch = to;
      for (const pane of store.state.panes)
        if (pane.sessionId === session.id && pane.workBranch?.name === from)
          pane.workBranch.name = to;
      store.save();
      options.send(events.workspacesChanged, undefined);
    } catch (cause) {
      console.warn(`Could not rename a branch: ${errorMessage(cause)}`);
    }
  }

  /**
   * Archives the workspace and its panes, runs the archive script, and removes its folder.
   * A folder with uncommitted changes is kept, along with its branch.
   */
  async function archiveWorkspace(session: Session): Promise<ArchiveResult> {
    if (!isWorktree(session))
      throw Error('The project folder can’t be archived.');
    if (session.archived) return { keptFolder: false };
    const project = projectOf(session);
    const settings = settingsOf(project);
    const panes = openPanesOf(session);
    session.archivedPaneIds = panes.map(({ id }) => id);
    for (const pane of panes) archivePane(pane);
    session.archived = true;
    await leaveWorkspace(session);
    store.save();
    terminals.closeSession(session.id);
    setupStatuses.delete(session.id);
    await files.unwatch(session.id);

    const result: ArchiveResult = { keptFolder: false };
    if (settings.archiveScript.trim() && existsSync(session.worktreePath))
      await runScript(
        settings.archiveScript,
        session.worktreePath,
        environmentFor(session),
      ).catch((cause) => (result.scriptError = errorMessage(cause)));
    try {
      await git.removeWorktree(project.path, session.worktreePath);
    } catch {
      result.keptFolder = existsSync(session.worktreePath);
    }
    if (!result.keptFolder && settings.deleteBranchOnArchive && session.branch)
      await git.deleteBranch(project.path, session.branch).catch(() => {});
    return result;
  }

  async function restoreWorkspace(session: Session) {
    if (!session.archived) return openWorkspace(session);
    const project = projectOf(session);
    if (!existsSync(session.worktreePath)) {
      const { branch } = session;
      if (!branch || !(await git.branchExists(project.path, branch)))
        throw Error(
          `The branch ${branch ?? ''} no longer exists, so the workspace can’t be restored.`,
        );
      await git.pruneWorktrees(project.path).catch(() => {});
      await git.checkoutWorktree(project.path, session.worktreePath, branch);
    }
    session.archived = false;
    const others = store.state.sessions.filter((other) => other !== session);
    if (others.some((other) => !other.archived && other.port === session.port))
      session.port = freePort(others);
    for (const id of session.archivedPaneIds ?? []) {
      const pane = store.state.panes.find((candidate) => candidate.id === id);
      if (pane) pane.archived = false;
    }
    delete session.archivedPaneIds;
    openWorkspace(session);
  }

  /** Drops git's records of worktrees whose folders were deleted outside the app. */
  async function forgetMissingWorktrees() {
    for (const project of store.state.projects)
      await git.pruneWorktrees(project.path).catch(() => {});
  }

  /** Adds a pane to the open workspace, at the front, with the last-used provider and model. */
  async function addPane(type?: PaneType, model?: string) {
    const session = store.state.currentSessionId
      ? store.session(store.state.currentSessionId)
      : undefined;
    if (!session) throw Error('Add a project first.');
    const open = openPanesOf(session).filter(
      (pane) => pane.type !== 'terminal',
    );
    if (type !== 'terminal' && open.length >= MAX_PANES)
      throw new Error(`A workspace can have up to ${MAX_PANES} panes open.`);
    const starting = startingModel();
    const paneType = type ?? starting.provider;
    const pane: Pane = {
      id: randomUUID(),
      sessionId: session.id,
      type: paneType,
      title: paneType === 'terminal' ? 'Terminal' : DEFAULT_TITLE,
      messages: [],
      model: model ?? modelFor(paneType, starting),
      reasoningEffort: 'medium',
      approvals: store.preferences.approvals,
      archived: false,
    };
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
    state: {
      get: async () => {
        // Branches change under the app, as agents and terminals check others out.
        await Promise.all(
          store.state.sessions
            .filter((session) => !session.archived)
            .map(async (session) => {
              const branch = await git.currentBranch(session.worktreePath);
              if (branch) session.branch = branch;
            }),
        );
        return store.state;
      },
    },
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
            settings: {},
          };
          store.state.projects.push(project);
        }
        openWorkspace(await latestWorkspace(project));
        store.save();
        return project;
      },
      remove: async (id) => {
        const project = store.project(id);
        const sessions = sessionsOf(project);
        const sessionIds = new Set(sessions.map((session) => session.id));
        for (const session of sessions) {
          for (const pane of openPanesOf(session)) archivePane(pane);
          terminals.closeSession(session.id);
          setupStatuses.delete(session.id);
          await files.unwatch(session.id);
          // Clean worktrees go; one with uncommitted work stays on disk.
          if (isWorktree(session) && !session.archived)
            await git
              .removeWorktree(project.path, session.worktreePath)
              .catch(() => {});
        }
        const { state } = store;
        const leaving = state.sessions.find(
          ({ id: sessionId }) => sessionId === state.currentSessionId,
        );
        state.panes = state.panes.filter(
          (pane) => !pane.sessionId || !sessionIds.has(pane.sessionId),
        );
        const paneIds = new Set(state.panes.map((pane) => pane.id));
        state.layout.paneIds = state.layout.paneIds.filter((paneId) =>
          paneIds.has(paneId),
        );
        state.sessions = state.sessions.filter(
          (session) => !sessionIds.has(session.id),
        );
        state.projects = state.projects.filter((item) => item.id !== id);
        if (state.lastProjectId === id) delete state.lastProjectId;
        if (leaving && sessionIds.has(leaving.id))
          await leaveWorkspace(leaving);
        store.save();
      },
      favicon: async (id) => favicon(store.project(id).path),
      updateSettings: async (id, patch) => {
        const project = store.project(id);
        project.settings = { ...project.settings, ...patch };
        store.save();
        void mergeWatcher.check();
        return project;
      },
      defaultBase: async (id) => defaultBase(store.project(id)),
    },
    workspaces: {
      create: async (input) => createWorkspace(input),
      open: async (id) => {
        openWorkspace(store.session(id));
        store.save();
      },
      openProject: async (projectId) => {
        openWorkspace(await latestWorkspace(store.project(projectId)));
        store.save();
      },
      archive: async (id) => {
        const result = await archiveWorkspace(store.session(id));
        store.save();
        return result;
      },
      restore: async (id) => {
        await restoreWorkspace(store.session(id));
        store.save();
      },
      pickAttachment: async (draftId) => {
        const file = await options.chooseImage();
        return file ? attachments.addImage(draftId, file) : null;
      },
      attachText: async (draftId, text) => attachments.addText(draftId, text),
      discardDraft: async (draftId) => attachments.discard(draftId),
      setupStatus: async () => Object.fromEntries(setupStatuses),
    },
    panes: {
      add: async (type, model) => {
        const pane = await addPane(type, model);
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
    window: {
      minimize: async () => options.windowControls.minimize(),
      toggleFullscreen: async () => options.windowControls.toggleFullscreen(),
      close: async () => options.windowControls.close(),
    },
    terminal: {
      create: async (input) => terminals.create(input),
      write: async (id, data) => terminals.write(id, data),
      resize: async (id, cols, rows) => terminals.resize(id, cols, rows),
      snapshot: async (id) => terminals.snapshot(id),
      close: async (sessionId, tab) => terminals.closeTab(sessionId, tab),
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
