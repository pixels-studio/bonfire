<script lang="ts">
  import { LineChart } from 'layerchart';
  import { curveMonotoneX } from 'd3-shape';
  import { scaleTime } from 'd3-scale';
  import * as Chart from '$lib/components/ui/chart';
  import { PROVIDERS } from '$lib/models';
  import { formatCompact } from '$lib/utils';
  import type {
    AssistantProvider,
    TokenRange,
    TokenStats,
  } from '$shared/contracts';
  import { PROVIDER_LABELS } from '$shared/domain';

  let { series, range }: { series: TokenStats['series']; range: TokenRange } =
    $props();

  const config = {
    claude: { label: PROVIDER_LABELS.claude, color: 'var(--color-foreground)' },
    codex: {
      label: PROVIDER_LABELS.codex,
      color: 'var(--color-muted-foreground)',
    },
  } satisfies Chart.ChartConfig;

  const LEGEND = ['codex', 'claude'] as const;

  const data = $derived(
    series.map(({ at, claude, codex }) => ({
      date: new Date(at),
      claude,
      codex,
    })),
  );
  const formatTick = $derived(
    range === 'today'
      ? (date: Date) => date.toLocaleTimeString(undefined, { hour: 'numeric' })
      : (date: Date) =>
          date.toLocaleDateString(undefined, {
            month: 'short',
            day: 'numeric',
          }),
  );
</script>

<div class="flex flex-col gap-4">
  <div class="flex items-center justify-between">
    <h3 class="font-medium">
      {range === 'today' ? 'Hourly' : 'Daily'} processed tokens
    </h3>
    <ul class="flex items-center gap-6 text-xs text-muted-foreground">
      {#each LEGEND as provider (provider)}
        <li class="flex items-center gap-1.5">
          <span class="h-3 w-1" style:background-color={config[provider].color}
          ></span>
          {config[provider].label}
        </li>
      {/each}
    </ul>
  </div>
  <Chart.Container {config} class="aspect-auto h-32 w-full">
    <LineChart
      {data}
      x="date"
      xScale={scaleTime()}
      padding={{ top: 8, right: 16, bottom: 24, left: 16 }}
      axis="x"
      series={PROVIDERS.map((provider) => ({
        key: provider,
        label: config[provider].label,
        color: `var(--color-${provider})`,
      }))}
      props={{
        // Layerchart fades every other line to 10% while one is highlighted, and Codex's sits on the baseline.
        spline: { curve: curveMonotoneX, class: 'stroke-2', opacity: 1 },
        xAxis: { ticks: 4, format: formatTick },
      }}
    >
      {#snippet tooltip()}
        <Chart.Tooltip
          labelFormatter={(date: Date) =>
            date.toLocaleString(
              undefined,
              range === 'today'
                ? { hour: 'numeric' }
                : { month: 'short', day: 'numeric' },
            )}
          formatter={tooltipRow}
        />
      {/snippet}
    </LineChart>
  </Chart.Container>
</div>

{#snippet tooltipRow({
  value,
  name,
  item,
}: {
  value: unknown;
  name: string;
  item: { key: string };
})}
  <!-- The tooltip renders outside the chart, where `--color-<series>` isn't defined, so use the config colour. -->
  <span
    class="h-3 w-1 shrink-0"
    style:background-color={config[item.key as AssistantProvider].color}
  ></span>
  <span class="flex flex-1 justify-between gap-4 leading-none">
    <span class="text-muted-foreground">{name}</span>
    <span class="font-medium tabular-nums">{formatCompact(Number(value))}</span>
  </span>
{/snippet}
