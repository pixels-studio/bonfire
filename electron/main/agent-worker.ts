import type {
  AssistantEvent,
  AssistantProvider,
  AssistantSnapshot,
} from '../../shared/contracts';
import { isAssistantPane } from '../../shared/domain';
import type {
  AgentStore,
  AssistantHost,
  ChatAssistant,
  ChooseImage,
} from './assistant';
import { AgentMirror, type AgentChange, type AgentState } from './agent-store';
import { PendingAttachments } from './attachments';
import { ClaudeAssistant } from './claude';
import { CodexAssistant } from './codex';
import { localMachine, Machines } from './machines';
import { Rpc, type Endpoint } from './rpc';

/** What the agent host asks of main: the dialogs and image tools only it has. */
export type MainMethods = {
  chooseImage: ChooseImage;
  openUrl(url: string): Promise<void>;
  /** A preview of image data with no file, as a pasted screenshot until it is written. */
  imagePreview(data: Uint8Array, mimeType: string): Promise<string | undefined>;
  /** A preview of an image file, which main reads itself rather than be sent its bytes. */
  imagePreviewOf(path: string, mimeType: string): Promise<string | undefined>;
};

export type Assistants = Record<
  AssistantProvider,
  ChatAssistant & Partial<Pick<ClaudeAssistant, 'outputStyles'>>
>;

/** The providers' assistants, as the app runs them. */
export function providerAssistants(
  store: AgentStore,
  emit: (event: AssistantEvent) => void,
  host: AssistantHost,
): Assistants {
  return {
    claude: new ClaudeAssistant(store, emit, host),
    codex: new CodexAssistant(store, emit, host),
  };
}

/**
 * The agent host's side: the assistants, run on a copy of the state main keeps current.
 * Streaming events go to main, which keeps the conversations, saves them, and passes the
 * events on to the window; changes the assistants make go to main for the Store.
 */
export function startAgentWorker(
  endpoint: Endpoint,
  makeAssistants = providerAssistants,
) {
  let main!: Rpc<MainMethods>;
  const mirror = new AgentMirror((change: AgentChange) =>
    main.emit('change', change),
  );
  const machines = new Machines(() => mirror.connections);
  const assistants = makeAssistants(
    mirror,
    (event) => main.emit('event', event),
    {
      chooseImage: () => main.call('chooseImage'),
      openUrl: (url) => main.call('openUrl', url),
      attachments: new PendingAttachments((data, mimeType, path) =>
        path
          ? main.call('imagePreviewOf', path, mimeType)
          : main.call('imagePreview', data, mimeType),
      ),
      machineOf: (project) => machines.get(project.connectionId),
    },
  );
  const assistantFor = (paneId: string) => {
    const pane = mirror.pane(paneId);
    if (!isAssistantPane(pane)) throw Error('This pane has no assistant');
    return assistants[pane.type];
  };

  const methods = {
    sync: (state: AgentState, applied: number) => mirror.sync(state, applied),
    confirm: (applied: number) => mirror.confirm(applied),
    send: (input) => assistantFor(input.paneId).send(input),
    cancel: (paneId) => assistantFor(paneId).cancel(paneId),
    respond: (input) => assistantFor(input.paneId).respond(input),
    /** What only the host knows of a pane; main has its messages. */
    snapshot: (paneId): Omit<AssistantSnapshot, 'messages' | 'usage'> => {
      const { running, requests, queue } =
        assistantFor(paneId).snapshot(paneId);
      return { running, requests, queue };
    },
    models: (provider) => assistants[provider].models(),
    skills: (paneId) => assistantFor(paneId).skills(paneId),
    pickAttachment: (paneId) => assistantFor(paneId).pickAttachment(paneId),
    attachFile: (paneId, path) => assistantFor(paneId).attachFile(paneId, path),
    attachImage: (paneId, name, data) =>
      assistantFor(paneId).attachImage(paneId, name, data),
    attachText: (paneId, text, name) =>
      assistantFor(paneId).attachText(paneId, text, name),
    sendQueued: (paneId, queuedId) =>
      assistantFor(paneId).sendQueued(paneId, queuedId),
    unqueue: (paneId, queuedId) =>
      assistantFor(paneId).unqueue(paneId, queuedId),
    discard: (paneId) => assistantFor(paneId).discard(paneId),
    account: (provider) => assistants[provider].account(),
    connect: (provider, machineId) =>
      assistants[provider].connect(
        machines.get(
          !machineId || machineId === localMachine.id ? undefined : machineId,
        ),
      ),
    submitSignInCode: (provider, code) =>
      assistants[provider].submitSignInCode(code),
    awaitSignIn: (provider) => assistants[provider].awaitSignIn(),
    cancelConnect: (provider) => assistants[provider].cancelConnect(),
    outputStyles: () => assistants.claude.outputStyles?.() ?? [],
    limits: (provider) => assistants[provider].limits(),
    generate: (provider, prompt, model) =>
      assistants[provider].generate(prompt, model),
    close: () => {
      for (const assistant of Object.values(assistants)) assistant.close();
    },
  } satisfies AgentMethodsOf<ChatAssistant>;
  main = new Rpc<MainMethods>(endpoint, methods);
  return { main, mirror, assistants };
}

type Method<Name extends keyof ChatAssistant> = ChatAssistant[Name] extends (
  ...args: infer Args
) => infer Result
  ? (...args: Args) => Result
  : never;

/** The calls main makes of the agent host, typed after the assistants that answer them. */
type AgentMethodsOf<Assistant extends ChatAssistant> = {
  sync(state: AgentState, applied: number): void;
  confirm(applied: number): void;
  send: Method<'send'>;
  cancel: Method<'cancel'>;
  respond: Method<'respond'>;
  snapshot(paneId: string): Omit<AssistantSnapshot, 'messages' | 'usage'>;
  models(provider: AssistantProvider): ReturnType<Assistant['models']>;
  skills: Method<'skills'>;
  pickAttachment: Method<'pickAttachment'>;
  attachFile: Method<'attachFile'>;
  attachImage: Method<'attachImage'>;
  attachText: Method<'attachText'>;
  sendQueued: Method<'sendQueued'>;
  unqueue: Method<'unqueue'>;
  discard: Method<'discard'>;
  account(provider: AssistantProvider): ReturnType<Assistant['account']>;
  connect(
    provider: AssistantProvider,
    machineId?: string,
  ): ReturnType<Assistant['connect']>;
  submitSignInCode(
    provider: AssistantProvider,
    code: string,
  ): ReturnType<Assistant['submitSignInCode']>;
  awaitSignIn(
    provider: AssistantProvider,
  ): ReturnType<Assistant['awaitSignIn']>;
  cancelConnect(provider: AssistantProvider): void;
  outputStyles(): Promise<string[]> | string[];
  limits(provider: AssistantProvider): ReturnType<Assistant['limits']>;
  generate(
    provider: AssistantProvider,
    prompt: string,
    model: string,
  ): Promise<string>;
  close(): void;
};

export type AgentMethods = AgentMethodsOf<ChatAssistant>;
