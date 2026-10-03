<script lang="ts">
  import * as Card from '$lib/components/ui/card';
  import PaneHeader from '$lib/components/pane-header/pane-header.svelte';
  import type { PaneSize } from '$lib/panes';
  import PullRequestPane from './pull-request-pane.svelte';

  let {
    projectId,
    onresize,
    onclose,
  }: {
    projectId: string;
    onresize: (size: PaneSize) => void;
    onclose: () => void;
  } = $props();
</script>

<Card.Root class="h-full min-w-0">
  <PaneHeader title="Pull request" icon="git" {onresize} {onclose} />
  <div class="relative min-h-0 flex-1">
    {#key projectId}
      <PullRequestPane {projectId} />
    {/key}
  </div>
</Card.Root>
