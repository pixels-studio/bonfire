<script lang="ts" module>
  /** A pane of app-wide tools, opened from the rail ahead of the conversation panes. */
  export type AppPanel = 'shortcuts' | 'insights' | 'activity' | 'settings';

  type PanelItem = {
    panel: AppPanel;
    icon: string;
    label: string;
    shortcut: ShortcutId;
  };

  /** The panel buttons at the foot of the rail, top to bottom, above help. */
  const PANELS: PanelItem[] = [
    {
      panel: 'insights',
      icon: 'insights',
      label: 'Insights',
      shortcut: 'insights',
    },
    {
      panel: 'activity',
      icon: 'activity',
      label: 'Activity',
      shortcut: 'activity',
    },
    {
      panel: 'settings',
      icon: 'settings',
      label: 'Settings',
      shortcut: 'settings',
    },
    {
      panel: 'shortcuts',
      icon: 'keyboard',
      label: 'Keyboard shortcuts',
      shortcut: 'shortcuts',
    },
  ];
</script>

<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
  import * as Tooltip from '$lib/components/ui/tooltip';
  import Icon from '$lib/components/icon/icon.svelte';
  import Logo from '$lib/components/logo/logo.svelte';
  import type { PaneStatus } from '$lib/pane-status.svelte';
  import ShortcutKeys from '$lib/components/shortcuts/shortcut-keys.svelte';
  import { TOOL_PANES } from '$lib/panes';
  import type { ShortcutId } from '$lib/shortcuts';
  import { cliVersions } from '$lib/stores/cli-versions.svelte';
  import { preferences } from '$lib/stores/preferences.svelte';
  import { cn } from '$lib/utils';
  import { CLI_NAMES, PROVIDER_LABELS, isViewPaneType } from '$shared/domain';
  import type { AssistantProvider, PaneType } from '$shared/contracts';

  const DOT_STYLES: Record<PaneStatus, { slot: string; dot: string }> = {
    idle: {
      slot: 'hover:bg-foreground/10',
      dot: 'bg-foreground/40',
    },
    working: {
      slot: 'hover:bg-yellow-400/10',
      dot: 'bg-yellow-400',
    },
    input: {
      slot: 'hover:bg-orange-400/10',
      dot: 'bg-orange-400',
    },
    error: {
      slot: 'hover:bg-destructive/10',
      dot: 'bg-destructive',
    },
    done: {
      slot: 'hover:bg-success/10',
      dot: 'bg-success',
    },
  };
  const STATUS_LABELS: Record<PaneStatus, string> = {
    idle: 'idle',
    working: 'working',
    input: 'needs input',
    error: 'failed',
    done: 'done, not yet reviewed',
  };

  let {
    panels,
    ontogglePanel,
    onhelp,
    onaddPane,
    panes,
    canAddPane,
    canAddTerminal,
    startingProvider,
    onselectPane,
    onselectPanel,
    trafficLightInset = false,
  }: {
    /** The panels open ahead of the panes, in strip order. */
    panels: AppPanel[];
    ontogglePanel: (panel: AppPanel) => void;
    onhelp: () => void;
    /** Opens a pane of the chosen type at the front of the strip. */
    onaddPane: (type: PaneType) => void;
    /** The agent ⌘N opens; ⇧⌘N opens the other one. */
    startingProvider: AssistantProvider;
    panes: { id: string; title: string; status: PaneStatus }[];
    canAddPane: boolean;
    /** Whether the project has room for another terminal; the menu leaves terminals out otherwise. */
    canAddTerminal: boolean;
    onselectPane: (paneId: string) => void;
    /** Scrolls an open panel into sight. */
    onselectPanel: (panel: AppPanel) => void;
    /** Drops the logo below the native window controls. */
    trafficLightInset?: boolean;
  } = $props();

  /** The shortcut a tool pane's menu item shows; view panes are toggled from the header instead. */
  const TOOL_SHORTCUTS: Record<string, ShortcutId> = {
    terminal: 'newTerminal',
  };
  /** The tool panes a project can have several of. */
  const ADDABLE_TOOL_PANES = TOOL_PANES.filter(
    ({ type }) => !isViewPaneType(type),
  );
  const addableToolPanes = $derived(
    ADDABLE_TOOL_PANES.filter(
      ({ type }) => type !== 'terminal' || canAddTerminal,
    ),
  );

  const BUTTON_CLASS = 'text-muted-foreground hover:text-foreground';
  /** A minimap row: the dot sits in the first 24px so the collapsed pill shows only dots. */
  const ROW_CLASS =
    'flex h-6 w-full min-w-0 items-center gap-1.5 rounded-full pr-3 text-left text-sm text-foreground/90 outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring/60';
  const DOT_CLASS = 'size-2.5 rounded-full transition-colors duration-150';

  let logoHovered = $state(false);
  const working = $derived(panes.some(({ status }) => status === 'working'));

  /** The CLIs the update button would update, such as `Claude Code and Codex`. */
  const updateNames = $derived(
    [
      ...new Set(
        cliVersions.outdated.map(({ provider }) => CLI_NAMES[provider]),
      ),
    ].join(' and '),
  );

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
      <!-- Opts out of the drag region so the hover reaches it. -->
      <div
        role="presentation"
        class={cn(
          'app-no-drag grid size-8 place-content-center',
          trafficLightInset && 'translate-y-[55px]',
        )}
        onpointerenter={() => (logoHovered = true)}
        onpointerleave={() => (logoHovered = false)}
      >
        <Logo class="size-7" active={logoHovered || working} />
      </div>
    </div>
    <div
      class={cn(
        // Lifts the expanded minimap over the panes; the inset's transform would otherwise trap its z-index.
        'relative z-40 mt-3 flex flex-col items-center gap-3',
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
              class={BUTTON_CLASS}
              aria-label="Add pane"
            >
              <Icon name="add-pane" />
            </Button>
          {/snippet}
        </DropdownMenu.Trigger>
        <DropdownMenu.Content side="right" align="start" class="w-56">
          <DropdownMenu.Label>Agents</DropdownMenu.Label>
          {#each preferences.enabledProviders as provider (provider)}
            <DropdownMenu.Item onclick={() => onaddPane(provider)}>
              <Icon name={provider} />
              {PROVIDER_LABELS[provider]}
              <ShortcutKeys
                id={provider === startingProvider
                  ? 'newConversation'
                  : 'newOtherAgent'}
                class="ml-auto"
              />
            </DropdownMenu.Item>
          {/each}
          {#if addableToolPanes.length}
            <DropdownMenu.Separator />
          {/if}
          {#each addableToolPanes as pane (pane.type)}
            <DropdownMenu.Item onclick={() => onaddPane(pane.type)}>
              <Icon name={pane.icon} />
              {pane.label}
              <ShortcutKeys id={TOOL_SHORTCUTS[pane.type]} class="ml-auto" />
            </DropdownMenu.Item>
          {/each}
        </DropdownMenu.Content>
      </DropdownMenu.Root>
      {#if panes.length + panels.length > 0}
        <!-- Holds the collapsed width in the rail; the minimap overflows it rightward over the panes. -->
        <div class="minimap-slot relative z-40 w-7">
          <nav
            class="minimap flex w-max max-w-72 min-w-44 flex-col gap-0.5 rounded-2xl px-0.5 py-1"
            aria-label="Panes"
          >
            {#each openPanels as item (item.panel)}
              {@const style = DOT_STYLES.idle}
              <button
                type="button"
                class={cn(ROW_CLASS, style.slot)}
                aria-label={`Go to ${item.label}`}
                onclick={() => onselectPanel(item.panel)}
              >
                <span class="grid size-6 shrink-0 place-content-center">
                  <span class={cn(DOT_CLASS, style.dot)}></span>
                </span>
                <span class="minimap-label truncate">{item.label}</span>
              </button>
            {/each}
            {#each panes as pane (pane.id)}
              {@const style = DOT_STYLES[pane.status]}
              <button
                type="button"
                class={cn(ROW_CLASS, style.slot)}
                aria-label={`Go to ${pane.title} (${STATUS_LABELS[pane.status]})`}
                onclick={() => onselectPane(pane.id)}
              >
                <span class="grid size-6 shrink-0 place-content-center">
                  <span class={cn(DOT_CLASS, style.dot)}></span>
                </span>
                <!-- Finished turns awaiting review stand out, like unread mail. -->
                <span
                  class={cn(
                    'minimap-label truncate',
                    pane.status === 'done' && 'font-semibold text-foreground',
                  )}>{pane.title}</span
                >
              </button>
            {/each}
          </nav>
        </div>
      {/if}
    </div>
  </div>
  <div class="flex flex-col items-center gap-3.5">
    {#if cliVersions.outdated.length}
      {@render updateButton()}
    {/if}
    {#each PANELS as item (item.panel)}
      {@render panelButton(item)}
    {/each}
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
  </div>
</nav>

{#snippet updateButton()}
  <Tooltip.Root>
    <Tooltip.Trigger>
      {#snippet child({ props })}
        <Button
          {...props}
          size="icon"
          aria-label={`Update ${updateNames}`}
          loading={cliVersions.updating}
          disabled={cliVersions.updating}
          onclick={() => cliVersions.update()}
        >
          <Icon name="update" />
        </Button>
      {/snippet}
    </Tooltip.Trigger>
    <Tooltip.Content side="right">
      <div class="flex flex-col gap-0.5">
        <span>
          {cliVersions.updating
            ? `Updating ${updateNames}…`
            : `Update ${updateNames} to use Bonfire`}
        </span>
        {#each cliVersions.outdated as version (`${version.provider}:${version.machineId}`)}
          <span class="opacity-70">
            {CLI_NAMES[version.provider]} on {version.machineName}: {version.installed},
            needs {version.required}
          </span>
        {/each}
      </div>
    </Tooltip.Content>
  </Tooltip.Root>
{/snippet}

{#snippet panelButton(item: PanelItem)}
  {@const open = panels.includes(item.panel)}
  <Tooltip.Root>
    <Tooltip.Trigger>
      {#snippet child({ props })}
        <Button
          {...props}
          variant={open ? 'default' : 'secondary'}
          size="icon"
          class={cn(!open && BUTTON_CLASS)}
          aria-label={item.label}
          aria-pressed={open}
          onclick={() => ontogglePanel(item.panel)}
        >
          <Icon name={item.icon} />
        </Button>
      {/snippet}
    </Tooltip.Trigger>
    <Tooltip.Content side="right">
      {item.label}
      <ShortcutKeys id={item.shortcut} inverse />
    </Tooltip.Content>
  </Tooltip.Root>
{/snippet}

<style>
  /*
   * The minimap is always laid out at full width; a clip-path trims it to the
   * dot column. Hovering (or tabbing into) it reveals the titles by unclipping
   * rightward, over the panes, with no layout shift in the rail.
   */
  .minimap {
    --minimap-ease: cubic-bezier(0.32, 0.72, 0, 1);
    /* Glass rather than a solid fill, so it reads as floating over the pane it covers. */
    background-color: var(--color-secondary);
    backdrop-filter: blur(16px) saturate(1.4);
    box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0);
    clip-path: inset(0 calc(100% - 1.75rem) 0 0 round 0.875rem);
    /* Collapsing gets out of the way quicker than expanding. */
    transition:
      clip-path 180ms var(--minimap-ease),
      background-color 180ms ease,
      box-shadow 180ms ease;
  }

  .minimap:hover,
  .minimap:has(:focus-visible) {
    background-color: rgb(
      44 44 44 / 70%
    ); /* Mid-grey glass: mutes the blurred text behind without going black. */
    box-shadow: inset 0 0 0 1px rgb(255 255 255 / 8%);
    clip-path: inset(0 0 0 0 round 0.875rem);
    /* A beat of hover intent, so sweeping the cursor past doesn't flash it open. */
    transition:
      clip-path 280ms var(--minimap-ease) 60ms,
      background-color 200ms ease 60ms,
      box-shadow 200ms ease 60ms;
  }

  /* Labels fade in behind the reveal edge rather than being sliced by it. */
  .minimap-label {
    opacity: 0;
    transition: opacity 120ms ease;
  }

  .minimap:hover .minimap-label,
  .minimap:has(:focus-visible) .minimap-label {
    opacity: 1;
    transition: opacity 200ms ease 120ms;
  }

  @media (prefers-reduced-motion: reduce) {
    .minimap,
    .minimap:hover,
    .minimap:has(:focus-visible) {
      transition: none;
    }
  }
</style>
