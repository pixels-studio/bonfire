import Globe from '@lucide/svelte/icons/globe';
import ListTodo from '@lucide/svelte/icons/list-todo';
import Search from '@lucide/svelte/icons/search';
import Wrench from '@lucide/svelte/icons/wrench';
import AgentIcon from '$lib/components/icon/agent-icon.svelte';
import BashIcon from '$lib/components/icon/bash-icon.svelte';
import EditIcon from '$lib/components/icon/edit-icon.svelte';
import ReadIcon from '$lib/components/icon/read-icon.svelte';
import ToolSearchIcon from '$lib/components/icon/tool-search-icon.svelte';
import WriteIcon from '$lib/components/icon/write-icon.svelte';
import WebFetchIcon from '$lib/components/icon/web-fetch-icon.svelte';
import type { ConversationMessage } from '$shared/contracts';

export type ToolCall = NonNullable<ConversationMessage['tool']>;

const ICONS: Record<
  string,
  | typeof Wrench
  | typeof ReadIcon
  | typeof EditIcon
  | typeof WriteIcon
  | typeof BashIcon
  | typeof WebFetchIcon
  | typeof ToolSearchIcon
  | typeof AgentIcon
> = {
  Bash: BashIcon,
  Read: ReadIcon,
  Edit: EditIcon,
  MultiEdit: EditIcon,
  Write: WriteIcon,
  NotebookEdit: EditIcon,
  Grep: Search,
  Glob: Search,
  WebFetch: WebFetchIcon,
  WebSearch: Globe,
  ToolSearch: ToolSearchIcon,
  Task: AgentIcon,
  Agent: AgentIcon,
  TodoWrite: ListTodo,
};

/** Full class names so Tailwind can see them; each tool family gets its own hue for icon and label. */
const COLORS: Record<string, string> = {
  Bash: 'text-emerald-600 dark:text-emerald-400',
  Read: 'text-sky-600 dark:text-sky-400',
  Edit: 'text-amber-600 dark:text-amber-400',
  MultiEdit: 'text-amber-600 dark:text-amber-400',
  Write: 'text-orange-600 dark:text-orange-400',
  NotebookEdit: 'text-amber-600 dark:text-amber-400',
  Grep: 'text-violet-600 dark:text-violet-400',
  Glob: 'text-fuchsia-600 dark:text-fuchsia-400',
  WebFetch: 'text-cyan-600 dark:text-cyan-400',
  WebSearch: 'text-teal-600 dark:text-teal-400',
  ToolSearch: 'text-yellow-600 dark:text-yellow-400',
  Task: 'text-pink-500 dark:text-pink-300',
  Agent: 'text-pink-500 dark:text-pink-300',
  TodoWrite: 'text-lime-600 dark:text-lime-400',
};

export function toolColor(name: string) {
  return COLORS[name] ?? 'text-muted-foreground';
}

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
