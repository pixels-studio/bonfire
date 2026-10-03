<script lang="ts">
  import CornerDownLeft from '@lucide/svelte/icons/corner-down-left';
  import X from '@lucide/svelte/icons/x';
  import { Button } from '$lib/components/ui/button';
  import type { QueuedPrompt } from '$shared/contracts';

  let {
    queue,
    running,
    onsend,
    onremove,
  }: {
    queue: QueuedPrompt[];
    running: boolean;
    /** Sends the message now: it steers a running turn, or starts the next one. */
    onsend: (id: string) => void;
    onremove: (id: string) => void;
  } = $props();
</script>

<ul class="flex flex-col gap-2 pb-2" aria-label="Queued messages">
  {#each queue as item (item.id)}
    <li
      class="flex items-center gap-2 rounded-md bg-surface-raised/60 px-4 py-2 text-sm"
    >
      <span class="min-w-0 flex-1 truncate" title={item.text}>{item.text}</span>
      {#if item.attachments}
        <span class="shrink-0 text-xs text-muted-foreground">
          +{item.attachments}
          {item.attachments === 1 ? 'attachment' : 'attachments'}
        </span>
      {/if}
      <div class="flex shrink-0 items-center gap-2.5">
        <Button
          variant="ghost"
          size="icon"
          class="text-muted-foreground"
          aria-label={running ? 'Steer with this message now' : 'Send now'}
          title={running ? 'Steer now' : 'Send now'}
          onclick={() => onsend(item.id)}
        >
          <CornerDownLeft />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          class="text-muted-foreground"
          aria-label="Remove from queue"
          title="Remove"
          onclick={() => onremove(item.id)}
        >
          <X />
        </Button>
      </div>
    </li>
  {/each}
</ul>
