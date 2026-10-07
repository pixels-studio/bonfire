<script lang="ts">
  import { Progress } from 'bits-ui';
  import { cn, formatReset } from '$lib/utils';
  import type { LimitWindow } from '$shared/contracts';

  const TONES = {
    normal: 'bg-foreground/70',
    warning: 'bg-brand',
    critical: 'bg-destructive',
  };

  let { window }: { window: LimitWindow } = $props();

  const used = $derived(Math.min(Math.max(window.usedPercent, 0), 100));
  const tone = $derived(
    TONES[used >= 90 ? 'critical' : used >= 70 ? 'warning' : 'normal'],
  );
</script>

<div class="flex flex-col gap-2 leading-none">
  <div class="flex items-baseline justify-between">
    <span>{window.label}</span>
    <span class="tabular-nums">{Math.round(used)}%</span>
  </div>
  <Progress.Root
    value={used}
    max={100}
    aria-label={`${window.label} limit used`}
    class="h-2 overflow-hidden bg-secondary"
  >
    <div
      class={cn(
        'bar-stripes h-full transition-[width] duration-200 ease-out motion-reduce:transition-none',
        tone,
      )}
      style:width={`${used}%`}
    ></div>
  </Progress.Root>
  {#if window.resetsAt}
    <span class="text-xs text-muted-foreground">
      Resets {formatReset(window.resetsAt)}
    </span>
  {/if}
</div>
