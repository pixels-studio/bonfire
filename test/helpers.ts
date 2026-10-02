import type { AssistantEvent, ModelOption, Pane } from '../shared/contracts';
import { ChatAssistant, type Turn } from '../electron/main/assistant';
import type { Store } from '../electron/main/persistence';

export function fakeStore(type: 'claude' | 'codex') {
  const pane: Pane = {
    id: 'pane',
    sessionId: 'session',
    type,
    title: 'Test',
    messages: [],
    model: '',
    reasoningEffort: 'medium',
    archived: false,
  };
  const session = {
    id: 'session',
    projectId: 'project',
    title: 'Test',
    worktreePath: process.cwd(),
    createdAt: 0,
    lastOpenedAt: 0,
  };
  const store = {
    state: { settings: {} },
    save() {},
    flush() {},
    pane: () => pane,
    session: () => session,
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
  };
}

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
    async () => undefined,
  );
  return { assistant, pane, events };
}
