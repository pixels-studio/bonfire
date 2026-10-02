import { randomUUID } from 'node:crypto';
import type { Codex, Input, ThreadEvent, ThreadItem } from '@openai/codex-sdk';
import type {
  AssistantEvent,
  ConversationMessage,
  Usage,
} from '../../shared/contracts';
import type { Store } from './persistence';
import { readAttachment } from './attachments';

type SendInput = {
  paneId: string;
  text: string;
  attachmentIds: string[];
  model: string;
  reasoningEffort: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
};

export class Assistant {
  private codex?: Codex;
  private readonly turns = new Map<string, AbortController>();
  private readonly attachments = new Map<
    string,
    {
      paneId: string;
      name: string;
      path: string;
      size: number;
      previewUrl: string;
    }
  >();

  constructor(
    private readonly store: Store,
    private readonly emit: (event: AssistantEvent) => void,
    private readonly chooseAttachment: () => Promise<
      { name: string; path: string } | undefined
    >,
  ) {}

  async pickAttachment(paneId: string) {
    const pane = this.store.pane(paneId);
    if (pane.type !== 'codex')
      throw Error('This pane is not a Codex assistant');
    const file = await this.chooseAttachment();
    if (!file) return null;
    const { size, previewUrl } = await readAttachment(file.path);
    const attachment = { id: randomUUID(), name: file.name, size, previewUrl };
    this.attachments.set(attachment.id, { paneId, ...file, size, previewUrl });
    return attachment;
  }

  private async client() {
    if (!this.codex) {
      const { Codex } = await import('@openai/codex-sdk');
      this.codex = new Codex();
    }
    return this.codex;
  }

  async send(input: SendInput) {
    const pane = this.store.pane(input.paneId);
    if (pane.type !== 'codex')
      throw Error('This pane is not a Codex assistant');
    if (this.turns.has(pane.id)) throw Error('Codex is already responding');

    const text = input.text.trim();
    const attachments = input.attachmentIds.map((id) => {
      const attachment = this.attachments.get(id);
      if (!attachment || attachment.paneId !== pane.id)
        throw Error('Attachment is no longer available');
      return { id, ...attachment };
    });
    for (const attachment of attachments) {
      const message: ConversationMessage = {
        id: attachment.id,
        role: 'user',
        kind: 'attachment',
        text: attachment.name,
        status: 'complete',
        size: attachment.size,
        previewUrl: attachment.previewUrl,
      };
      pane.messages.push(message);
      this.emit({ paneId: pane.id, type: 'message', message });
    }
    const userMessage: ConversationMessage = {
      id: randomUUID(),
      role: 'user',
      kind: 'text',
      text,
      status: 'complete',
    };
    pane.messages.push(userMessage);
    pane.model = input.model;
    pane.reasoningEffort = input.reasoningEffort;
    if (pane.title === 'Codex' || pane.title === 'New Conversation')
      pane.title = titleFrom(text);
    this.store.save();
    this.emit({ paneId: pane.id, type: 'message', message: userMessage });

    const controller = new AbortController();
    this.turns.set(pane.id, controller);
    this.emit({ paneId: pane.id, type: 'status', status: 'running' });

    try {
      const session = this.store.session(pane.sessionId);
      const options = {
        workingDirectory: session.worktreePath,
        sandboxMode: 'workspace-write' as const,
        approvalPolicy: 'never' as const,
        model: input.model || undefined,
        modelReasoningEffort: input.reasoningEffort,
      };
      const codex = await this.client();
      const thread = pane.threadId
        ? codex.resumeThread(pane.threadId, options)
        : codex.startThread(options);
      const turnInput: Input = attachments.length
        ? [
            { type: 'text', text },
            ...attachments.map(({ path }) => ({
              type: 'local_image' as const,
              path,
            })),
          ]
        : text;

      const { events } = await thread.runStreamed(turnInput, {
        signal: controller.signal,
      });
      for await (const event of events) this.handle(pane.id, event);
    } catch (error) {
      if (!controller.signal.aborted) {
        const message = error instanceof Error ? error.message : String(error);
        const failure: ConversationMessage = {
          id: randomUUID(),
          role: 'assistant',
          kind: 'error',
          text: message,
          status: 'failed',
        };
        pane.messages.push(failure);
        this.store.save();
        this.emit({ paneId: pane.id, type: 'message', message: failure });
        this.emit({
          paneId: pane.id,
          type: 'status',
          status: 'failed',
          error: message,
        });
      }
    } finally {
      for (const attachment of attachments)
        this.attachments.delete(attachment.id);
      this.turns.delete(pane.id);
      this.emit({ paneId: pane.id, type: 'status', status: 'idle' });
    }
  }

