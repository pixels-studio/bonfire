<script lang="ts">
  import { overlayScrollbar } from '$lib/scrollbar';
  import { onMount } from 'svelte';
  import * as Card from '$lib/components/ui/card';
  import PaneHeader from '$lib/components/pane-header/pane-header.svelte';
  import type { PanelProps } from '$lib/panes';
  import { limits } from '$lib/stores/limits.svelte';
  import SegmentedControl from './segmented-control.svelte';
  import TokenRangeSelect from './token-range-select.svelte';
  import TokensTab from './tokens-tab.svelte';
  import UsageTab from './usage-tab.svelte';

  const TABS = [
    { value: 'tokens', label: 'Tokens' },
    { value: 'usage', label: 'Usage' },
  ];

  let {
    tab = $bindable('tokens'),
    dragHandle,
    onresize,
    onclose,
  }: { tab?: string } & PanelProps = $props();

  onMount(() => void limits.refresh());
</script>

<Card.Root class="h-full min-w-0 gap-0">
  <PaneHeader
    title="Insights"
    icon="insights"
    {dragHandle}
    {onresize}
    {onclose}
  >
    {#snippet actions()}
      {#if tab === 'tokens'}
        <TokenRangeSelect />
      {/if}
      <SegmentedControl
        items={TABS}
        bind:value={tab}
        variant="text"
        aria-label="Insights"
      />
    {/snippet}
  </PaneHeader>
  <div {@attach overlayScrollbar} class="min-h-0 flex-1 overflow-y-auto">
    {#if tab === 'usage'}
      <UsageTab />
    {:else}
      <TokensTab />
    {/if}
  </div>
</Card.Root>
