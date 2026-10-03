<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLButtonAttributes } from 'svelte/elements';
  import Icon from '$lib/components/icon/icon.svelte';
  import PaneMenu from '$lib/components/pane-menu/pane-menu.svelte';
  import type { PaneSize } from '$lib/panes';
  import type { PaneStatus } from '$lib/pane-status.svelte';
  import { cn } from '$lib/utils';

  const STATUS_DOTS: Record<Exclude<PaneStatus, 'idle'>, string> = {
    working: 'bg-success dot-working',
    input: 'bg-orange-400',
    error: 'bg-destructive',
  };
  const STATUS_LABELS: Record<Exclude<PaneStatus, 'idle'>, string> = {
    working: 'Working',
    input: 'Needs input',
    error: 'Failed',
  };

  let {
    title,
    icon,
    status = 'idle',
    menuLabel,
    dragHandle,
    actions,
    onresize,
    onclose,
  }: {
    title: string;
    /** Shown before the title. */
    icon?: string;
    /** Replaces the icon with a colored dot while the pane is anything but idle. */
    status?: PaneStatus;
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
      {#if status !== 'idle'}
        <span class="grid size-4 shrink-0 place-content-center">
          <span
            class={cn('size-2.5 rounded-full', STATUS_DOTS[status])}
            role="img"
            aria-label={STATUS_LABELS[status]}
          ></span>
        </span>
      {:else if icon}
        <Icon name={icon} class="shrink-0 text-muted-foreground" />
      {/if}
      <span class="truncate" {title}>{title}</span>
    </h2>
  </div>
  <div class="flex shrink-0 items-center gap-2">
    {@render actions?.()}
    <PaneMenu {label} {onresize} {onclose} />
  </div>
</header>
