<script lang="ts">
  import Icon from '$lib/components/icon/icon.svelte';
  import { cn, formatCompact, formatUsd } from '$lib/utils';
  import type { TokenRow } from '$shared/contracts';
  import SegmentedControl from './segmented-control.svelte';

  const VIEWS = [
    { value: 'model', label: 'Model' },
    { value: 'day', label: 'Day' },
  ];

  let { models, days }: { models: TokenRow[]; days: TokenRow[] } = $props();
  let view = $state('model');

  const rows = $derived(view === 'model' ? models : days);
  function dayLabel(key: string) {
    const [year, month, day] = key.split('-').map(Number);
    return new Date(year, month - 1, day).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
    });
  }
</script>

<div class="flex flex-col gap-6">
  <div class="flex items-center justify-between">
    <h3 class="font-medium">Breakdown</h3>
    <SegmentedControl
      items={VIEWS}
      bind:value={view}
      variant="text"
      aria-label="Group breakdown by"
    />
  </div>
  <table class="w-full table-fixed text-left">
    <thead class="text-xs text-muted-foreground">
      <tr class="border-b border-border">
        <th class="pb-2 font-normal">{view === 'model' ? 'Model' : 'Day'}</th>
        <th class="w-20 pb-2 text-right font-normal">Cost</th>
        <th class="w-16 pb-2 text-right font-normal">Tokens</th>
      </tr>
    </thead>
    <tbody>
      {#each rows as row (row.key)}
        <tr class="border-b border-border last:border-b-0">
          <td class="py-2.5 pr-2">
            <span class="flex items-center gap-2">
              {#if row.provider}
                <Icon
                  name={row.provider}
                  class={cn(
                    'size-3.5 shrink-0',
                    row.provider === 'claude' && 'text-brand',
                  )}
                />
              {/if}
              <span class="truncate">
                {view === 'model' ? row.key : dayLabel(row.key)}
              </span>
            </span>
          </td>
          <td class="py-2.5 text-right tabular-nums">
            {#if row.cost === null}
              <span class="text-muted-foreground">Unpriced</span>
            {:else}
              {formatUsd(row.cost)}
            {/if}
          </td>
          <td class="py-2.5 text-right text-muted-foreground tabular-nums">
            {formatCompact(row.tokens)}
          </td>
        </tr>
      {:else}
        <tr>
          <td colspan="3" class="py-4 text-muted-foreground">
            No usage in this range.
          </td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>
