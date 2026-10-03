<script lang="ts">
  import { onMount } from 'svelte';
  import * as Card from '$lib/components/ui/card';
  import Icon from '$lib/components/icon/icon.svelte';
  import { limits } from '$lib/stores/limits.svelte';
  import SegmentedControl from './segmented-control.svelte';
  import TokenRangeSelect from './token-range-select.svelte';
  import TokensTab from './tokens-tab.svelte';
  import UsageTab from './usage-tab.svelte';

  const TABS = [
    { value: 'tokens', label: 'Tokens' },
    { value: 'usage', label: 'Usage' },
  ];

  let tab = $state(TABS[0].value);

  onMount(() => void limits.refresh());
</script>

<Card.Root class="h-full min-w-0 gap-0">
  <header class="flex h-13.5 shrink-0 items-center justify-between gap-3 px-4">
    <div class="flex min-w-0 items-center gap-1">
      <h2 class="flex items-center gap-2 text-sm font-semibold">
        <Icon name="insights" class="text-muted-foreground" />
        Insights
      </h2>
      {#if tab === 'tokens'}
        <TokenRangeSelect />
      {/if}
    </div>
    <SegmentedControl
      items={TABS}
      bind:value={tab}
      variant="text"
      aria-label="Insights"
    />
  </header>
  <div class="min-h-0 flex-1 overflow-y-auto">
    {#if tab === 'usage'}
      <UsageTab />
    {:else}
      <TokensTab />
    {/if}
  </div>
</Card.Root>
