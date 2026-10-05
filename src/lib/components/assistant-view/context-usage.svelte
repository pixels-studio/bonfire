<script lang="ts">
  import * as Popover from '$lib/components/ui/popover';
  import { cn, formatTokens } from '$lib/utils';
  import type { Usage } from '$shared/contracts';

  const RING_RADIUS = 7;
  const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;
  const TONES = {
    normal: { stroke: 'stroke-muted-foreground', fill: 'bg-muted-foreground' },
    warning: { stroke: 'stroke-orange-500', fill: 'bg-orange-500' },
    critical: { stroke: 'stroke-destructive', fill: 'bg-destructive' },
  };

  let {
    usage,
    contextWindow,
    disabled = false,
    oncompact,
  }: {
    usage?: Usage;
    /** Left unset until the provider reports the real window size; never guessed. */
    contextWindow?: number;
    /** Compacting needs an idle pane. */
    disabled?: boolean;
    /** Offered only for providers that can compact on request. */
    oncompact?: () => void;
  } = $props();
  let open = $state(false);

  /** The whole gauge stays hidden until both the usage and the real window size are known. */
  const known = $derived(!!usage && !!contextWindow);

  const usedTokens = $derived(
    usage
      ? usage.inputTokens +
          usage.cachedInputTokens +
          usage.outputTokens +
          usage.reasoningOutputTokens
      : 0,
  );
  const usedRatio = $derived(
    contextWindow ? Math.min(usedTokens / contextWindow, 1) : 0,
  );
  const tone = $derived(
    TONES[
      usedRatio >= 0.75 ? 'critical' : usedRatio >= 0.5 ? 'warning' : 'normal'
    ],
  );
  const sections = $derived(
    usage
      ? [
          {
            title: 'Input',
            rows: [
              { label: 'New', tokens: usage.inputTokens },
              { label: 'Cached', tokens: usage.cachedInputTokens },
            ],
          },
          {
            title: 'Output',
            rows: [
              { label: 'Response', tokens: usage.outputTokens },
              { label: 'Reasoning', tokens: usage.reasoningOutputTokens },
            ],
          },
        ]
      : [],
  );

  function percentOfContext(tokens: number) {
    if (!contextWindow || tokens <= 0) return '0%';
    const percent = Math.min((tokens / contextWindow) * 100, 100);
    return percent < 1 ? '<1%' : `${Math.round(percent)}%`;
  }
</script>

{#if known}
  <Popover.Root bind:open>
    <Popover.Trigger
      class="grid shrink-0 place-items-center p-1"
      aria-label={`${formatTokens(usedTokens)} of ${formatTokens(contextWindow!)} tokens used`}
    >
      <svg class="size-4 -rotate-90" viewBox="0 0 18 18" aria-hidden="true">
        <circle
          class="fill-none stroke-muted"
          cx="9"
          cy="9"
          r={RING_RADIUS}
          stroke-width="2.5"
        />
        <circle
          class={cn(
            'fill-none transition-all duration-200 ease-out',
            tone.stroke,
          )}
          cx="9"
          cy="9"
          r={RING_RADIUS}
          stroke-width="2.5"
          stroke-linecap="round"
          stroke-dasharray={RING_CIRCUMFERENCE}
          stroke-dashoffset={RING_CIRCUMFERENCE * (1 - usedRatio)}
        />
      </svg>
    </Popover.Trigger>
    <Popover.Content class="w-60 gap-4 p-4" align="end" side="top">
      <div class="flex flex-col gap-1.5">
        <div class="flex items-center justify-between">
          <span>Total usage</span>
          {#if oncompact}
            <button
              type="button"
              class="text-sm text-brand transition-opacity hover:underline disabled:pointer-events-none disabled:opacity-50"
              {disabled}
              onclick={() => {
                open = false;
                oncompact();
              }}
            >
              Compact
            </button>
          {/if}
        </div>
        <div class="h-1 overflow-hidden rounded-full bg-secondary">
          <div
            class={cn(
              'h-full rounded-full transition-all duration-200 ease-out',
              tone.fill,
            )}
            style:width={`${usedRatio * 100}%`}
          ></div>
        </div>
        <span class="whitespace-nowrap text-muted-foreground tabular-nums">
          {formatTokens(usedTokens)} / {formatTokens(contextWindow!)} · {percentOfContext(
            usedTokens,
          )}
        </span>
      </div>
      {#each sections as section (section.title)}
        <div class="flex flex-col">
          <p
            class="mb-0.5 text-xs tracking-wide text-muted-foreground uppercase"
          >
            {section.title}
          </p>
          {#each section.rows as row (row.label)}
            <div class="flex justify-between py-0.5">
              <span>{row.label}</span>
              <span class="text-muted-foreground tabular-nums"
                >{percentOfContext(row.tokens)}</span
              >
            </div>
          {/each}
        </div>
      {/each}
    </Popover.Content>
  </Popover.Root>
{/if}
