import type { ConversationMessage } from '../../shared/contracts';
import { assistantMessage } from './assistant';
import type { ItemStatus, McpContentItem, ThreadItem } from './codex-protocol';
import { clipOutput, toolInput } from './tool-text';

/**
 * Maps a Codex item onto the conversation model, using the same tool names as
 * Claude so the renderer treats both alike. Items with nothing to show give `undefined`.
 */
export function messageFromItem(
  item: ThreadItem,
  completed: boolean,
): ConversationMessage | undefined {
  const status = completed ? 'complete' : 'streaming';
  switch (item.type) {
    case 'agentMessage':
      return assistantMessage(item.id, 'text', item.text, status);
    case 'plan':
      return assistantMessage(item.id, 'text', item.text, status);
    case 'reasoning':
      return assistantMessage(
        item.id,
        'thinking',
        (item.summary.length ? item.summary : item.content).join('\n\n'),
        status,
      );
    case 'commandExecution':
      return toolMessage(
        item.id,
        itemStatus(item.status, completed, item.exitCode),
        'Bash',
        displayCommand(item.command),
        item.aggregatedOutput ?? '',
      );
    case 'fileChange':
      return toolMessage(
        item.id,
        itemStatus(item.status, completed),
        'Edit',
        item.changes.map(({ path }) => path).join(', '),
        item.changes
          .map(({ kind, path, diff }) =>
            [`${kind.type} ${path}`, diff].filter(Boolean).join('\n'),
          )
          .join('\n\n'),
      );
    case 'mcpToolCall':
      return toolMessage(
        item.id,
        itemStatus(item.status, completed),
        `${item.server} · ${item.tool}`,
        toolInput(item.arguments),
        item.error?.message ?? contentText(item.result?.content),
      );
    case 'dynamicToolCall':
      return toolMessage(
        item.id,
        itemStatus(item.status, completed),
        item.tool,
        toolInput(item.arguments),
        contentText(item.contentItems),
      );
    case 'collabAgentToolCall':
      return toolMessage(
        item.id,
        itemStatus(item.status, completed),
        'Agent',
        item.prompt ?? item.tool,
      );
    case 'webSearch':
      return toolMessage(item.id, status, 'WebSearch', item.query);
    default:
      return undefined;
  }
}

/** The assistant's plan steps as a to-do list, shown like Claude's `TodoWrite`. */
export function planMessage(
  turnId: string,
  plan: { step: string; status: string }[],
): ConversationMessage {
  const marks: Record<string, string> = {
    completed: '✓',
    inProgress: '→',
    pending: '○',
  };
  return toolMessage(
    `plan:${turnId}`,
    plan.every(({ status }) => status === 'completed')
      ? 'complete'
      : 'streaming',
    'TodoWrite',
    '',
    plan
      .map(({ step, status }) => `${marks[status] ?? '○'} ${step}`)
      .join('\n'),
  );
}

/** Shows the command rather than the login-shell wrapper Codex runs it through. */
export function displayCommand(command: string) {
  const wrapped = /^(?:\/\S*\/)?(?:zsh|bash|sh) -l?c '([\s\S]*)'$/.exec(
    command,
  );
  return wrapped ? wrapped[1].replaceAll("'\\''", "'") : command;
}

function itemStatus(
  status: ItemStatus,
  completed: boolean,
  exitCode?: number | null,
): ConversationMessage['status'] {
  if (status === 'failed' || status === 'declined') return 'failed';
  if (status === 'inProgress' && !completed) return 'streaming';
  return exitCode ? 'failed' : 'complete';
}

function contentText(content: McpContentItem[] | null | undefined) {
  return (content ?? [])
    .map((part) => part.text ?? '')
    .filter(Boolean)
    .join('\n');
}

/** The images an MCP tool result carried, such as a screenshot a browser tool took. */
export function imagesFromItem(item: ThreadItem) {
  const content =
    item.type === 'mcpToolCall'
      ? item.result?.content
      : item.type === 'dynamicToolCall'
        ? item.contentItems
        : null;
  return (content ?? [])
    .filter((part) => part.type === 'image' && part.data && part.mimeType)
    .map(({ data, mimeType }) => ({ data: data!, mimeType: mimeType! }));
}

function toolMessage(
  id: string,
  status: ConversationMessage['status'],
  name: string,
  input = '',
  output = '',
): ConversationMessage {
  return {
    ...assistantMessage(id, 'tool', `${name} ${input}`.trim(), status),
    tool: { name, input: clipOutput(input, 2_000), output: clipOutput(output) },
  };
}
