import Bot from '@lucide/svelte/icons/bot';
import FilePen from '@lucide/svelte/icons/file-pen';
import FileText from '@lucide/svelte/icons/file-text';
import Globe from '@lucide/svelte/icons/globe';
import ListTodo from '@lucide/svelte/icons/list-todo';
import Search from '@lucide/svelte/icons/search';
import Terminal from '@lucide/svelte/icons/terminal';
import Wrench from '@lucide/svelte/icons/wrench';
import type { ConversationMessage } from '$shared/contracts';

export type ToolCall = NonNullable<ConversationMessage['tool']>;

const ICONS: Record<string, typeof Wrench> = {
  Bash: Terminal,
  Read: FileText,
  Edit: FilePen,
  MultiEdit: FilePen,
  Write: FilePen,
  NotebookEdit: FilePen,
  Grep: Search,
  Glob: Search,
  WebFetch: Globe,
  WebSearch: Globe,
  Task: Bot,
  Agent: Bot,
  TodoWrite: ListTodo,
};

export function toolIcon(name: string) {
  return ICONS[name] ?? Wrench;
}

/** Reads a tool message, recovering details from the text of messages saved before `tool` existed. */
export function toolCall(message: ConversationMessage): ToolCall {
  if (message.tool) return message.tool;
  const [first = '', ...output] = message.text.split('\n');
  const [name = 'Tool', ...rest] = first.split(' ');
  let input = rest.join(' ');
  try {
    const parsed = JSON.parse(input);
    input = parsed.command ?? parsed.file_path ?? parsed.pattern ?? input;
  } catch {
    // Not JSON, so the remainder is already a readable argument.
  }
  return { name, input, output: output.join('\n') };
}
