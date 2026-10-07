import { readFile } from 'node:fs/promises';
import {
  assistantProvider,
  type AssistantEvent,
  type AssistantProvider,
  type AssistantSendInput,
  type Pane,
} from '../../../shared/contracts';
import {
  PROVIDER_LABELS,
  errorMessage,
  isAssistantPane,
  isDefaultTitle,
  promptText,
  titleFrom,
  withoutMarkers,
} from '../../../shared/domain';
import {
  AgentClient,
  type AgentHostHandle,
  type AgentHostSetup,
} from '../agent-client';
import type { AgentMethods, MainMethods } from '../agent-worker';
import type { ChooseImage } from '../assistant';
import { imagePreview, toolImagePreview } from '../attachments';
import { claudeExecutable } from '../claude';
import { CliVersions, type CliTarget } from '../cli-version';
import { codexProgram } from '../codex-rpc';
import { HostProcess } from '../host-process';
import * as git from '../git';
import { localMachine, type Machines } from '../machines';
import type { Store } from '../persistence';
import { cleanTitle, titlePrompt } from '../titles';
import type { Repository } from './repository';
import type { PaneView } from '../state';

type AgentOptions = {
  store: Store;
  machines: Machines;
  repository: Repository;
  chooseImage: ChooseImage;
  openUrl: (url: string) => Promise<void>;
  /** Sends an event to the window and whatever else follows turns. */
  emit: (event: AssistantEvent) => void;
  log: (message: string) => void;
  /** The bundled agent host. */
  modulePath: string;
  /** Starts the agent host; a utility process unless a test runs one of its own. */
  connect?: (setup: AgentHostSetup) => AgentHostHandle;
};

/**
 * The agents: starting their turns, naming conversations, and their CLIs on each machine.
 * The assistants themselves run in the agent host; this is main's side of them.
 */
