<script lang="ts">
  import { onMount } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import Icon from '$lib/components/icon/icon.svelte';
  import InsightsPopover from '$lib/components/insights/insights-popover.svelte';
  import type { PaneStatus } from '$lib/pane-status.svelte';
  import { cn } from '$lib/utils';

  type HeaderAction = {
    icon: string;
    label: string;
    disabled?: boolean;
    onclick?: () => void;
  };

  const DOT_STYLES: Record<
    PaneStatus,
    { slot: string; dot: string; ring: string }
  > = {
    idle: {
      slot: 'hover:bg-foreground/10',
      dot: 'bg-foreground/40',
      ring: 'border-foreground/40',
    },
    working: {
      slot: 'hover:bg-brand/10',
      dot: 'bg-brand',
      ring: 'border-brand',
    },
    input: {
      slot: 'hover:bg-warning/10',
      dot: 'bg-warning',
      ring: 'border-warning',
    },
    error: {
      slot: 'hover:bg-destructive/10',
      dot: 'bg-destructive',
      ring: 'border-destructive',
    },
  };
  const STATUS_LABELS: Record<PaneStatus, string> = {
    idle: 'idle',
    working: 'working',
    input: 'needs input',
    error: 'failed',
  };

  let {
    onaddPane,
    panes,
    canAddPane,
    onselectPane,
    onhelp,
  }: {
    onaddPane: () => void;
    panes: { id: string; status: PaneStatus; inView: boolean }[];
    canAddPane: boolean;
    onselectPane: (paneId: string) => void;
    onhelp: () => void;
  } = $props();

  const isMac = /mac/i.test(navigator.userAgent);
  let fullscreen = $state(false);

  const paneActions = $derived<HeaderAction[]>([
    {
      icon: 'plus',
      label: 'Add new pane',
      disabled: !canAddPane,
      onclick: () => onaddPane(),
    },
  ]);
  const UTILITY_BUTTON_CLASS = 'text-muted-foreground hover:text-foreground';
  const helpAction: HeaderAction = {
    icon: 'help',
    label: 'Help',
    onclick: () => onhelp(),
  };
  const settingsAction: HeaderAction = { icon: 'settings', label: 'Settings' };

  onMount(() => {
    window.bonfire.app.isFullscreen().then((value) => (fullscreen = value));
    return window.bonfire.app.onFullscreenChange(
      (value) => (fullscreen = value),
    );
  });
</script>

{#snippet actionButtons(actions: HeaderAction[], className?: string)}
  {#each actions as action (action.label)}
    <Button
      variant="secondary"
      size="icon"
      class={className}
      aria-label={action.label}
      disabled={action.disabled}
      onclick={action.onclick}
    >
      <Icon name={action.icon} />
    </Button>
  {/each}
{/snippet}

<header
  class={cn(
    'sticky top-0 z-20 flex min-h-13 shrink-0 items-center justify-between bg-background px-4 py-2 app-drag',
    isMac && !fullscreen && 'pl-22',
  )}
>
  <div class="flex items-center gap-3 app-no-drag">
    {@render actionButtons(paneActions)}
    {#if panes.length > 3}
      <nav
        class="flex h-7.5 items-center gap-0.5 rounded-full bg-secondary px-0.5"
        aria-label="Panes"
      >
        {#each panes as pane, index (pane.id)}
          {@const style = DOT_STYLES[pane.status]}
          <button
            type="button"
            class={cn(
              'grid size-6 place-content-center rounded-full outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring/60',
              style.slot,
            )}
            aria-label={`Go to pane ${index + 1} (${STATUS_LABELS[pane.status]})`}
            onclick={() => onselectPane(pane.id)}
          >
            <span
              class={cn(
                'size-2.5 rounded-full border-2 bg-clip-padding transition-colors duration-150',
                style.ring,
                pane.inView ? style.dot : 'bg-transparent',
              )}
            ></span>
          </button>
        {/each}
      </nav>
    {/if}
  </div>
  <div class="flex items-center gap-3 app-no-drag">
    {@render actionButtons([helpAction], UTILITY_BUTTON_CLASS)}
    <InsightsPopover class={UTILITY_BUTTON_CLASS} />
    {@render actionButtons([settingsAction], UTILITY_BUTTON_CLASS)}
  </div>
</header>
