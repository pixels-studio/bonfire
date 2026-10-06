<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLButtonAttributes } from 'svelte/elements';
  import { Button } from '$lib/components/ui/button';
  import Icon from '$lib/components/icon/icon.svelte';
  import PaneMenu from '$lib/components/pane-menu/pane-menu.svelte';
  import type { PaneSize } from '$lib/panes';
  import type { PaneBadge, PaneStatus } from '$lib/pane-status.svelte';
  import { cn } from '$lib/utils';

  const STATUS_DOTS: Record<Exclude<PaneStatus, 'idle'>, string> = {
    working: 'bg-success dot-working',
    input: 'bg-orange-400',
    error: 'bg-destructive',
    done: 'bg-success',
  };
  const STATUS_LABELS: Record<Exclude<PaneStatus, 'idle'>, string> = {
    working: 'Working',
    input: 'Needs input',
    error: 'Failed',
    done: 'Done, not yet reviewed',
  };

  let {
    title,
    icon,
    iconSrc,
    heading,
    badge,
    status = 'idle',
    menuLabel,
    dragHandle,
    actions,
    menuItems,
    onrename,
    size,
    onresize,
    onclose,
    resizable = true,
  }: {
    title: string;
    /** Shown before the title. */
    icon?: string;
    /** An image shown in place of the icon, such as a page's favicon; the icon returns if it fails to load. */
    iconSrc?: string;
    /** Replaces the title with the pane's own content, such as a URL bar, spanning the header. */
    heading?: Snippet;
    /** Marks the icon with a status dot in its corner: needs input, failed, or done but not yet reviewed. */
    badge?: PaneBadge;
    /** Replaces the icon with a colored dot while the pane is anything but idle. */
    status?: PaneStatus;
    /** What the pane menu's trigger is announced as; "<title> options" by default. */
    menuLabel?: string;
    /** Adds a grip for reordering the pane; panes fixed in place have none. */
    dragHandle?: HTMLButtonAttributes;
    /** Buttons shown before the pane menu. */
    actions?: Snippet;
    /** Pane-specific items added to the pane menu. */
    menuItems?: Snippet;
    /** Lets the title be renamed by double-clicking it; fixed titles have none. */
    onrename?: (title: string) => void;
    size: PaneSize;
    onresize: (size: PaneSize) => void;
    onclose: () => void;
    /** Hides the size menu for panels with no useful size to switch to. */
    resizable?: boolean;
  } = $props();

  const label = $derived(menuLabel ?? `${title} options`);

  /** The image that failed to load, so the icon shows until another one is given. */
  let failedSrc = $state<string>();

  let editing = $state(false);
  let draft = $state('');

  function startRename() {
    if (!onrename) return;
    draft = title;
    editing = true;
  }

  function finishRename(save: boolean) {
    if (!editing) return;
    editing = false;
    const next = draft.trim();
    if (save && next && next !== title) onrename?.(next);
  }

  function focusAndSelect(node: HTMLInputElement) {
    node.focus();
    node.select();
  }

  const reducedMotion =
    typeof matchMedia === 'function'
      ? matchMedia('(prefers-reduced-motion: reduce)')
      : undefined;

  /**
   * Blurs and fades the title as it swaps (e.g. when one is generated after the
   * first message): the old title drifts up, the new one settles in from below.
   * Under reduced motion it's a plain, quicker crossfade.
   */
  function swap(_node: Element, { direction }: { direction: 1 | -1 }) {
    const reduce = reducedMotion?.matches ?? false;
    const entering = direction === 1;
    return {
      duration: reduce ? 150 : entering ? 320 : 200,
      delay: entering && !reduce ? 60 : 0,
      easing: (t: number) => 1 - Math.pow(1 - t, 3),
      css: (t: number) => {
        const u = 1 - t;
        if (reduce) return `opacity: ${t}`;
        return `opacity: ${t}; filter: blur(${u * 4}px); transform: translateY(${u * 6 * direction}px)`;
      },
    };
  }
</script>

<header
  class="flex min-h-13.5 shrink-0 items-center justify-between gap-3 py-3 pr-2 pl-4"
>
  <div class={cn('flex min-w-0 items-center gap-1', heading && 'flex-1')}>
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
    <h2
      class={cn(
        'flex min-w-0 items-center gap-2 text-sm font-semibold',
        heading && 'flex-1',
      )}
    >
      {#if status !== 'idle'}
        <span class="grid size-4 shrink-0 place-content-center">
          <span
            class={cn('size-2.5 rounded-full', STATUS_DOTS[status])}
            role="img"
            aria-label={STATUS_LABELS[status]}
          ></span>
        </span>
      {:else if iconSrc && iconSrc !== failedSrc}
        <img
          src={iconSrc}
          alt=""
          class="size-4 shrink-0 rounded-xs object-contain"
          onerror={() => (failedSrc = iconSrc)}
        />
      {:else if icon}
        <span class="relative shrink-0">
          <Icon name={icon} class="text-muted-foreground" />
          {#if badge}
            <span
              class={cn(
                'absolute -top-0.5 -right-0.5 size-2 rounded-full ring-2 ring-card',
                STATUS_DOTS[badge],
              )}
              role="img"
              aria-label={STATUS_LABELS[badge]}
            ></span>
          {/if}
        </span>
      {/if}
      {#if heading}
        {@render heading()}
      {:else if editing}
        <input
          class="-mx-1 h-6 min-w-0 flex-1 rounded-md bg-secondary px-1 text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
          aria-label="Pane title"
          maxlength={200}
          spellcheck="false"
          autocomplete="off"
          bind:value={draft}
          use:focusAndSelect
          onkeydown={(event) => {
            if (event.key === 'Enter') finishRename(true);
            else if (event.key === 'Escape') {
              event.stopPropagation();
              finishRename(false);
            }
          }}
          onblur={() => finishRename(true)}
        />
      {:else}
        <!-- Both titles share one grid cell so the old and new overlap while they swap. -->
        <span class="grid min-w-0">
          {#key title}
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <span
              class="col-start-1 row-start-1 truncate"
              title={onrename ? `${title} (double-click to rename)` : title}
              ondblclick={startRename}
              in:swap={{ direction: 1 }}
              out:swap={{ direction: -1 }}>{title}</span
            >
          {/key}
        </span>
      {/if}
    </h2>
  </div>
  <div class="flex shrink-0 items-center gap-2">
    {@render actions?.()}
    {#if resizable}
      <PaneMenu {label} {size} {onresize} items={menuItems} />
    {/if}
    <Button
      variant="secondary"
      size="icon"
      class="shrink-0 text-muted-foreground hover:text-foreground"
      aria-label={`Close ${title}`}
      onclick={onclose}
    >
      <Icon name="close" />
    </Button>
  </div>
</header>