  cancel(paneId: string) {
    this.store.pane(paneId);
    this.turns.get(paneId)?.abort();
  }

  close() {
    for (const controller of this.turns.values()) controller.abort();
    this.turns.clear();
  }

  private handle(paneId: string, event: ThreadEvent) {
    const pane = this.store.pane(paneId);
    if (event.type === 'thread.started') {
      pane.threadId = event.thread_id;
      this.store.save();
      return;
    }
    if (
      event.type === 'item.started' ||
      event.type === 'item.updated' ||
      event.type === 'item.completed'
    ) {
      const message = messageFrom(event.item, event.type === 'item.completed');
      const index = pane.messages.findIndex((item) => item.id === message.id);
      if (index === -1) pane.messages.push(message);
      else pane.messages[index] = message;
      if (event.type === 'item.completed') this.store.save();
      this.emit({ paneId, type: 'message', message });
      return;
    }
    if (event.type === 'turn.completed') {
      const usage: Usage = {
        inputTokens: event.usage.input_tokens,
        cachedInputTokens: event.usage.cached_input_tokens,
        outputTokens: event.usage.output_tokens,
        reasoningOutputTokens: event.usage.reasoning_output_tokens,
      };
      pane.usage = usage;
      this.store.save();
      this.emit({ paneId, type: 'usage', usage });
    }
    if (event.type === 'turn.failed' || event.type === 'error') {
      const text = event.type === 'error' ? event.message : event.error.message;
      const message: ConversationMessage = {
        id: randomUUID(),
        role: 'assistant',
        kind: 'error',
        text,
        status: 'failed',
      };
      pane.messages.push(message);
      this.store.save();
      this.emit({ paneId, type: 'message', message });
    }
  }
}

function titleFrom(text: string) {
  const compact = text.replace(/\s+/g, ' ').trim();
  return compact.length > 42 ? compact.slice(0, 41).trimEnd() + '…' : compact;
}

function messageFrom(item: ThreadItem, complete: boolean): ConversationMessage {
  const status = complete ? 'complete' : 'streaming';
  switch (item.type) {
    case 'agent_message':
      return {
        id: item.id,
        role: 'assistant',
        kind: 'text',
        text: item.text,
        status,
      };
    case 'reasoning':
      return {
        id: item.id,
        role: 'assistant',
        kind: 'thinking',
        text: item.text,
        status,
      };
    case 'command_execution':
      return {
        id: item.id,
        role: 'assistant',
        kind: 'tool',
        text: [item.command, item.aggregated_output].filter(Boolean).join('\n'),
        status: item.status === 'failed' ? 'failed' : status,
      };
    case 'file_change':
      return {
        id: item.id,
        role: 'assistant',
        kind: 'tool',
        text: item.changes
          .map((change) => `${change.kind} ${change.path}`)
          .join('\n'),
        status: item.status === 'failed' ? 'failed' : status,
      };
    case 'mcp_tool_call':
      return {
        id: item.id,
        role: 'assistant',
        kind: 'tool',
        text: `${item.server} · ${item.tool}`,
        status: item.status === 'failed' ? 'failed' : status,
      };
    case 'web_search':
      return {
        id: item.id,
        role: 'assistant',
        kind: 'tool',
        text: `Searched for ${item.query}`,
        status,
      };
    case 'todo_list':
      return {
        id: item.id,
        role: 'assistant',
        kind: 'tool',
        text: item.items
          .map((todo) => `${todo.completed ? '✓' : '○'} ${todo.text}`)
          .join('\n'),
        status,
      };
    case 'error':
      return {
        id: item.id,
        role: 'assistant',
        kind: 'error',
        text: item.message,
        status: 'failed',
      };
  }
}
