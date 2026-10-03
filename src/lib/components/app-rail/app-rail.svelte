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
  import * as Tooltip from '$lib/components/ui/tooltip';
  import Icon from '$lib/components/icon/icon.svelte';
  import { cn } from '$lib/utils';

  let {
    panel = $bindable(),
    onhelp,
  }: {
    /** The panel open ahead of the panes, if any. */
    panel?: AppPanel;
    onhelp: () => void;
  } = $props();

  const BUTTON_CLASS = 'text-muted-foreground hover:text-foreground';
</script>

<nav
  class="flex w-12 shrink-0 flex-col items-center justify-between pb-3"
  aria-label="App"
>
  <div class="app-drag grid h-13 w-full place-content-center">
    <img src="/logo.svg" alt="Bonfire" class="size-6" draggable="false" />
  </div>
  <div class="flex flex-col items-center gap-3">
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
      <Button
        variant={panel === item.panel ? 'default' : 'secondary'}
        size="icon"
        class={cn(panel !== item.panel && BUTTON_CLASS)}
        aria-label={item.label}
        aria-pressed={panel === item.panel}
        onclick={() => (panel = panel === item.panel ? undefined : item.panel)}
      >
        <Icon name={item.icon} />
      </Button>
    {/each}
  </div>
</nav>
