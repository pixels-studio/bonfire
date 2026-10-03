<script lang="ts">
  import { onMount } from 'svelte';
  import * as Select from '$lib/components/ui/select';
  import { tokens } from '$lib/stores/tokens.svelte';
  import type { TokenRange } from '$shared/contracts';
  import TokenBreakdown from './token-breakdown.svelte';
  import TokenChart from './token-chart.svelte';
  import TokenStatsGrid from './token-stats.svelte';
  import TokensSkeleton from './tokens-skeleton.svelte';

  const RANGES: { value: TokenRange; label: string }[] = [
    { value: 'today', label: 'Today' },
    { value: '7d', label: '7 days' },
    { value: '30d', label: '30 days' },
  ];

  const entry = $derived(tokens.current);

  onMount(() => tokens.refresh());
</script>

<div class="divide-y divide-border">
  <section class="flex flex-col gap-5 px-4 py-6">
    <Select.Root
      type="single"
      items={RANGES}
      value={tokens.range}
      onValueChange={(value) => tokens.select(value as TokenRange)}
    >
      <Select.Trigger
        aria-label="Time range"
        class="-ml-2 h-auto border-0 bg-transparent px-2 py-1 hover:bg-secondary dark:bg-transparent dark:hover:bg-secondary"
      >
        <Select.Value placeholder="Today" />
      </Select.Trigger>
      <Select.Content>
        {#each RANGES as range (range.value)}
          <Select.Item value={range.value} label={range.label}>
            {range.label}
          </Select.Item>
        {/each}
      </Select.Content>
    </Select.Root>
    {#if entry.stats}
      <TokenStatsGrid totals={entry.stats.totals} />
    {:else if entry.error}
      <p class="text-muted-foreground">{entry.error}</p>
    {:else}
      <TokensSkeleton part="stats" />
    {/if}
  </section>
  {#if entry.stats}
    <section class="px-4 py-6">
      <TokenChart series={entry.stats.series} range={tokens.range} />
    </section>
    <section class="px-4 py-6">
      <TokenBreakdown models={entry.stats.models} days={entry.stats.days} />
    </section>
  {:else if !entry.error}
    <TokensSkeleton part="rest" />
  {/if}
</div>
