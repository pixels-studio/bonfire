import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
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
  type PullRequestDraft,
  type Preferences,
  type ConnectionCheck,
  type Project,
  type ProjectCloneInput,
  type ProjectCreateInput,
  type RemoteFolder,
  type SshConnection,
  type SshConnectionInput,
} from '../../shared/contracts';
import {
  DEFAULT_TITLE,
  MAX_PANES,
  PROVIDER_LABELS,
  TOOL_PANE_TITLES,
  cloneUrl,
  errorMessage,
  folderName,
  isAssistantPane,
  isDefaultTitle,
  promptText,
  reorderLayout,
  repositoryName,
  ACTION_LABELS,
  actionPrompt,
  otherProvider,
  resolvePreferences,
  startingProvider,
  withoutMarkers,
  titleFrom,
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
import { Machines, SshMachine, localMachine, type Place } from './machines';
import { MergeWatcher } from './merge-watcher';
import { TurnNotifier, type Notice } from './notifier';
import { Store } from './persistence';
import { Scripts } from './scripts';
import { Terminals } from './terminal';
import {
  parsePullRequestText,
  actionAgentPrompt,
  pullRequestPrompt,
} from './pull-request-text';
import { cleanTitle, titlePrompt } from './titles';
import { TokenUsage } from './token-usage';

export type ServiceOptions = AssistantHost & {
  dataDirectory: string;
  chooseDirectory: () => Promise<string | undefined>;
  /** Asks for a private key file for an SSH connection. */
  chooseIdentity: () => Promise<string | undefined>;
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
  const attachments = new PendingAttachments();
  const machines = new Machines(() => store.state.connections);
  const machineOf = (project: Project) => machines.get(project.connectionId);
  /** The project folder, on its machine. */
  const placeOf = (project: Project) =>
    machines.place(project.connectionId, project.path);
  const folder = (projectId: string) => placeOf(store.project(projectId));
  const terminals = new Terminals(
    store,
    (event) => {
      options.send(events.terminalData, event);
      scripts.handle(event);
    },
    (projectId) => machineOf(store.project(projectId)),
  );
  const scripts: Scripts = new Scripts({
    store,
    terminals,
    machine: machineOf,
    addPane: (project) => addPane('terminal', project),
    archivePane,
    emit: (run) => options.send(events.scriptRun, run),
  });
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
    machineOf,
  };
  const assistants = {
    claude: new ClaudeAssistant(store, emitAssistantEvent, host),
    codex: new CodexAssistant(store, emitAssistantEvent, host),
  };
  const providerOf = (pane: Pane): AssistantProvider => {
    if (!isAssistantPane(pane)) throw Error('This pane has no assistant');
    return pane.type;
  };
  const assistantFor = (paneId: string) =>
    assistants[providerOf(store.pane(paneId))];

  /** The branch pull requests merge into: the remote's default branch. */
  async function pullRequestBase(cwd: Place) {
    return (await git.defaultBranch(cwd)) ?? 'main';
  }

  /** Commits the branch has beyond its base, newest first. */
  async function commitsBeyond(cwd: Place, base: string) {
    for (const ref of [`origin/${base}`, base])
      try {
        return await git.commitsAhead(cwd, ref);
      } catch {
        // The ref isn't known here; try the next.
      }
    return [];
  }

  /** A title from a branch name: `team/fix-dropdown-height` becomes "Fix dropdown height". */
  function branchTitle(branch: string) {
    const words = (branch.split('/').pop() ?? '').replace(/[-_]+/g, ' ').trim();
    return words.charAt(0).toUpperCase() + words.slice(1);
  }

  async function pullRequestDraft(
    projectId: string,
  ): Promise<PullRequestDraft> {
    const cwd = folder(projectId);
    const branch = (await git.currentBranch(cwd)) ?? '';
    const base = await pullRequestBase(cwd);
    const [commits, status, unpushed] = await Promise.all([
      branch ? commitsBeyond(cwd, base) : [],
      git.status(cwd),
      branch ? git.unpushedCount(cwd) : 0,
    ]);
    const uncommitted = status.changes.length;
    const single = commits.length === 1;
    const draft: PullRequestDraft = {
      branch,
      base,
      title: single ? commits[0] : branchTitle(branch),
      body: single
        ? await git.lastCommitBody(cwd)
        : commits
            .toReversed()
            .map((subject) => `- ${subject}`)
            .join('\n'),
      commits,
      uncommitted,
      unpushed,
    };
    if (!branch) draft.blocked = 'Check out a branch to open a pull request.';
    else if (branch === base)
      draft.blocked = `This is the ${base} branch. Create a branch from the branch menu to open a pull request.`;
    else if (!commits.length && !uncommitted)
      draft.blocked = `This branch has no changes beyond ${base} yet.`;
    return draft;
  }

  /** Writes the pull request's text with the text model, falling back to the draft's. */
  async function writePullRequest(cwd: Place, draft: PullRequestDraft) {
    const { provider, model } = store.preferences.textModel;
    if (!store.preferences.providers[provider]) return draft;
    try {
      const reply = await assistants[provider].generate(
        pullRequestPrompt({
          branch: draft.branch,
          base: draft.base,
          commits: draft.commits,
          diff: await git.changesBeyond(cwd, draft.base),
        }),
        model,
      );
      return parsePullRequestText(reply) ?? draft;
    } catch (cause) {
      console.warn(`Could not write a pull request: ${errorMessage(cause)}`);
      return draft;
    }
  }

  const hasStarted = (pane: Pane) => pane.messages.length > 0;

  const openPanesOf = (project: Project) =>
    store.state.panes.filter(
      (pane) => pane.projectId === project.id && !pane.archived,
    );

  const mergeWatcher = new MergeWatcher({
    store,
    github,
    isBusy: (paneId) => assistantFor(paneId).isRunning(paneId),
    place: folder,
    archive: (paneIds) => {
      const closed = paneIds.filter((id) => !store.pane(id).archived);
      for (const id of closed) archivePane(store.pane(id));
      store.save();
      options.send(events.panesClosed, { paneIds: closed, reason: 'merged' });
    },
  });

  mergeWatcher.start();

  function requireEnabled(provider: AssistantProvider) {
    if (!store.preferences.providers[provider])
      throw Error(`${PROVIDER_LABELS[provider]} is turned off in Settings.`);
  }

  /** Branches change the files every agent in the project works on, so none may be mid-turn. */
  function requireIdle(project: Project) {
    const busy = openPanesOf(project).some(
      (pane) =>
        isAssistantPane(pane) && assistantFor(pane.id).isRunning(pane.id),
    );
    if (busy)
      throw Error(
        'Wait for the agents in this project to finish, or stop them, before switching branches.',
      );
  }

  /** The provider and model new panes start with: the chosen default, else the last used. */
  function startingModel() {
    const { defaultModel } = store.preferences;
    const { lastProvider, lastModels } = store.state.settings;
    const provider = startingProvider(store.preferences, lastProvider);
    if (defaultModel?.provider === provider) return defaultModel;
    return { provider, model: lastModels?.[provider] ?? '' };
  }

  function archivePane(pane: Pane) {
    // An archived pane has no view left to show, answer its turn, or type into its shell.
    if (isAssistantPane(pane)) assistantFor(pane.id).discard(pane.id);
    terminals.closePane(pane.id);
    scripts.forgetPane(pane.id);
    pane.archived = true;
  }

  /** Notes the branch the conversation is about to work on, to spot its pull request merging. */
  async function recordBranch(pane: Pane) {
    if (!pane.projectId) return;
    const name = await git.currentBranch(folder(pane.projectId));
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
    if (naming)
      void nameConversation(
        pane,
        withoutMarkers(promptText(input.text, input.skills)),
      );
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

  /** Puts the project on screen. */
  function openProject(project: Project) {
    project.lastOpenedAt = Date.now();
    store.state.lastProjectId = project.id;
  }

  /** Opens the most recently opened project, or shows none when there are none. */
  function openLatestProject() {
    const latest = store.state.projects.toSorted(
      (first, second) => second.lastOpenedAt - first.lastOpenedAt,
    )[0];
    if (latest) return openProject(latest);
    delete store.state.lastProjectId;
  }

  /** Adds a pane to the project on screen, at the front; agents start with the last-used provider and model. */
  function addPane(
    type?: PaneType,
    project = store.state.lastProjectId
      ? store.project(store.state.lastProjectId)
      : undefined,
    other = false,
  ) {
    if (!project) throw Error('Add a project first.');
    if (openPanesOf(project).length >= MAX_PANES)
      throw new Error(`A project can have up to ${MAX_PANES} panes open.`);
    const starting = startingModel();
    const paneType =
      type ??
      (other
        ? otherProvider(starting.provider, store.preferences.providers)
        : starting.provider);
    const agent = paneType === 'claude' || paneType === 'codex';
    if (agent) requireEnabled(paneType);
    const pane: Pane = {
      id: randomUUID(),
      projectId: project.id,
      type: paneType,
      title: agent ? DEFAULT_TITLE : TOOL_PANE_TITLES[paneType],
      messages: [],
      model: agent ? modelFor(paneType, starting) : '',
      reasoningEffort: store.state.settings.lastReasoningEffort ?? 'medium',
      fastMode: false,
      approvals: store.preferences.approvals,
      archived: false,
    };
    store.state.panes.push(pane);
    store.state.layout.paneIds.unshift(pane.id);
    return pane;
  }

  function modelFor(
    provider: AssistantProvider,
    starting: ReturnType<typeof startingModel>,
  ) {
    if (provider === starting.provider) return starting.model;
    return store.state.settings.lastModels?.[provider] ?? '';
  }

  async function removeProject(project: Project) {
    for (const pane of openPanesOf(project)) archivePane(pane);
    terminals.closeProject(project.id);
    await files.unwatch(project.id);
    const { state } = store;
    state.panes = state.panes.filter((pane) => pane.projectId !== project.id);
    const paneIds = new Set(state.panes.map((pane) => pane.id));
    state.layout.paneIds = state.layout.paneIds.filter((paneId) =>
      paneIds.has(paneId),
    );
    state.projects = state.projects.filter((item) => item !== project);
    if (state.lastProjectId === project.id) openLatestProject();
    store.save();
  }

  /** Creates a branch from `base` and switches to it; a remote base is fetched first. */
  async function createBranch(project: Project, name: string, base: string) {
    requireIdle(project);
    const cwd = placeOf(project);
    // Offline or without a remote, the branch starts from what the clone already has.
    if (base.startsWith('origin/')) await git.fetch(cwd).catch(() => {});
    await git.createBranch(cwd, name, base);
  }

  /** Adds a folder as a project, or finds the project it already is, and opens it. */
  async function createProject({
    name,
    path,
    connectionId,
  }: ProjectCreateInput) {
    const machine = machines.get(connectionId);
    const home = await machine.home();
    const expanded =
      path === '~' || path.startsWith('~/')
        ? machine.path.join(home, path.slice(1))
        : path;
    let resolved: string;
    try {
      resolved = await machine.realpath(expanded);
      await machine.readdir(resolved);
    } catch (cause) {
      throw Error(`Could not open ${path}: ${errorMessage(cause)}`);
    }
    let project = store.state.projects.find(
      (item) => item.path === resolved && item.connectionId === connectionId,
    );
    if (!project) {
      project = {
        id: randomUUID(),
        name: name.trim() || folderName(resolved),
        path: resolved,
        connectionId,
        createdAt: Date.now(),
        lastOpenedAt: Date.now(),
      };
      store.state.projects.push(project);
    }
    openProject(project);
    store.save();
    return project;
  }

  /** Folders in the home folder where people tend to keep their code, most likely first. */
  const CODE_FOLDERS = ['Developer', 'Projects', 'Code', 'code', 'src', 'dev'];

  /** Where clones go by default: the first code folder that exists, else ~/Developer. */
  async function cloneFolder() {
    for (const name of CODE_FOLDERS) {
      const path = join(homedir(), name);
      if (await localMachine.exists(path)) return path;
    }
    return join(homedir(), CODE_FOLDERS[0]);
  }

  /** Clones a repository into a new folder inside `parent`, then adds it as a project. */
  async function cloneProject({ url, parent }: ProjectCloneInput) {
    const resolvedUrl = cloneUrl(url);
    if (!resolvedUrl) throw Error(`${url} isn't a repository URL.`);
    const name = repositoryName(resolvedUrl);
    if (!name || name === '.' || name === '..')
      throw Error(`Could not name a folder after ${url}.`);
    const base =
      parent === '~' || parent.startsWith('~/')
        ? join(homedir(), parent.slice(1))
        : parent;
    const path = join(base, name);
    if (await localMachine.exists(path))
      throw Error(
        `${path} already exists. Choose another folder, or add it as an existing folder.`,
      );
    await git.clone(resolvedUrl, path);
    return createProject({ name, path });
  }

  /** Adds a connection, or updates the one with the input's id. */
  function saveConnection(input: SshConnectionInput) {
    const connection: SshConnection = {
      ...input,
      id: input.id ?? randomUUID(),
      port: input.port || undefined,
      identityFile:
        input.auth === 'identity' ? input.identityFile || undefined : undefined,
    };
    const { connections } = store.state;
    const index = connections.findIndex(({ id }) => id === connection.id);
    if (index === -1) connections.push(connection);
    else connections[index] = connection;
    store.save();
    return connection;
  }

  function removeConnection(id: string) {
    const users = store.state.projects.filter(
      (project) => project.connectionId === id,
    );
    if (users.length)
      throw Error(
        `Remove the projects on this connection first: ${users.map(({ name }) => name).join(', ')}.`,
      );
    store.state.connections = store.state.connections.filter(
      (connection) => connection.id !== id,
    );
    store.save();
  }

  async function checkConnection(
    input: SshConnectionInput,
  ): Promise<ConnectionCheck> {
    const machine = new SshMachine({ ...input, id: input.id ?? randomUUID() });
    try {
      return { ok: true, home: await machine.home() };
    } catch (cause) {
      return { ok: false, error: errorMessage(cause) };
    }
  }

  /** The folders in `path` on the connection's machine, hidden ones left out. */
  async function browse(
    connectionId: string,
    path?: string,
  ): Promise<RemoteFolder> {
    const machine = machines.get(connectionId);
    const folder = await machine.realpath(path || (await machine.home()));
    const items = await machine.readdir(folder);
    const parent = machine.path.dirname(folder);
    return {
      path: folder,
      parent: parent === folder ? undefined : parent,
      folders: items
        .filter((item) => item.directory && !item.name.startsWith('.'))
        .map((item) => item.name)
        .sort((first, second) => first.localeCompare(second)),
    };
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
      repositories: async () => github.repositories(),
      pullRequest: async (projectId) => github.pullRequest(folder(projectId)),
      pullRequestDraft: async (projectId) => pullRequestDraft(projectId),
      createPullRequest: async (projectId, { title, body, commit }) => {
        const cwd = folder(projectId);
        const draft = await pullRequestDraft(projectId);
        if (draft.blocked) throw Error(draft.blocked);
        if (commit && draft.uncommitted) await git.commitAll(cwd, title);
        await git.pushBranch(cwd);
        const pull = await github.createPullRequest(cwd, {
          title,
          body,
          base: draft.base,
        });
        return pull;
      },
      runAction: async (projectId, action) => {
        const draft = await pullRequestDraft(projectId);
        if (action === 'push') {
          if (!draft.branch) throw Error('Check out a branch to push.');
          if (!draft.uncommitted && !draft.unpushed)
            throw Error('There is nothing to push.');
        } else if (action === 'createPr' && draft.blocked) {
          throw Error(draft.blocked);
        }
        const pane = addPane();
        store.save();
        // The turn runs on its own; its progress reaches the pane through events.
        void send({
          paneId: pane.id,
          text: actionAgentPrompt(
            actionPrompt(store.preferences, action),
            draft,
          ),
          attachmentIds: [],
          skills: [],
          model: pane.model,
          reasoningEffort: pane.reasoningEffort,
          fastMode: pane.fastMode,
          approvals: pane.approvals,
        }).catch((cause) =>
          console.warn(
            `Could not run ${ACTION_LABELS[action]}: ${errorMessage(cause)}`,
          ),
        );
        return pane.id;
      },
      mergePullRequest: async (projectId) =>
        github.mergePullRequest(folder(projectId)),
      openPullRequest: async (projectId) => {
        const pull = await github.pullRequest(folder(projectId));
        if (pull) await options.openUrl(pull.url);
      },
      activity: async (projectId) => github.activity(folder(projectId)),
      openActivity: async (url) => {
        if (new URL(url).origin !== 'https://github.com')
          throw Error('Only GitHub links can be opened.');
        await options.openUrl(url);
      },
    },
    projects: {
      chooseFolder: async () => (await options.chooseDirectory()) ?? null,
      create: async (input) => createProject(input),
      clone: async (input) => cloneProject(input),
      cloneFolder: async () => cloneFolder(),
      open: async (id) => {
        openProject(store.project(id));
        store.save();
      },
      remove: async (id) => removeProject(store.project(id)),
      favicon: async (id) => favicon(folder(id)),
    },
    connections: {
      list: async () => store.state.connections,
      save: async (input) => saveConnection(input),
      remove: async (id) => removeConnection(id),
      check: async (input) => checkConnection(input),
      chooseIdentity: async () => (await options.chooseIdentity()) ?? null,
      browse: async (id, path) => browse(id, path),
    },
    panes: {
      add: async (type, other) => {
        const pane = addPane(type, undefined, other);
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
      rename: async (id, title) => {
        const pane = store.pane(id);
        pane.title = title;
        store.save();
        // Agent panes keep their title in the view, which follows title events.
        if (isAssistantPane(pane))
          emitAssistantEvent({ paneId: id, type: 'title', title });
      },
    },
    assistant: {
      send,
      cancel: async (paneId) => assistantFor(paneId).cancel(paneId),
      respond: async (input) => assistantFor(input.paneId).respond(input),
      snapshot: async (paneId) => assistantFor(paneId).snapshot(paneId),
      models: async (provider) => assistants[provider].models(),
      skills: async (paneId) => assistantFor(paneId).skills(paneId),
      pickAttachment: async (paneId) =>
        assistantFor(paneId).pickAttachment(paneId),
      attachFile: async (paneId, path) =>
        assistantFor(paneId).attachFile(paneId, path),
      attachImage: async (paneId, name, data) =>
        assistantFor(paneId).attachImage(paneId, name, data),
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
    scripts: {
      list: async (projectId) => scripts.list(projectId),
      detect: async (projectId) => scripts.detect(projectId),
      save: async (projectId, input) => scripts.save(projectId, input),
      remove: async (projectId, scriptId) =>
        scripts.remove(projectId, scriptId),
      run: async (projectId, scriptId) => scripts.run(projectId, scriptId),
      stop: async (projectId, scriptId) => scripts.stop(projectId, scriptId),
      runs: async (projectId) => scripts.activeRuns(projectId),
    },
    terminal: {
      create: async (input) => terminals.create(input),
      write: async (id, data) => terminals.write(id, data),
      resize: async (id, cols, rows) => terminals.resize(id, cols, rows),
      snapshot: async (id) => terminals.snapshot(id),
    },
    git: {
      status: async (projectId) => git.status(folder(projectId)),
      head: async (projectId) => git.head(folder(projectId)),
      localBranches: async (projectId) => git.localBranches(folder(projectId)),
      branches: async (projectId) => git.branches(folder(projectId)),
      diff: async (projectId, path) => {
        const root = folder(projectId);
        if (path.includes('\0') || path.split(/[\\/]/).includes('..'))
          throw Error('Invalid path');
        const change = (await git.status(root)).changes.find(
          (item) => item.path === path,
        );
        if (!change) throw Error('File is not a current change');
        if (change.index === '?') return git.diffUntracked(root, path);
        return git.diff(root, path);
      },
      checkout: async (projectId, branch) => {
        const project = store.project(projectId);
        requireIdle(project);
        await git.switchBranch(placeOf(project), branch);
      },
      createBranch: async (projectId, name, base) =>
        createBranch(store.project(projectId), name, base),
      pull: async (projectId) => {
        const project = store.project(projectId);
        requireIdle(project);
        await git.pull(placeOf(project));
      },
    },
    filesystem: {
      list: async (projectId, path) => files.list(folder(projectId), path),
      readFile: async (projectId, path) => files.read(folder(projectId), path),
      search: async (projectId, query) =>
        files.search(folder(projectId), query),
      watch: async (projectId) =>
        files.watch(projectId, folder(projectId), (event) =>
          options.send(events.fileChange, event),
        ),
      unwatch: async (projectId) => {
        store.project(projectId);
        await files.unwatch(projectId);
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
