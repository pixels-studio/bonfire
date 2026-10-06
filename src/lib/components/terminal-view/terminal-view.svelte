<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import * as Card from '$lib/components/ui/card';
  import Icon from '$lib/components/icon/icon.svelte';
  import PaneHeader from '$lib/components/pane-header/pane-header.svelte';
  import { toolPaneIcon, type PaneProps } from '$lib/panes';
  import { scripts } from '$lib/stores/scripts.svelte';

  let {
    workspaceId,
    paneId,
    scriptId,
    title,
    dragHandle,
    size,
    onresize,
    onclose,
    onrename,
  }: PaneProps & {
    workspaceId: string;
    paneId: string;
    /** Set for a pane that shows a run script's output rather than a shell. */
    scriptId?: string;
    title: string;
  } = $props();

  const run = $derived(scriptId ? scripts.runOfPane(paneId) : undefined);
  const pending = $derived(!!scriptId && !!scripts.pending[scriptId]);
  /** Whether the script still exists, so it can be run again from here. */
  const known = $derived(
    !!scriptId && !!scripts.list?.some(({ id }) => id === scriptId),
  );
</script>

{#snippet scriptActions()}
  {#if scriptId && known}
    {#if run?.running}
      <Button
        size="default"
        variant="secondary"
        class="leading-4 text-foreground"
        loading={pending}
        title={`Stop ${title}`}
        onclick={() => void scripts.stop(scriptId)}
      >
        <Icon name="stop" class="size-2.5 text-destructive" /> Stop
      </Button>
    {:else}
      <Button
        size="default"
        variant="secondary"
        class="leading-4 text-foreground"
        loading={pending}
        title={`Run ${title}`}
        onclick={() => void scripts.run(scriptId)}
      >
        <Icon name="play" class="size-3" />
        {run ? 'Run again' : 'Run'}
      </Button>
    {/if}
  {/if}
{/snippet}

<Card.Root class="h-full min-w-0">
  <PaneHeader
    {title}
    icon={toolPaneIcon('terminal')}
    actions={scriptId ? scriptActions : undefined}
    {dragHandle}
    {size}
    {onresize}
    {onclose}
    {onrename}
  />
  <div class="relative min-h-0 flex-1">
    <!-- xterm is only loaded once a terminal is opened. -->
    {#await import('./terminal-session.svelte') then { default: TerminalSession }}
      <TerminalSession {workspaceId} {paneId} {scriptId} />
    {/await}
  </div>
</Card.Root>
