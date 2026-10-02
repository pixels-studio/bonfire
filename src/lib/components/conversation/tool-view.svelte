<script lang="ts">
  import { toolCall, toolIcon } from '$lib/tools';
  import { cn } from '$lib/utils';
  import type { ConversationMessage } from '$shared/contracts';

  let { message }: { message: ConversationMessage } = $props();
  const tool = $derived(toolCall(message));
  const Glyph = $derived(toolIcon(tool.name));
  const shell = $derived(tool.name === 'Bash');
  const streaming = $derived(message.status === 'streaming');
</script>

<details class="group text-sm">
  <summary
    class="flex w-full min-w-0 cursor-pointer list-none items-center gap-2 [&::-webkit-details-marker]:hidden"
  >
    <Glyph class="size-4 shrink-0 text-muted-foreground" />
    <span
      class={cn(
        'shrink-0',
        streaming && 'shimmer-text',
        message.status === 'failed' && 'text-destructive',
      )}
    >
      {tool.name}
    </span>
    {#if tool.input}
      <code
        class="min-w-0 truncate rounded-md bg-surface-raised px-1.5 py-0.5 font-mono text-xs text-muted-foreground group-open:hidden"
      >
        {tool.input}
      </code>
    {/if}
  </summary>
  {#if tool.input || tool.output}
    <pre
      class="mt-2 max-h-80 overflow-auto rounded-lg border border-border bg-background p-3 font-mono text-xs/5 whitespace-pre-wrap text-foreground/80 wrap-anywhere">{#if tool.input}<span
          class="text-foreground">{shell ? '> ' : ''}{tool.input}</span
        >{'\n'}{/if}{tool.output}</pre>
  {/if}
</details>
