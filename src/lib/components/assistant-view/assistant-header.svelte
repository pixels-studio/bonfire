<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
  import Icon from '$lib/components/icon/icon.svelte';
  import { PANE_SIZES, type PaneSize } from '$lib/panes';
  import type { HTMLButtonAttributes } from 'svelte/elements';

  let {
    title,
    dragHandle,
    onresize,
    onclose,
  }: {
    title: string;
    dragHandle: HTMLButtonAttributes;
    onresize: (size: PaneSize) => void;
    onclose: () => void;
  } = $props();
</script>

<header class="flex shrink-0 items-center justify-between gap-3 py-3 pr-2 pl-4">
  <div class="flex min-w-0 items-center gap-1">
    <button
      type="button"
      class="-ml-1.5 shrink-0 cursor-grab touch-none rounded-md p-0.5 text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 active:cursor-grabbing"
      aria-label="Reorder pane"
      title="Drag to reorder"
      {...dragHandle}
    >
      <Icon name="drag" class="size-5" />
    </button>
    <span class="truncate text-sm font-semibold" {title}>{title}</span>
  </div>
  <div class="flex items-center gap-3">
    <DropdownMenu.Root>
      <DropdownMenu.Trigger>
        {#snippet child({ props })}
          <Button
            {...props}
            variant="secondary"
            size="icon"
            class="text-muted-foreground hover:text-foreground"
            aria-label="Conversation options"
          >
            <Icon name="dots" />
          </Button>
        {/snippet}
      </DropdownMenu.Trigger>
      <DropdownMenu.Content align="end">
        <DropdownMenu.Label>Pane size</DropdownMenu.Label>
        {#each PANE_SIZES as size (size.value)}
          <DropdownMenu.Item onclick={() => onresize(size.value)}>
            <Icon name={size.icon} />
            {size.label}
          </DropdownMenu.Item>
        {/each}
        <DropdownMenu.Separator />
        <DropdownMenu.Item variant="destructive" onclick={onclose}>
          <Icon name="close" /> Close
        </DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  </div>
</header>
