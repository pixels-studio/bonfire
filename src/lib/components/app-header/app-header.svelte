<script lang="ts">
  import type { Snippet } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import WindowControls from './window-controls.svelte';
  import Icon from '$lib/components/icon/icon.svelte';
  import {
    WORKSPACE_VIEWS,
    type WorkspaceView,
  } from '$lib/components/workspace/workspace-panel.svelte';
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
      slot: 'hover:bg-success/10',
      dot: 'bg-success',
      ring: 'border-success',
    },
    input: {
      slot: 'hover:bg-orange-400/10',
      dot: 'bg-orange-400',
      ring: 'border-orange-400',
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
    view = $bindable(),
    viewsDisabled,
    location,
  }: {
    onaddPane: () => void;
    panes: { id: string; status: PaneStatus; inView: boolean }[];
    canAddPane: boolean;
    onselectPane: (paneId: string) => void;
    /** The workspace view open beside the panes, if any. */
    view?: WorkspaceView;
    viewsDisabled: boolean;
    /** The project and workspace pickers. */
    location: Snippet;
  } = $props();

  const paneActions = $derived<HeaderAction[]>([
    {
      icon: 'plus',
      label: 'Add new pane',
      disabled: !canAddPane,
      onclick: () => onaddPane(),
    },
  ]);
  const UTILITY_BUTTON_CLASS = 'text-muted-foreground hover:text-foreground';
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
  class="sticky top-0 z-20 flex min-h-13 shrink-0 items-center justify-between bg-background py-2 pr-4 app-drag"
>
  <div class="flex min-w-0 items-center gap-2 app-no-drag">
    <div class="flex min-w-0 items-center gap-2">
      {@render location()}
    </div>
    <div class="flex items-center gap-2">
      {@render actionButtons(paneActions)}
    </div>
  </div>
  <div class="flex items-center gap-3 app-no-drag">
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
      <div
        class="h-4 w-0.5 rounded-full bg-foreground/20"
        role="separator"
        aria-orientation="vertical"
      ></div>
    {/if}
    {#each WORKSPACE_VIEWS as item (item.view)}
      <Button
        variant={view === item.view ? 'default' : 'secondary'}
        size="icon"
        class={cn(view !== item.view && UTILITY_BUTTON_CLASS)}
        aria-label={item.label}
        aria-pressed={view === item.view}
        disabled={viewsDisabled}
        onclick={() => (view = view === item.view ? undefined : item.view)}
      >
        <Icon name={item.icon} />
      </Button>
    {/each}
    <div
      class="h-4 w-0.5 rounded-full bg-foreground/20"
      role="separator"
      aria-orientation="vertical"
    ></div>
    <WindowControls />
  </div>
</header>
