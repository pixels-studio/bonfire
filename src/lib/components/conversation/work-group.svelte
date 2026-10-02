<script lang="ts">
  import type { Snippet } from 'svelte';
  import { toolCall, toolIcon } from '$lib/tools';
  import type { ConversationMessage } from '$shared/contracts';

  let {
    messages,
    children,
  }: { messages: ConversationMessage[]; children: Snippet } = $props();

  const tools = $derived(messages.filter((item) => item.kind === 'tool'));
  const replies = $derived(
    messages.filter((item) => item.kind === 'text').length,
  );
  const icons = $derived([
    ...new Set(tools.map((item) => toolIcon(toolCall(item).name))),
  ]);
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
    class="flex w-fit cursor-pointer list-none items-center gap-2 text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden"
  >
    <span class="flex items-center gap-1">
      {#each icons as Glyph, index (index)}
        <Glyph class="size-4 shrink-0" />
      {/each}
    </span>
    {label}
  </summary>
  <div class="mt-4 flex flex-col gap-4">
    {@render children()}
  </div>
</details>
