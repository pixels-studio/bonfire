import type {
  AssistantEvent,
  ModelOption,
  Pane,
  ProviderAccount,
  ProviderLimits,
} from '../shared/contracts';
import { DEFAULT_PREFERENCES } from '../shared/domain';
import {
  ChatAssistant,
  type AssistantHost,
  type Turn,
} from '../electron/main/assistant';
import type { Store } from '../electron/main/persistence';

export function fakeStore(type: 'claude' | 'codex') {
  const pane: Pane = {
    id: 'pane',
    projectId: 'project',
    type,
    title: 'Test',
    messages: [],
    model: '',
    reasoningEffort: 'medium',
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
  const store = {
    state: { settings: {} },
    preferences: { ...DEFAULT_PREFERENCES },
    save() {},
    flush() {},
    pane: () => pane,
    project: () => project,
  } as unknown as Store;
  return { pane, store };
}

export function sendInput(text = 'hi') {
  return {
    paneId: 'pane',
    text,
    attachmentIds: [],
    model: '',
    reasoningEffort: 'medium' as const,
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
    return [{ value: 'a', label: 'A' }];
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
