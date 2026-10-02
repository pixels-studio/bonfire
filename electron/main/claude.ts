import { randomUUID } from 'node:crypto';
import type {
  Options,
  Query,
  SDKMessage,
  SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
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

const thinkingFor = (
  effort: SendInput['reasoningEffort'],
): Options['thinking'] => {
  switch (effort) {
    case 'minimal':
      return { type: 'disabled' };
    case 'low':
      return { type: 'enabled', budgetTokens: 2048 };
    case 'high':
      return { type: 'enabled', budgetTokens: 16384 };
    case 'xhigh':
      return { type: 'adaptive' };
    default:
      return { type: 'enabled', budgetTokens: 8192 };
  }
};

export class ClaudeAssistant {
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
    if (pane.type !== 'claude')
      throw Error('This pane is not a Claude assistant');
    const file = await this.chooseAttachment();
    if (!file) return null;
    const { size, previewUrl } = await readAttachment(file.path);
    const attachment = { id: randomUUID(), name: file.name, size, previewUrl };
    this.attachments.set(attachment.id, { paneId, ...file, size, previewUrl });
    return attachment;
  }

  async send(input: SendInput) {
    const pane = this.store.pane(input.paneId);
    if (pane.type !== 'claude')
      throw Error('This pane is not a Claude assistant');
    if (this.turns.has(pane.id)) throw Error('Claude is already responding');

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
    if (pane.title === 'Claude' || pane.title === 'New Conversation')
      pane.title = titleFrom(text);
    this.store.save();
    this.emit({ paneId: pane.id, type: 'message', message: userMessage });

    const controller = new AbortController();
    this.turns.set(pane.id, controller);
    this.emit({ paneId: pane.id, type: 'status', status: 'running' });

    try {
      const session = this.store.session(pane.sessionId);
      const extendedContext = input.model === 'sonnet-1m';
      const options: Options = {
        cwd: session.worktreePath,
        resume: pane.threadId || undefined,
        model: extendedContext ? 'sonnet' : input.model || undefined,
        betas: extendedContext ? ['context-1m-2025-08-07'] : undefined,
        thinking: thinkingFor(input.reasoningEffort),
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        abortController: controller,
      };
      const { query } = await import('@anthropic-ai/claude-agent-sdk');
      const prompt = attachments.length
        ? (async function* (): AsyncIterable<SDKUserMessage> {
            const content: Array<
              | { type: 'text'; text: string }
              | {
                  type: 'image';
                  source: {
                    type: 'base64';
                    media_type: ReturnType<typeof mediaTypeFor>;
                    data: string;
                  };
                }
            > = [{ type: 'text', text }];
            for (const attachment of attachments) {
              const { readFile } = await import('node:fs/promises');
              const data = (await readFile(attachment.path)).toString(
                'base64',
              );
              content.push({
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: mediaTypeFor(attachment.path),
                  data,
                },
              });
            }
            yield {
              type: 'user',
              message: { role: 'user', content },
              parent_tool_use_id: null,
            };
          })()
        : text;
      const result: Query = query({ prompt, options });
      for await (const event of result) this.handle(pane.id, event);
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

  private handle(paneId: string, event: SDKMessage) {
    const pane = this.store.pane(paneId);
    if (event.type === 'assistant') {
      if (event.session_id && pane.threadId !== event.session_id) {
        pane.threadId = event.session_id;
        this.store.save();
      }
      const blocks = event.message.content;
      blocks.forEach((block, index) => {
        const message = messageFrom(
          blocks.length > 1 ? `${event.uuid}-${index}` : event.uuid,
          block,
        );
        if (!message) return;
        const existing = pane.messages.findIndex((m) => m.id === message.id);
        if (existing === -1) pane.messages.push(message);
        else pane.messages[existing] = message;
        this.store.save();
        this.emit({ paneId, type: 'message', message });
      });
      return;
    }
    if (event.type === 'user') {
      const content = event.message.content;
      if (typeof content === 'string') return;
      for (const block of content) {
        if (block.type !== 'tool_result') continue;
        const index = pane.messages.findIndex(
          (m) => m.id === block.tool_use_id,
        );
        if (index === -1) continue;
        const output =
          typeof block.content === 'string'
            ? block.content
            : (block.content ?? [])
                .map((part) => ('text' in part ? part.text : ''))
                .join('\n');
        pane.messages[index] = {
          ...pane.messages[index],
          text: [pane.messages[index].text, output].filter(Boolean).join('\n'),
          status: block.is_error ? 'failed' : 'complete',
        };
        this.store.save();
        this.emit({
          paneId,
          type: 'message',
          message: pane.messages[index],
        });
      }
      return;
    }
    if (event.type === 'result') {
      const totals = Object.values(event.modelUsage ?? {}).reduce(
        (acc, usage) => ({
          inputTokens: acc.inputTokens + usage.inputTokens,
          outputTokens: acc.outputTokens + usage.outputTokens,
          cachedInputTokens: acc.cachedInputTokens + usage.cacheReadInputTokens,
          reasoningOutputTokens:
            acc.reasoningOutputTokens + (usage.thinkingTokens ?? 0),
        }),
        {
          inputTokens: 0,
          outputTokens: 0,
          cachedInputTokens: 0,
          reasoningOutputTokens: 0,
        },
      );
      const usage: Usage = totals;
      pane.usage = usage;
      this.store.save();
      this.emit({ paneId, type: 'usage', usage });
      if (event.subtype !== 'success') {
        const message: ConversationMessage = {
          id: randomUUID(),
          role: 'assistant',
          kind: 'error',
          text: event.errors.join('\n') || 'Claude turn failed',
          status: 'failed',
        };
        pane.messages.push(message);
        this.store.save();
        this.emit({ paneId, type: 'message', message });
      }
    }
  }
}

function titleFrom(text: string) {
  const compact = text.replace(/\s+/g, ' ').trim();
  return compact.length > 42 ? compact.slice(0, 41).trimEnd() + '…' : compact;
}

function mediaTypeFor(
  path: string,
): 'image/png' | 'image/webp' | 'image/gif' | 'image/jpeg' {
  const ext = path.split('.').pop()?.toLowerCase();
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'gif') return 'image/gif';
  return 'image/jpeg';
}

function messageFrom(id: string, block: unknown): ConversationMessage | undefined {
  const b = block as Record<string, unknown>;
  if (b.type === 'text')
    return {
      id,
      role: 'assistant',
      kind: 'text',
      text: String(b.text ?? ''),
      status: 'complete',
    };
  if (b.type === 'thinking')
    return {
      id,
      role: 'assistant',
      kind: 'thinking',
      text: String(b.thinking ?? ''),
      status: 'complete',
    };
  if (b.type === 'tool_use')
    return {
      id,
      role: 'assistant',
      kind: 'tool',
      text: `${b.name} ${JSON.stringify(b.input)}`,
      status: 'streaming',
    };
  return undefined;
}
