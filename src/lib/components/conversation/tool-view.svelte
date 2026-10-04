<script lang="ts">
  import { overlayScrollbar } from '$lib/scrollbar';
  import { toolCall, toolColor, toolIcon } from '$lib/tools';
  import { cn } from '$lib/utils';
  import type { ConversationMessage } from '$shared/contracts';

  let { message }: { message: ConversationMessage } = $props();
  const tool = $derived(toolCall(message));
  const Glyph = $derived(toolIcon(tool.name));
  const color = $derived(
    message.status === 'failed' ? 'text-destructive' : toolColor(tool.name),
  );
  const shell = $derived(tool.name === 'Bash');
  const streaming = $derived(message.status === 'streaming');
  /** Output is built once first opened; a long chat holds hundreds of these, mostly closed. */
  let opened = $state(false);
</script>

<details class="group text-sm">
  <!-- Marked on click, before the native toggle paints, so the output shows in the same frame. -->
  <summary
    onclick={() => (opened = true)}
    class="flex w-full min-w-0 cursor-pointer list-none items-center gap-2 [&::-webkit-details-marker]:hidden"
  >
    <Glyph class={cn('size-4 shrink-0', color)} />
    <span class={cn('shrink-0', color, streaming && 'shimmer-text')}>
      {tool.name}
    </span>
    {#if tool.input}
      <code
        class="min-w-0 truncate rounded-md border border-foreground/8 px-1.5 py-0.5 font-mono text-xs text-foreground group-open:hidden"
      >
        {tool.input}
      </code>
    {/if}
  </summary>
  {#if opened && (tool.input || tool.output)}
    <pre
      {@attach overlayScrollbar}
      class="mt-2 max-h-80 overflow-auto rounded-lg border border-border bg-background p-3 font-mono text-xs/5 whitespace-pre-wrap text-foreground/80 wrap-anywhere">{#if tool.input}<span
          class="text-foreground">{shell ? '> ' : ''}{tool.input}</span
        >{'\n'}{/if}{tool.output}</pre>
  {/if}
</details>
