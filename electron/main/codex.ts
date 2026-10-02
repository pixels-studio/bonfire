import type {
  Codex,
  Input,
  ThreadEvent,
  ThreadItem,
  ThreadOptions,
} from '@openai/codex-sdk';
import type { ConversationMessage, Pane } from '../../shared/contracts';
import { ChatAssistant, assistantMessage, type Turn } from './assistant';

export class CodexAssistant extends ChatAssistant {
  protected readonly provider = 'codex';
  private codex?: Codex;

  protected async run({ pane, session, input, attachments, controller }: Turn) {
    const options: ThreadOptions = {
      workingDirectory: session.worktreePath,
      sandboxMode: 'workspace-write',
      approvalPolicy: 'never',
      model: input.model || undefined,
      modelReasoningEffort: input.reasoningEffort,
    };
    const codex = await this.client();
    const thread = pane.threadId
      ? codex.resumeThread(pane.threadId, options)
      : codex.startThread(options);
    const prompt: Input = attachments.length
      ? [
          { type: 'text', text: input.text },
          ...attachments.map(({ path }) => ({
            type: 'local_image' as const,
            path,
          })),
        ]
      : input.text;

    const { events } = await thread.runStreamed(prompt, {
      signal: controller.signal,
    });
    for await (const event of events) this.handle(pane, event);
  }

  private async client() {
    if (!this.codex) {
      const { Codex } = await import('@openai/codex-sdk');
      this.codex = new Codex();
    }
    return this.codex;
  }

  private handle(pane: Pane, event: ThreadEvent) {
    switch (event.type) {
      case 'thread.started':
        this.rememberThread(pane, event.thread_id);
        break;
      case 'item.started':
      case 'item.updated':
      case 'item.completed': {
        const complete = event.type === 'item.completed';
        this.publish(pane, messageFrom(event.item, complete), complete);
        break;
      }
      case 'turn.completed':
        this.publishUsage(pane, {
          inputTokens: event.usage.input_tokens,
          cachedInputTokens: event.usage.cached_input_tokens,
          outputTokens: event.usage.output_tokens,
          reasoningOutputTokens: event.usage.reasoning_output_tokens,
        });
        break;
      case 'turn.failed':
        this.publishError(pane, event.error.message);
        break;
      case 'error':
        this.publishError(pane, event.message);
        break;
    }
  }
}

function messageFrom(item: ThreadItem, complete: boolean): ConversationMessage {
  const status = complete ? 'complete' : 'streaming';
  const toolStatus =
    'status' in item && item.status === 'failed' ? 'failed' : status;

  switch (item.type) {
    case 'agent_message':
      return assistantMessage(item.id, 'text', item.text, status);
    case 'reasoning':
      return assistantMessage(item.id, 'thinking', item.text, status);
    case 'command_execution':
      return assistantMessage(
        item.id,
        'tool',
        [item.command, item.aggregated_output].filter(Boolean).join('\n'),
        toolStatus,
      );
    case 'file_change':
      return assistantMessage(
        item.id,
        'tool',
        item.changes.map(({ kind, path }) => `${kind} ${path}`).join('\n'),
        toolStatus,
      );
    case 'mcp_tool_call':
      return assistantMessage(
        item.id,
        'tool',
        `${item.server} · ${item.tool}`,
        toolStatus,
      );
    case 'web_search':
      return assistantMessage(
        item.id,
        'tool',
        `Searched for ${item.query}`,
        status,
      );
    case 'todo_list':
      return assistantMessage(
        item.id,
        'tool',
        item.items
          .map((todo) => `${todo.completed ? '✓' : '○'} ${todo.text}`)
          .join('\n'),
        status,
      );
    case 'error':
      return assistantMessage(item.id, 'error', item.message, 'failed');
  }
}
