<script lang="ts">
  import type { Snippet } from 'svelte';
  import { toolCall, toolColor, toolIcon } from '$lib/tools';
  import { cn } from '$lib/utils';
  import type { ConversationMessage } from '$shared/contracts';

  let {
    messages,
    children,
  }: { messages: ConversationMessage[]; children: Snippet } = $props();

  const tools = $derived(messages.filter((item) => item.kind === 'tool'));
  const replies = $derived(
    messages.filter((item) => item.kind === 'text').length,
  );
  const icons = $derived(
    [...new Set(tools.map((item) => toolCall(item).name))].map((name) => ({
      Glyph: toolIcon(name),
      color: toolColor(name),
    })),
  );
  /** The work is built once first opened; until then the summary is all there is to show. */
  let opened = $state(false);
  const label = $derived(
    [
      `${tools.length} tool ${tools.length === 1 ? 'call' : 'calls'}`,
      replies && `${replies} ${replies === 1 ? 'message' : 'messages'}`,
    ]
      .filter(Boolean)
      .join(', '),
  );
</script>

<!-- Collapses the work behind a finished turn so its final reply stands out. -->
<details class="text-sm">
  <summary
    onclick={() => (opened = true)}
    class="flex w-fit cursor-pointer list-none items-center gap-2 text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden"
  >
    <span class="flex items-center gap-1">
      {#each icons as { Glyph, color }, index (index)}
        <Glyph class={cn('size-4 shrink-0', color)} />
      {/each}
    </span>
    {label}
  </summary>
  {#if opened}
    <div class="mt-4 flex flex-col gap-4">
      {@render children()}
    </div>
  {/if}
</details>
