import type { MessagePortMain } from 'electron';
import {
  events,
  type AssistantEvent,
  type Backend,
  type GithubSignInEnd,
  type Pane,
  type Project,
  type Preferences,
} from '../../../shared/contracts';
import { errorMessage, resolvePreferences } from '../../../shared/domain';
import type { AssistantHost } from '../assistant';
import { removeStalePastes, shrinkPreviews } from '../attachments';
import { Dictation } from '../dictation';
import { favicon } from '../favicon';
import { Filesystem } from '../filesystem';
import * as git from '../git';
import { GitHub } from '../github';
import { KeepAwake, type Power } from '../keep-awake';
import { Machines } from '../machines';
import { MergeWatcher } from '../merge-watcher';
import { TurnNotifier, type Notice } from '../notifier';
import { Store, stateForWindow } from '../persistence';
import { sendable } from '../state';
import { Scripts } from '../scripts';
import { Terminals } from '../terminal';
import { TokenUsage } from '../token-usage';
import { agentService } from './agents';
import { connectionService } from './connections';
import { paneService } from './panes';
import { projectService } from './projects';
import { pullRequestService } from './pull-requests';
import { repositoryService } from './repository';

export type ServiceOptions = Pick<AssistantHost, 'chooseImage' | 'openUrl'> & {
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
  /** Whether the window can be seen; work nobody would see waits until it can. */
  inView?: () => boolean;
  /** Writes a line to the app's log file. */
  log?: (message: string) => void;
  /** The native dictation helper, where it was built. */
  dictation?: { program: string; disclaim: boolean };
  /** Opens a channel between the window and the terminal host, as `connectTerminals` takes. */
  openTerminalChannel: () => void;
  /** The bundled entry files of the processes work is moved out to. */
  hosts: { terminals: string; agents: string };
};

/**
 * The backend: the state, and the services that work on it, wired to the window's API.
 * Each service owns one area (projects, panes, connections, pull requests, agents, the
 * repository) and changes the state only through the Store.
 */
