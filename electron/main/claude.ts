import type {
  Options,
  SDKAssistantMessage,
  SDKMessage,
  SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
import type {
  ConversationMessage,
  Pane,
  ReasoningEffort,
  Usage,
} from '../../shared/contracts';
import {
  ChatAssistant,
  assistantMessage,
  type PendingAttachment,
  type Turn,
} from './assistant';

type ContentBlock = SDKAssistantMessage['message']['content'][number];

const EXTENDED_CONTEXT_MODEL = 'sonnet-1m';
const EXTENDED_CONTEXT_BETA = 'context-1m-2025-08-07';

const THINKING: Record<ReasoningEffort, Options['thinking']> = {
  minimal: { type: 'disabled' },
  low: { type: 'enabled', budgetTokens: 2048 },
  medium: { type: 'enabled', budgetTokens: 8192 },
  high: { type: 'enabled', budgetTokens: 16384 },
  xhigh: { type: 'adaptive' },
};

const EMPTY_USAGE: Usage = {
  inputTokens: 0,
  cachedInputTokens: 0,
  outputTokens: 0,
  reasoningOutputTokens: 0,
};

export class ClaudeAssistant extends ChatAssistant {
  protected readonly provider = 'claude';

  protected async run({ pane, session, input, attachments, controller }: Turn) {
    const extendedContext = input.model === EXTENDED_CONTEXT_MODEL;
    const options: Options = {
      cwd: session.worktreePath,
      resume: pane.threadId || undefined,
      model: extendedContext ? 'sonnet' : input.model || undefined,
      betas: extendedContext ? [EXTENDED_CONTEXT_BETA] : undefined,
      thinking: THINKING[input.reasoningEffort],
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      abortController: controller,
    };
    const { query } = await import('@anthropic-ai/claude-agent-sdk');
    const prompt = attachments.length
      ? promptWithImages(input.text, attachments)
      : input.text;
    for await (const event of query({ prompt, options }))
      this.handle(pane, event);
  }

  private handle(pane: Pane, event: SDKMessage) {
    switch (event.type) {
      case 'assistant': {
        if (event.session_id) this.rememberThread(pane, event.session_id);
        const blocks = event.message.content;
        blocks.forEach((block, index) => {
          const id = blocks.length > 1 ? `${event.uuid}-${index}` : event.uuid;
          const message = messageFrom(id, block);
          if (message) this.publish(pane, message);
        });
        break;
      }
      case 'user':
        this.attachToolResults(pane, event);
        break;
      case 'result': {
        const usage = Object.values(event.modelUsage ?? {}).reduce<Usage>(
          (total, model) => ({
            inputTokens: total.inputTokens + model.inputTokens,
            cachedInputTokens:
              total.cachedInputTokens + model.cacheReadInputTokens,
            outputTokens: total.outputTokens + model.outputTokens,
            reasoningOutputTokens:
              total.reasoningOutputTokens + (model.thinkingTokens ?? 0),
          }),
          EMPTY_USAGE,
        );
        this.publishUsage(pane, usage);
        if (event.subtype !== 'success')
          this.publishError(
            pane,
            event.errors.join('\n') || 'Claude turn failed',
          );
        break;
      }
    }
  }

  /** Appends tool output to the matching tool-use message and settles its status. */
  private attachToolResults(
    pane: Pane,
    event: Extract<SDKMessage, { type: 'user' }>,
  ) {
    const { content } = event.message;
    if (typeof content === 'string') return;
    for (const block of content) {
      if (block.type !== 'tool_result') continue;
      const toolMessage = pane.messages.find(
        (message) => message.id === block.tool_use_id,
      );
      if (!toolMessage) continue;
      const output =
        typeof block.content === 'string'
          ? block.content
          : (block.content ?? [])
              .map((part) => ('text' in part ? part.text : ''))
              .join('\n');
      this.publish(pane, {
        ...toolMessage,
        text: [toolMessage.text, output].filter(Boolean).join('\n'),
        status: block.is_error ? 'failed' : 'complete',
      });
    }
  }
}

async function* promptWithImages(
  text: string,
  attachments: PendingAttachment[],
): AsyncIterable<SDKUserMessage> {
  yield {
    type: 'user',
    parent_tool_use_id: null,
    message: {
      role: 'user',
      content: [
        { type: 'text', text },
        ...attachments.map(({ mimeType, base64 }) => ({
          type: 'image' as const,
          source: {
            type: 'base64' as const,
            media_type: mimeType,
            data: base64,
          },
        })),
      ],
    },
  };
}

function messageFrom(
  id: string,
  block: ContentBlock,
): ConversationMessage | undefined {
  switch (block.type) {
    case 'text':
      return assistantMessage(id, 'text', block.text);
    case 'thinking':
      return assistantMessage(id, 'thinking', block.thinking);
    case 'tool_use':
      // Keyed by the tool-use id so the later tool_result can find it.
      return assistantMessage(
        block.id,
        'tool',
        `${block.name} ${JSON.stringify(block.input)}`,
        'streaming',
      );
  }
}
