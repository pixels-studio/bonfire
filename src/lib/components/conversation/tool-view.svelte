<script lang="ts">
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import type { ConversationMessage } from '$shared/contracts';

  let { message }: { message: ConversationMessage } = $props();
  const [label, ...details] = $derived(message.text.split('\n'));
</script>

<details class="group text-xs text-muted-foreground">
  <summary class="flex cursor-pointer items-center gap-1.5">
    <ChevronRight
      class="size-3.5 transition-transform group-open:rotate-90 motion-reduce:transition-none"
    />
    {label || 'Tool call'}
  </summary>
  {#if details.length}
    <pre
      class="mt-2 ml-5 max-h-45 overflow-auto text-foreground/80">{details.join(
        '\n',
      )}</pre>
  {/if}
</details>