export function agentService({
  store,
  machines,
  repository,
  chooseImage,
  openUrl,
  emit,
  log,
  modulePath,
  connect = (setup) =>
    new HostProcess<AgentMethods>({
      name: 'Bonfire Agents',
      modulePath,
      log,
      ...setup,
    }),
}: AgentOptions) {
  const handlers: MainMethods = {
    chooseImage,
    openUrl,
    imagePreview: (data, mimeType) => imagePreview(Buffer.from(data), mimeType),
    toolImagePreview,
    imagePreviewOf: async (path, mimeType) =>
      imagePreview(await readFile(path), mimeType, path),
  };
  const client = new AgentClient(store, emit, handlers, connect);
  const cliVersions = new CliVersions(log);

  const providerOf = (pane: PaneView): AssistantProvider => {
    if (!isAssistantPane(pane)) throw Error('This pane has no assistant');
    return pane.type;
  };
  /** Whether the pane's agent is mid-turn; never for a pane without one. */
  const isRunning = (paneId: string) => client.isRunning(paneId);

  function requireEnabled(provider: AssistantProvider) {
    if (!store.preferences.providers[provider])
      throw Error(`${PROVIDER_LABELS[provider]} is turned off in Settings.`);
  }

  /** Generates a short text with the model chosen for titles and summaries. */
  function generateText(prompt: string) {
    const { provider, model } = store.preferences.textModel;
    requireEnabled(provider);
    return client.call('generate', provider, prompt, model);
  }

  /**
   * Where a provider's CLI runs on a machine. This computer runs the app's bundled copy when
   * it ships one, and the installed CLI otherwise; another machine runs its own.
   */
  const cliTarget = (
    provider: AssistantProvider,
    machineId: string,
  ): CliTarget => {
    const machine = machines.get(
      machineId === localMachine.id ? undefined : machineId,
    );
    const name = machine.remote
      ? (store.state.connections.find(({ id }) => id === machineId)?.name ??
        machineId)
      : 'This computer';
    if (provider === 'claude')
      return {
        provider,
        machine,
        name,
        file: machine.remote ? 'claude' : claudeExecutable(),
        args: [],
      };
    const { file, args, env } = codexProgram(machine);
    return {
      provider,
      machine,
      name,
      file,
      args,
      ...(env?.ELECTRON_RUN_AS_NODE && { env: { ELECTRON_RUN_AS_NODE: '1' } }),
    };
  };

  /** Each enabled provider's, on this computer and on the open project's machine if another. */
  const checkCliVersions = () => {
    const ids = new Set([localMachine.id]);
    const open = store.state.projects.find(
      ({ id }) => id === store.state.lastProjectId,
    );
    if (open?.connectionId) ids.add(open.connectionId);
    const providers = assistantProvider.options.filter(
      (provider) => store.preferences.providers[provider],
    );
    return Promise.all(
      providers.flatMap((provider) =>
        [...ids].map((id) => cliVersions.check(cliTarget(provider, id))),
      ),
    );
  };
  // Logged at startup, so bonfire.log says which CLIs ran when something goes wrong.
  for (const provider of assistantProvider.options)
    void cliVersions.check(cliTarget(provider, localMachine.id));

  /** Notes the branch the conversation is about to work on, to spot its pull request merging. */
  async function recordBranch(pane: PaneView) {
    if (!pane.projectId) return;
    const name = await git.currentBranch(repository.folder(pane.projectId));
    if (!name) store.panes.update(pane, { workBranch: undefined });
    else if (pane.workBranch?.name !== name)
      store.panes.update(pane, { workBranch: { name, since: Date.now() } });
  }

  /** Replaces the placeholder title taken from the first message with a generated one. */
  async function nameConversation(pane: PaneView, text: string) {
    const { provider, model } = store.preferences.textModel;
    if (!store.preferences.providers[provider]) return;
    const placeholder = titleFrom(text);
    try {
      const title = cleanTitle(
        await client.call('generate', provider, titlePrompt(text), model),
      );
      // The send may have failed before starting, or the pane may be gone.
      if (!title || pane.archived || pane.title !== placeholder) return;
      store.panes.update(pane, { title });
      emit({ paneId: pane.id, type: 'title', title });
    } catch (cause) {
      // The placeholder is a fine title, so a failure is only worth a log line.
      console.warn(`Could not name a conversation: ${errorMessage(cause)}`);
    }
  }

  async function send(input: AssistantSendInput) {
    const pane = store.pane(input.paneId);
    const provider = providerOf(pane);
    if (client.isRunning(pane.id)) return client.send(input);
    requireEnabled(provider);
    const naming = !pane.messages.length && isDefaultTitle(pane.title);
    await recordBranch(pane);
    const turn = client.send(input);
    if (naming)
      void nameConversation(
        pane,
        withoutMarkers(promptText(input.text, input.skills)),
      );
    return turn;
  }

  /**
   * The pane's id once it is checked to have an agent and to be open: the host knows only
   * open panes, and a closed one has nothing left to attach to or send.
   */
  const forPane = (paneId: string) => {
    const pane = store.pane(paneId);
    providerOf(pane);
    if (pane.archived) throw Error('This conversation is closed.');
    return paneId;
  };
  /** Whether the pane is closed, so a call about its turn has nothing left to act on. */
  const closed = (paneId: string) => {
    const pane = store.pane(paneId);
    providerOf(pane);
    return pane.archived;
  };

  return {
    /** Calls the agent host directly, for what main only passes on. */
    call: client.call.bind(client),
    forPane,
    closed,
    snapshot: (paneId: string) => {
      providerOf(store.pane(paneId));
      return client.snapshot(paneId);
    },
    isRunning,
    requireEnabled,
    generateText,
    send,
    cliVersions: checkCliVersions,
    updateCli: (provider: AssistantProvider, machineId: string) =>
      cliVersions.update(cliTarget(provider, machineId)),
    /** Stops the pane's agent for good, if it has one. */
    discard: (pane: PaneView) => {
      if (isAssistantPane(pane)) client.discard(pane.id);
    },
    close: () => client.close(),
  };
}

export type Agents = ReturnType<typeof agentService>;
