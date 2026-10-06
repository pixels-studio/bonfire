<script lang="ts" module>
  import type { ShortcutId } from '$lib/shortcuts';

  /** A view that opens over the workspace from the rail. */
  export type RailPanel = 'insights' | 'settings' | 'shortcuts';

  const PANEL_ITEMS: {
    panel: RailPanel;
    icon: string;
    label: string;
    shortcut: ShortcutId;
  }[] = [
    {
      panel: 'insights',
      icon: 'insights',
      label: 'Insights',
      shortcut: 'insights',
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
  import * as Tooltip from '$lib/components/ui/tooltip';
  import Icon from '$lib/components/icon/icon.svelte';
  import Logo from '$lib/components/logo/logo.svelte';
  import ShortcutKeys from '$lib/components/shortcuts/shortcut-keys.svelte';
  import { cliVersions } from '$lib/stores/cli-versions.svelte';
  import { cn } from '$lib/utils';
  import { CLI_NAMES } from '$shared/domain';

  let {
    open,
    ontoggle,
    onhelp,
    working = false,
    trafficLightInset = false,
  }: {
    /** The panel open over the workspace, if any. */
    open?: RailPanel;
    ontoggle: (panel: RailPanel) => void;
    onhelp: () => void;
    /** Whether an agent is working, which stirs the logo's flame. */
    working?: boolean;
    /** Drops the logo below the native window controls. */
    trafficLightInset?: boolean;
  } = $props();

  const BUTTON_CLASS = 'text-muted-foreground hover:text-foreground';

  let logoHovered = $state(false);

  /** The CLIs the update button would update, such as `Claude Code and Codex`. */
  const updateNames = $derived(
    [
      ...new Set(
        cliVersions.outdated.map(({ provider }) => CLI_NAMES[provider]),
      ),
    ].join(' and '),
  );
</script>

<nav
  class="flex w-12 shrink-0 flex-col items-center justify-between pb-6"
  aria-label="App"
>
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
  <div class="flex flex-col items-center gap-3.5">
    {#if cliVersions.outdated.length}
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
    {/if}
    {#each PANEL_ITEMS as item (item.panel)}
      {@const pressed = open === item.panel}
      <Tooltip.Root>
        <Tooltip.Trigger>
          {#snippet child({ props })}
            <Button
              {...props}
              variant={pressed ? 'default' : 'secondary'}
              size="icon"
              class={cn(!pressed && BUTTON_CLASS)}
              aria-label={item.label}
              aria-pressed={pressed}
              onclick={() => ontoggle(item.panel)}
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
