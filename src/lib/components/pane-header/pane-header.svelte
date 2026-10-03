<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLButtonAttributes } from 'svelte/elements';
  import Icon from '$lib/components/icon/icon.svelte';
  import PaneMenu from '$lib/components/pane-menu/pane-menu.svelte';
  import type { PaneSize } from '$lib/panes';

  let {
    title,
    icon,
    menuLabel,
    dragHandle,
    actions,
    onresize,
    onclose,
  }: {
    title: string;
    /** Shown before the title. */
    icon?: string;
    /** What the pane menu's trigger is announced as; "<title> options" by default. */
    menuLabel?: string;
    /** Adds a grip for reordering the pane; panes fixed in place have none. */
    dragHandle?: HTMLButtonAttributes;
    /** Buttons shown before the pane menu. */
    actions?: Snippet;
    onresize: (size: PaneSize) => void;
    onclose: () => void;
  } = $props();

  const label = $derived(menuLabel ?? `${title} options`);
</script>

<header
  class="flex min-h-13.5 shrink-0 items-center justify-between gap-3 py-3 pr-2 pl-4"
>
  <div class="flex min-w-0 items-center gap-1">
    {#if dragHandle}
      <button
        type="button"
        class="-ml-1.5 shrink-0 cursor-grab touch-none rounded-md p-0.5 text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 active:cursor-grabbing"
        aria-label="Reorder pane"
        title="Drag to reorder"
        {...dragHandle}
      >
        <Icon name="drag" class="size-5" />
      </button>
    {/if}
    <h2 class="flex min-w-0 items-center gap-2 text-sm font-semibold">
      {#if icon}<Icon name={icon} class="shrink-0 text-muted-foreground" />{/if}
      <span class="truncate" {title}>{title}</span>
    </h2>
  </div>
  <div class="flex shrink-0 items-center gap-2">
    {@render actions?.()}
    <PaneMenu {label} {onresize} {onclose} />
  </div>
</header>
