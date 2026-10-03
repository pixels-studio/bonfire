<script lang="ts">
  /** A small seeded random, so the sky is the same on every launch. */
  function random(seed: number) {
    return () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const next = random(11);
  const stars = Array.from({ length: 240 }, () => ({
    x: next() * 1440,
    y: next() * 720,
    r: 0.4 + next() * 0.6,
    /** How bright it gets at its peak. */
    peak: 0.1 + next() * 0.2,
    /** Slow, and out of step with its neighbours. */
    duration: 6 + next() * 8,
    delay: -next() * 14,
  }));
</script>

<!-- A night sky with the last glow of sunset. -->
<div
  class="pointer-events-none absolute inset-0 overflow-hidden"
  aria-hidden="true"
>
  <div class="sky absolute inset-0"></div>
  <svg
    class="stars absolute inset-x-0 top-0 h-[85%] w-full text-white"
    viewBox="0 0 1440 720"
    preserveAspectRatio="xMidYMin slice"
    fill="currentColor"
  >
    {#each stars as star, index (index)}
      <circle
        class="star"
        cx={star.x}
        cy={star.y}
        r={star.r}
        style="--peak:{star.peak};--duration:{star.duration}s;--delay:{star.delay}s"
      />
    {/each}
  </svg>
</div>

<style>
  .sky {
    background: linear-gradient(
      to top,
      color-mix(in oklab, var(--color-brand) 20%, #070606) 0%,
      color-mix(in oklab, var(--color-brand) 8%, #0a0909) 24%,
      color-mix(in oklab, var(--color-background) 75%, black) 62%
    );
  }
  /* The stars thin out as the sunset glow rises. */
  .stars {
    mask-image: linear-gradient(to bottom, black 55%, transparent 100%);
  }
  .star {
    opacity: var(--peak);
  }
  @media (prefers-reduced-motion: no-preference) {
    .star {
      animation: twinkle var(--duration) ease-in-out var(--delay) infinite;
    }
  }
  @keyframes twinkle {
    0%,
    100% {
      opacity: calc(var(--peak) * 0.25);
    }
    50% {
      opacity: var(--peak);
    }
  }
</style>
