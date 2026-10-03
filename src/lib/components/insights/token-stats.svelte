<script lang="ts">
  import { formatCompact, formatUsd } from '$lib/utils';
  import type { TokenStats } from '$shared/contracts';

  let { totals }: { totals: TokenStats['totals'] } = $props();

  const stats = $derived([
    { label: 'Processed tokens', value: formatCompact(totals.processed) },
    { label: 'Cached input', value: formatCompact(totals.cachedInput) },
    { label: 'Uncached input', value: formatCompact(totals.uncachedInput) },
    { label: 'Output', value: formatCompact(totals.output) },
    { label: 'Cache savings', value: formatUsd(totals.cacheSavings) },
  ]);
</script>

<dl class="grid grid-cols-3 gap-x-4 gap-y-5">
  {#each stats as stat (stat.label)}
    <div class="flex flex-col leading-none">
      <dt class="text-xs text-muted-foreground">{stat.label}</dt>
      <dd class="text-lg tabular-nums">{stat.value}</dd>
    </div>
  {/each}
</dl>