export function services(options: ServiceOptions) {
  const store = new Store(options.dataDirectory);
  /** Settles once old full-size image previews are shrunk; the window waits, so it never loads them. */
  const previewsShrunk = shrinkLegacyPreviews(store).catch((cause) =>
    console.warn(`Could not shrink image previews: ${errorMessage(cause)}`),
  );
  void removeStalePastes();
  const files = new Filesystem();
  const tokenUsage = new TokenUsage();
  const github = new GitHub();
  const machines = new Machines(() => store.state.connections);
  const toWindow = (event: AssistantEvent) =>
    options.send(events.assistantEvent, event);

  const repository = repositoryService({
    store,
    machines,
    busy: (project) =>
      panes.openPanesOf(project).some((pane) => agents.isRunning(pane.id)),
  });
  const terminals = new Terminals({
    store,
    machine: (projectId) => repository.machineOf(store.project(projectId)),
    modulePath: options.hosts.terminals,
    exited: (event) => scripts.handle(event),
    toWindow: (event) => options.send(events.terminalData, event),
    connectWindow: options.openTerminalChannel,
    log: options.log,
  });
  const dictation = new Dictation({
    program: options.dictation?.program,
    disclaim: options.dictation?.disclaim ?? false,
    emit: (event) => options.send(events.dictationEvent, event),
    log: options.log,
  });
  const notifier = new TurnNotifier(store, options.notify);
  const keepAwake = new KeepAwake(
    () => store.preferences.caffeinate,
    options.power,
  );
  const emitAssistantEvent = (event: AssistantEvent) => {
    toWindow(event);
    notifier.handle(event);
    keepAwake.handle(event);
  };
  const agents = agentService({
    store,
    machines,
    repository,
    chooseImage: options.chooseImage,
    openUrl: options.openUrl,
    emit: emitAssistantEvent,
    log: options.log ?? console.info,
    modulePath: options.hosts.agents,
  });
  const panes = paneService({
    store,
    agents,
    terminals,
    scripts: () => scripts,
    emit: emitAssistantEvent,
  });
  const scripts: Scripts = new Scripts({
    store,
    terminals,
    machine: repository.machineOf,
    addPane: (project) => panes.add('terminal', project),
    archivePane: panes.archive,
    emit: (run) => options.send(events.scriptRun, run),
  });
  const projects = projectService({
    store,
    machines,
    files,
    terminals,
    panes,
  });
  const connections = connectionService({ store, machines });
  const pullRequests = pullRequestService({
    store,
    github,
    repository,
    panes,
    agents,
    toWindow,
  });

  const mergeWatcher = new MergeWatcher({
    store,
    github,
    isBusy: agents.isRunning,
    place: repository.folder,
    inView: options.inView,
    archive: (paneIds) => {
      const closed = paneIds.filter((id) => !store.pane(id).archived);
      for (const id of closed) panes.archive(store.pane(id));
      options.send(events.panesClosed, { paneIds: closed, reason: 'merged' });
    },
  });
  mergeWatcher.start();

  function updatePreferences(patch: Partial<Preferences>) {
    const stored = { ...store.state.preferences, ...patch };
    const { providers } = resolvePreferences(stored);
    if (!providers.claude && !providers.codex)
      throw Error('Keep at least one provider turned on.');
    store.settings.setPreferences(stored);
    keepAwake.update();
    void mergeWatcher.check();
    return store.preferences;
  }

  const { folder } = repository;
  const { call, forPane, closed } = agents;

  const api: Backend = {
    state: {
      get: async () => {
        await previewsShrunk;
        return stateForWindow(store.state);
      },
    },
    preferences: {
      get: async () => store.preferences,
      update: async (patch) => updatePreferences(patch),
    },
    providers: {
      account: (provider) => call('account', provider),
      connect: (provider, machineId) => call('connect', provider, machineId),
      submitSignInCode: (provider, code) =>
        call('submitSignInCode', provider, code),
      awaitSignIn: (provider) => call('awaitSignIn', provider),
      cancelConnect: async (provider) => call('cancelConnect', provider),
      outputStyles: () => call('outputStyles'),
      cliVersions: async () => agents.cliVersions(),
      updateCli: async (provider, machineId) =>
        agents.updateCli(provider, machineId),
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
      pullRequestDraft: async (projectId) => pullRequests.draft(projectId),
      createPullRequest: async (projectId, input) =>
        pullRequests.create(projectId, input),
      runAction: async (projectId, action) =>
        pullRequests.runAction(projectId, action),
      mergePullRequest: async (projectId) =>
        github.mergePullRequest(folder(projectId)),
      openPullRequest: async (projectId) =>
        pullRequests.open(projectId, options.openUrl),
      activity: async (projectId) => github.activity(folder(projectId)),
      openActivity: async (url) => {
        if (new URL(url).origin !== 'https://github.com')
          throw Error('Only GitHub links can be opened.');
        await options.openUrl(url);
      },
    },
    projects: {
      chooseFolder: async () => (await options.chooseDirectory()) ?? null,
      create: async (input) => sendable<Project>(await projects.create(input)),
      clone: async (input) => sendable<Project>(await projects.clone(input)),
      cloneFolder: async () => projects.cloneFolder(),
      open: async (id) => projects.open(id),
      remove: async (id) => projects.remove(id),
      favicon: async (id) => favicon(folder(id)),
    },
    connections: {
      list: async () => connections.list(),
      save: async (input) => connections.save(input),
      remove: async (id) => connections.remove(id),
      check: async (input) => connections.check(input),
      chooseIdentity: async () => (await options.chooseIdentity()) ?? null,
      browse: async (id, path) => connections.browse(id, path),
    },
    panes: {
      add: async (type, other) =>
        sendable<Pane>(panes.add(type, undefined, other)),
      fork: async (paneId, messageId, provider) => {
        const { pane, attachment } = await panes.fork(
          paneId,
          messageId,
          provider,
        );
        return { pane: sendable<Pane>(pane), attachment };
      },
      archive: async (id) => panes.archive(store.pane(id)),
      reorder: async (ids) => panes.reorder(ids),
      rename: async (id, title) => panes.rename(id, title),
    },
    assistant: {
      send: agents.send,
      // A closed pane's turn was stopped as it closed, and its requests went with it.
      cancel: async (paneId) => {
        if (!closed(paneId)) await call('cancel', paneId);
      },
      respond: async (input) =>
        closed(input.paneId) ? undefined : call('respond', input),
      snapshot: async (paneId) => {
        await previewsShrunk;
        return agents.snapshot(paneId);
      },
      models: (provider) => call('models', provider),
      skills: async (paneId) => (closed(paneId) ? [] : call('skills', paneId)),
      pickAttachment: async (paneId) => call('pickAttachment', forPane(paneId)),
      attachFile: async (paneId, path) =>
        call('attachFile', forPane(paneId), path),
      attachImage: async (paneId, name, data) =>
        call('attachImage', forPane(paneId), name, data),
      attachText: async (paneId, text) =>
        call('attachText', forPane(paneId), text),
      sendQueued: async (paneId, queuedId) =>
        call('sendQueued', forPane(paneId), queuedId),
      unqueue: async (paneId, queuedId) =>
        call('unqueue', forPane(paneId), queuedId),
    },
    tokens: { get: async (range) => tokenUsage.stats(range) },
    limits: { get: (provider) => call('limits', provider) },
    navigation: { help: options.openHelp },
    app: {
      isFullscreen: async () => options.isFullscreen(),
      copyText: async (text) => options.copyText(text),
    },
    dictation: {
      available: async () => dictation.available(),
      start: async (language) => dictation.start(language),
      stop: async (session) => dictation.stop(session),
    },
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
      snapshot: async (id) => terminals.snapshot(id),
    },
    git: {
      status: (projectId) => repository.status(projectId),
      head: async (projectId) => git.head(folder(projectId)),
      localBranches: async (projectId) => git.localBranches(folder(projectId)),
      branches: async (projectId) => git.branches(folder(projectId)),
      diff: async (projectId, path) => repository.diff(projectId, path),
      discard: async (projectId, path) => repository.discard(projectId, path),
      changesAmong: async (projectId, paths) =>
        repository.changesAmong(projectId, paths),
      checkout: async (projectId, branch) =>
        repository.checkout(projectId, branch),
      createBranch: async (projectId, name, base) =>
        repository.createBranch(projectId, name, base),
      pull: async (projectId) => repository.pull(projectId),
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
    /** For the smoke test, which types into terminals as the window would. */
    terminals,
    cameIntoView: () => mergeWatcher.catchUp(),
    /** Gives the window its own channel to the terminals, for output and typing. */
    connectTerminals: (port: MessagePortMain) => terminals.attachWindow(port),
    /** Whether the terminal host runs, which it does once a terminal is asked for. */
    terminalsRunning: () => terminals.running,
    close: async () => {
      notifier.close();
      keepAwake.close();
      dictation.close();
      mergeWatcher.close();
      github.close();
      // The agents' last updates reach the Store before it is flushed.
      await Promise.all([agents.close(), terminals.close()]);
      // A save still being written in the background lands before the state is flushed.
      await store.settled();
      store.flush();
      await files.close();
    },
  };
}

/** Shrinks image previews older versions saved whole; each pane affected is rewritten once. */
async function shrinkLegacyPreviews(store: Store) {
  for (const pane of store.state.panes) {
    const shrunk = await shrinkPreviews(pane.messages);
    // Replaced, not edited: saving reuses a finished message's JSON while it is the same object.
    for (const message of shrunk) store.panes.putMessage(pane, message);
    if (shrunk.length) store.save(pane);
  }
}
