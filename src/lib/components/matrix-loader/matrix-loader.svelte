<script lang="ts" module>
  /**
   * How the pulse travels the grid: a column sweep, a scattered twinkle, a ring circling a
   * still centre, or the centre breathing outward.
   */
  export type MatrixVariant = 'scan' | 'twinkle' | 'orbit' | 'pulse';

  const CORNERS = [0, 3, 12, 15];
  /** The corner-less perimeter, clockwise. */
  const RING = [1, 2, 7, 11, 14, 13, 8, 4];
  const INNER = [5, 6, 9, 10];
  /** A fixed order rather than random, so every dot fires exactly once a cycle. */
  const TWINKLE = [7, 2, 11, 5, 14, 9, 0, 12, 3, 15, 6, 10, 13, 1, 8, 4];

  /** Each dot's delay into the shared pulse, in ms; `null` holds the dot still. */
  function delayFor(variant: MatrixVariant, index: number, cycle: number) {
    switch (variant) {
      case 'scan':
        return Math.round((index % 4) * (cycle / 10));
      case 'twinkle':
        return Math.round(TWINKLE[index] * (cycle / 16));
      case 'orbit': {
        const step = RING.indexOf(index);
        return step === -1 ? null : Math.round(step * (cycle / 8));
      }
      case 'pulse':
        return INNER.includes(index) ? 0 : Math.round(cycle * 0.16);
    }
  }
</script>

<script lang="ts">
  import { cn } from '$lib/utils';

  /**
   * A 4×4 grid of dots pulsing in turn, after transitions.dev's matrix dot loader. Decorative:
   * pair it with text that says what's loading.
   */
  let {
    variant = 'scan',
    rounded = false,
    cycle = 1200,
    size = 'md',
    class: className,
  }: {
    variant?: MatrixVariant;
    /** Drops the four corner dots. */
    rounded?: boolean;
    /** One full pulse, in ms. */
    cycle?: number;
    /** Dot scale: `sm` is one step down from the default `md`. */
    size?: 'sm' | 'md';
    class?: string;
  } = $props();

  const dots = $derived(
    Array.from({ length: 16 }, (_, index) =>
      rounded && CORNERS.includes(index)
        ? ('gap' as const)
        : delayFor(variant, index, cycle),
    ),
  );
</script>

<span
  class={cn('matrix', size === 'sm' && 'sm', className)}
  style:--matrix-cycle={`${cycle}ms`}
  aria-hidden="true"
>
  {#each dots as delay, index (index)}
    <i
      class:gap={delay === 'gap'}
      class:still={delay === null}
      style:animation-delay={typeof delay === 'number' ? `${delay}ms` : null}
    ></i>
  {/each}
</span>

<style>
  .matrix {
    display: inline-grid;
    flex-shrink: 0;
    --matrix-dot: 2px;
    grid-template-columns: repeat(4, var(--matrix-dot));
    grid-auto-rows: var(--matrix-dot);
    gap: var(--matrix-dot);
    --matrix-base: color-mix(
      in oklab,
      var(--color-muted-foreground) 30%,
      transparent
    );
    --matrix-active: var(--color-foreground);
  }

  .matrix.sm {
    --matrix-dot: 1.5px;
  }

  i {
    display: block;
    border-radius: 0.5px;
    background-color: var(--matrix-base);
    animation: matrix-pulse var(--matrix-cycle) ease-in-out infinite;
  }

  i.gap {
    visibility: hidden;
    animation: none;
  }

  i.still {
    animation: none;
  }

  @keyframes matrix-pulse {
    0%,
    45%,
    100% {
      background-color: var(--matrix-base);
    }
    15% {
      background-color: var(--matrix-active);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    i {
      animation: none;
      background-color: var(--color-muted-foreground);
    }
  }
</style>
