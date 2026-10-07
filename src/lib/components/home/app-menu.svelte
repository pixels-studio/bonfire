<script lang="ts" module>
  import type { ShortcutId } from '$lib/shortcuts';

  /** A view that opens over the app from the header. */
  export type AppPanel = 'insights' | 'settings' | 'shortcuts';

  const PANEL_ITEMS: {
    panel: AppPanel;
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
  import ShortcutKeys from '$lib/components/shortcuts/shortcut-keys.svelte';
  import { cliVersions } from '$lib/stores/cli-versions.svelte';
  import { cn } from '$lib/utils';
  import { CLI_NAMES } from '$shared/domain';

  let {
    panel,
    onpanel,
    onhelp,
  }: {
    /** The panel open over the app, if any. */
    panel?: AppPanel;
    onpanel: (panel: AppPanel) => void;
    onhelp: () => void;
  } = $props();

  /** The CLIs the update button would update, such as `Claude Code and Codex`. */
  const updateNames = $derived(
    [
      ...new Set(
        cliVersions.outdated.map(({ provider }) => CLI_NAMES[provider]),
      ),
    ].join(' and '),
  );

  const BUTTON_CLASS = 'text-muted-foreground hover:text-foreground';
</script>

<div
  class="flex items-center gap-4 app-no-drag"
  role="toolbar"
  aria-label="App"
>
  {#if cliVersions.outdated.length}
    <Tooltip.Root>
      <Tooltip.Trigger>
        {#snippet child({ props })}
          <Button
            {...props}
            size="icon-sm"
            aria-label={`Update ${updateNames}`}
            loading={cliVersions.updating}
            disabled={cliVersions.updating}
            onclick={() => cliVersions.update()}
          >
            <Icon name="update" />
          </Button>
        {/snippet}
      </Tooltip.Trigger>
      <Tooltip.Content side="bottom">
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
    {@const pressed = panel === item.panel}
    <Tooltip.Root>
      <Tooltip.Trigger>
        {#snippet child({ props })}
          <Button
            {...props}
            variant={pressed ? 'default' : 'secondary'}
            size="icon-sm"
            class={cn(!pressed && BUTTON_CLASS)}
            aria-label={item.label}
            aria-pressed={pressed}
            onclick={() => onpanel(item.panel)}
          >
            <Icon name={item.icon} />
          </Button>
        {/snippet}
      </Tooltip.Trigger>
      <Tooltip.Content side="bottom">
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
          size="icon-sm"
          class={BUTTON_CLASS}
          aria-label="Help"
          onclick={onhelp}
        >
          <Icon name="help" />
        </Button>
      {/snippet}
    </Tooltip.Trigger>
    <Tooltip.Content side="bottom">Help</Tooltip.Content>
  </Tooltip.Root>
</div>
