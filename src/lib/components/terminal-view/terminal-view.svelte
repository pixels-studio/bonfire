<script lang="ts">
  import * as Card from '$lib/components/ui/card';
  import PaneHeader from '$lib/components/pane-header/pane-header.svelte';
  import { toolPaneIcon, type PaneProps } from '$lib/panes';

  let {
    projectId,
    paneId,
    title,
    dragHandle,
    onresize,
    onclose,
  }: PaneProps & { projectId: string; paneId: string; title: string } =
    $props();
</script>

<Card.Root class="h-full min-w-0">
  <PaneHeader
    {title}
    icon={toolPaneIcon('terminal')}
    {dragHandle}
    {onresize}
    {onclose}
  />
  <div class="relative min-h-0 flex-1">
    <!-- xterm is only loaded once a terminal is opened. -->
    {#await import('./terminal-session.svelte') then { default: TerminalSession }}
      <TerminalSession {projectId} {paneId} />
    {/await}
  </div>
</Card.Root>
