import type {
  AssistantEvent,
  ModelOption,
  Pane,
  ProviderAccount,
  ProviderLimits,
  Skill,
  State,
} from '../shared/contracts';
import { DEFAULT_PREFERENCES } from '../shared/domain';
import {
  ChatAssistant,
  type AssistantHost,
  type Turn,
} from '../electron/main/assistant';
import type { Store } from '../electron/main/persistence';
import { PaneChanges, SettingChanges } from '../electron/main/state';
import type { Endpoint } from '../electron/main/rpc';

export function fakeStore(type: 'claude' | 'codex') {
  const pane: Pane = {
    id: 'pane',
    projectId: 'project',
    workspaceId: 'workspace',
    type,
    title: 'Test',
    messages: [],
    model: '',
    reasoningEffort: 'medium',
    fastMode: false,
    approvals: 'auto',
    archived: false,
  };
  const project = {
    id: 'project',
    name: 'Test',
    path: process.cwd(),
    createdAt: 0,
    lastOpenedAt: 0,
  };
  const workspace = {
    id: 'workspace',
    projectId: 'project',
    name: 'main',
    path: project.path,
    main: true,
    status: 'in_progress',
    createdAt: 0,
  };
  const state = {
    panes: [pane],
    layout: { paneIds: [pane.id] },
    settings: {},
  } as unknown as State;
  const save = () => {};
  const store = {
    state,
    preferences: { ...DEFAULT_PREFERENCES },
    panes: new PaneChanges(() => state, save),
    settings: new SettingChanges(() => state, save),
    save,
    flush() {},
    pane: () => pane,
    project: () => project,
    workspace: () => workspace,
  } as unknown as Store;
  return { pane, store };
}

export function sendInput(text = 'hi') {
  return {
    paneId: 'pane',
    text,
    attachmentIds: [],
    skills: [] as string[],
    model: '',
    reasoningEffort: 'medium' as const,
    fastMode: false,
    approvals: 'auto' as const,
  };
}

export const host: AssistantHost = {
  chooseImage: async () => undefined,
  openUrl: async () => {},
};

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Runs `script` as the body of each turn of a provider-less assistant. */
export class ScriptedAssistant extends ChatAssistant {
  protected readonly provider = 'claude';
  script: (assistant: ScriptedAssistant, turn: Turn) => Promise<void> =
    async () => {};

  protected run(turn: Turn) {
    return this.script(this, turn);
  }
  protected async listModels(): Promise<ModelOption[]> {
    return [
      { value: 'a', label: 'A', supportsFast: true },
      { value: 'b', label: 'B', supportsFast: false },
    ];
  }
  skillList: Skill[] = [{ name: 'review', description: 'Reviews the diff' }];
  protected async listSkills(): Promise<Skill[]> {
    return this.skillList;
  }
  protected async readLimits(): Promise<ProviderLimits> {
    return { provider: 'claude', windows: [] };
  }
  protected async readAccount(): Promise<ProviderAccount> {
    return { provider: 'claude', signedIn: true };
  }
  protected async signIn() {}
  protected async complete(prompt: string) {
    return prompt;
  }
  // Exposes the protected helpers a provider would use.
  tools = {
    publish: this.publish.bind(this),
    append: this.append.bind(this),
    publishError: this.publishError.bind(this),
    publishUsage: this.publishUsage.bind(this),
    ask: this.ask.bind(this),
  };
}

export function scripted(type: 'claude' | 'codex' = 'claude') {
  const { pane, store } = fakeStore(type);
  const events: AssistantEvent[] = [];
  const assistant = new ScriptedAssistant(
    store,
    (event) => events.push(event),
    host,
  );
  return { assistant, pane, events };
}

/** Two ends of a channel that, like a MessagePort, deliver in order and never synchronously. */
export function pair(): [Endpoint, Endpoint] {
  const receivers: ((message: unknown) => void)[][] = [[], []];
  const end = (self: number): Endpoint => ({
    post: (message) => {
      const copy = structuredClone(message);
      setImmediate(() =>
        receivers[1 - self].forEach((receive) => receive(copy)),
      );
    },
    listen: (receive) => receivers[self].push(receive),
  });
  return [end(0), end(1)];
}
