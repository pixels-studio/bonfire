<script lang="ts">
  import { overlayScrollbar } from '$lib/scrollbar';
  import { onMount } from 'svelte';
  import * as Card from '$lib/components/ui/card';
  import PaneHeader from '$lib/components/pane-header/pane-header.svelte';
  import type { PanelProps } from '$lib/panes';
  import { limits } from '$lib/stores/limits.svelte';
  import SegmentedControl from './segmented-control.svelte';
  import TokensTab from './tokens-tab.svelte';
  import UsageTab from './usage-tab.svelte';

  const TABS = [
    { value: 'tokens', label: 'Tokens' },
    { value: 'usage', label: 'Usage' },
  ];

  let {
    tab = $bindable('tokens'),
    dragHandle,
    size,
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
      <UsageTab />
    {:else}
      <TokensTab />
    {/if}
  </div>
</Card.Root>
