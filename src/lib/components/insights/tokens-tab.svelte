<script lang="ts">
  import { onMount } from 'svelte';
  import { tokens } from '$lib/stores/tokens.svelte';
  import TokenBreakdown from './token-breakdown.svelte';
  import TokenChart from './token-chart.svelte';
  import TokenStatsGrid from './token-stats.svelte';
  import TokensSkeleton from './tokens-skeleton.svelte';

  const entry = $derived(tokens.current);

  onMount(() => tokens.refresh());
</script>

<div class="divide-y divide-border">
  <section class="px-4 py-6">
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
