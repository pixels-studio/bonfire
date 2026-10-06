<script lang="ts">
  import * as Card from '$lib/components/ui/card';
  import PaneHeader from '$lib/components/pane-header/pane-header.svelte';
  import type { PaneSize } from '$lib/panes';
  import PullRequestPane from './pull-request-pane.svelte';

  let {
    projectId,
    size,
    onresize,
    onclose,
  }: {
    projectId: string;
    size: PaneSize;
    onresize: (size: PaneSize) => void;
    onclose: () => void;
  } = $props();
</script>

<Card.Root class="h-full min-w-0">
  <PaneHeader title="Pull request" icon="git" {size} {onresize} {onclose} />
  <div class="relative min-h-0 flex-1">
    {#key projectId}
      <PullRequestPane {projectId} />
    {/key}
  </div>
</Card.Root>
