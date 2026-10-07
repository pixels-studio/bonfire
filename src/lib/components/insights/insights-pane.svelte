<script lang="ts">
  import { overlayScrollbar } from '$lib/scrollbar';
  import * as Card from '$lib/components/ui/card';
  import PaneHeader from '$lib/components/pane-header/pane-header.svelte';
  import type { PanelProps } from '$lib/panes';
  import SegmentedControl from './segmented-control.svelte';
  import TokensTab from './tokens-tab.svelte';
  import UsageTab from './usage-tab.svelte';

  const TABS = [
    { value: 'tokens', label: 'Tokens' },
    { value: 'usage', label: 'Usage' },
  ];

  let {
    tab = $bindable('tokens'),
    working = false,
    dragHandle,
    size,
    onresize,
    onclose,
  }: {
    tab?: string;
    /** Whether any agent is at work; usage is only checked on between turns then. */
    working?: boolean;
  } & PanelProps = $props();
</script>

<Card.Root class="h-full min-w-0 gap-0">
  <PaneHeader
    title="Insights"
    icon="insights"
    {dragHandle}
    {size}
    {onresize}
    {onclose}
    resizable={false}
  >
    {#snippet actions()}
      <SegmentedControl
        items={TABS}
        bind:value={tab}
        compact
        aria-label="Insights"
      />
    {/snippet}
  </PaneHeader>
  <div {@attach overlayScrollbar} class="min-h-0 flex-1 overflow-y-auto">
    {#if tab === 'usage'}
      <UsageTab {working} />
    {:else}
      <TokensTab {working} />
    {/if}
  </div>
</Card.Root>
