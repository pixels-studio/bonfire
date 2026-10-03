<script lang="ts" module>
  /** A pane of app-wide tools, opened from the rail ahead of the conversation panes. */
  export type AppPanel = 'insights' | 'settings';

  const PANELS: { panel: AppPanel; icon: string; label: string }[] = [
    { panel: 'insights', icon: 'insights', label: 'Insights' },
    { panel: 'settings', icon: 'settings', label: 'Settings' },
  ];
</script>

<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
  import * as Tooltip from '$lib/components/ui/tooltip';
  import Icon from '$lib/components/icon/icon.svelte';
  import type { PaneStatus } from '$lib/pane-status.svelte';
  import { TOOL_PANES } from '$lib/panes';
  import { preferences } from '$lib/stores/preferences.svelte';
  import { cn } from '$lib/utils';
  import { PROVIDER_LABELS } from '$shared/domain';
  import type { PaneType } from '$shared/contracts';

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
    panels,
    ontogglePanel,
    onhelp,
    onaddPane,
    panes,
    canAddPane,
    onselectPane,
    panelsInView,
    onselectPanel,
    trafficLightInset = false,
  }: {
    /** The panels open ahead of the panes, in strip order. */
    panels: AppPanel[];
    ontogglePanel: (panel: AppPanel) => void;
    onhelp: () => void;
    /** Opens a pane of the chosen type at the front of the strip. */
    onaddPane: (type: PaneType) => void;
    panes: { id: string; status: PaneStatus; inView: boolean }[];
    canAddPane: boolean;
    onselectPane: (paneId: string) => void;
    /** Which open panels are scrolled into sight. */
    panelsInView: Partial<Record<AppPanel, boolean>>;
    /** Scrolls an open panel into sight. */
    onselectPanel: (panel: AppPanel) => void;
    /** Drops the logo below the native window controls. */
    trafficLightInset?: boolean;
  } = $props();

  const BUTTON_CLASS = 'text-muted-foreground hover:text-foreground';
  const DOT_BUTTON_CLASS =
    'grid size-6 place-content-center rounded-full outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring/60';
  const DOT_CLASS =
    'size-2.5 rounded-full border-2 bg-clip-padding transition-colors duration-150';

  const openPanels = $derived(
    panels.flatMap((panel) => PANELS.filter((item) => item.panel === panel)),
  );
</script>

<nav
  class="flex w-12 shrink-0 flex-col items-center justify-between pb-6"
  aria-label="App"
>
  <div class="flex w-full flex-col items-center">
    <div class="app-drag grid h-13 w-full place-content-center">
      <img
        src="/logo.svg"
        alt="Bonfire"
        class={cn('size-6', trafficLightInset && 'translate-y-[55px]')}
        draggable="false"
      />
    </div>
    <div
      class={cn(
        'mt-3 flex flex-col items-center gap-3',
        trafficLightInset && 'translate-y-[55px]',
      )}
    >
      <DropdownMenu.Root>
        <DropdownMenu.Trigger disabled={!canAddPane}>
          {#snippet child({ props })}
            <Button
              {...props}
              variant="secondary"
              size="icon"
              class={cn(BUTTON_CLASS, 'group')}
              aria-label="Add pane"
            >
              <Icon
                name="plus"
                class="transition-transform duration-200 ease-out group-aria-expanded:rotate-45 motion-reduce:transition-none"
              />
            </Button>
          {/snippet}
        </DropdownMenu.Trigger>
        <DropdownMenu.Content side="right" align="start" class="w-44">
          <DropdownMenu.Label>Agents</DropdownMenu.Label>
          {#each preferences.enabledProviders as provider (provider)}
            <DropdownMenu.Item onclick={() => onaddPane(provider)}>
              <Icon name={provider} />
              {PROVIDER_LABELS[provider]}
            </DropdownMenu.Item>
          {/each}
          <DropdownMenu.Separator />
          {#each TOOL_PANES as pane (pane.type)}
            <DropdownMenu.Item onclick={() => onaddPane(pane.type)}>
              <Icon name={pane.icon} />
              {pane.label}
            </DropdownMenu.Item>
          {/each}
        </DropdownMenu.Content>
      </DropdownMenu.Root>
      {#if panes.length + panels.length > 3}
        <nav
          class="flex w-8 flex-col items-center gap-0.5 rounded-full bg-secondary py-1"
          aria-label="Panes"
        >
          {#each openPanels as item (item.panel)}
            {@const style = DOT_STYLES.idle}
            <button
              type="button"
              class={cn(DOT_BUTTON_CLASS, style.slot)}
              aria-label={`Go to ${item.label}`}
              onclick={() => onselectPanel(item.panel)}
            >
              <span
                class={cn(
                  DOT_CLASS,
                  style.ring,
                  panelsInView[item.panel] ? style.dot : 'bg-transparent',
                )}
              ></span>
            </button>
          {/each}
          {#each panes as pane, index (pane.id)}
            {@const style = DOT_STYLES[pane.status]}
            <button
              type="button"
              class={cn(DOT_BUTTON_CLASS, style.slot)}
              aria-label={`Go to pane ${index + 1} (${STATUS_LABELS[pane.status]})`}
              onclick={() => onselectPane(pane.id)}
            >
              <span
                class={cn(
                  DOT_CLASS,
                  style.ring,
                  pane.inView ? style.dot : 'bg-transparent',
                )}
              ></span>
            </button>
          {/each}
        </nav>
      {/if}
    </div>
  </div>
  <!-- Sized to span the composer: its 24px bottom inset and 112px height. -->
  <div class="flex flex-col items-center gap-3.5">
    <Tooltip.Root>
      <Tooltip.Trigger>
        {#snippet child({ props })}
          <Button
            {...props}
            variant="secondary"
            size="icon"
            class={BUTTON_CLASS}
            aria-label="Help"
            onclick={onhelp}
          >
            <Icon name="help" />
          </Button>
        {/snippet}
      </Tooltip.Trigger>
      <Tooltip.Content side="right">Help</Tooltip.Content>
    </Tooltip.Root>
    {#each PANELS as item (item.panel)}
      {@const open = panels.includes(item.panel)}
      <Button
        variant={open ? 'default' : 'secondary'}
        size="icon"
        class={cn(!open && BUTTON_CLASS)}
        aria-label={item.label}
        aria-pressed={open}
        onclick={() => ontogglePanel(item.panel)}
      >
        <Icon name={item.icon} />
      </Button>
    {/each}
  </div>
</nav>
