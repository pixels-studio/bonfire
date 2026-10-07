<script lang="ts">
  import { Slider as SliderPrimitive } from 'bits-ui';
  import { EFFORT_LEVELS } from '$lib/models';
  import type { ReasoningEffort } from '$shared/contracts';

  /** Stars streaming across the track: height-wise position (%), length, speed and phase. */
  const STARS = [
    { top: 18, length: 10, duration: 1.75, delay: -0.25 },
    { top: 72, length: 14, duration: 1.38, delay: -1 },
    { top: 45, length: 6, duration: 2.75, delay: -2 },
    { top: 28, length: 8, duration: 2.25, delay: -0.75 },
    { top: 82, length: 5, duration: 3.25, delay: -2.5 },
    { top: 55, length: 16, duration: 1.25, delay: -0.5 },
    { top: 10, length: 6, duration: 3, delay: -1.5 },
    { top: 62, length: 9, duration: 2, delay: -1.75 },
    { top: 36, length: 12, duration: 1.62, delay: -1.25 },
    { top: 88, length: 7, duration: 2.5, delay: -2.25 },
  ];

  let { value = $bindable() }: { value: ReasoningEffort } = $props();

  const last = EFFORT_LEVELS.length - 1;
  const index = $derived(
    Math.max(
      0,
      EFFORT_LEVELS.findIndex((level) => level.value === value),
    ),
  );
  const atMax = $derived(index === last);
</script>

<SliderPrimitive.Root
  type="single"
  aria-label="Thinking effort"
  bind:value={() => index, (next) => (value = EFFORT_LEVELS[next].value)}
  min={0}
  max={last}
  step={1}
  data-max={atMax || undefined}
  class="group/effort relative flex h-7 w-full touch-none items-center select-none"
>
  {#snippet children({ thumbItems, tickItems })}
    <span
      class="effort-track relative h-4 grow overflow-hidden rounded-full bg-muted"
    >
      <SliderPrimitive.Range class="absolute h-full bg-primary" />
      <span
        class="effort-max-gradient absolute inset-0 opacity-0 transition-opacity duration-300 group-data-max/effort:opacity-100"
        aria-hidden="true"
      >
        {#if atMax}
          {#each STARS as star, position (position)}
            <span
              class="effort-star"
              style:top={`${star.top}%`}
              style:width={`${star.length}px`}
              style:animation-duration={`${star.duration}s`}
              style:animation-delay={`${star.delay}s`}
            ></span>
          {/each}
        {/if}
      </span>
    </span>
    {#each tickItems as tick (tick.index)}
      <SliderPrimitive.Tick
        index={tick.index}
        class="size-1 rounded-full bg-black/35"
      />
    {/each}
    {#each thumbItems as thumb (thumb.index)}
      <SliderPrimitive.Thumb
        index={thumb.index}
        class="block size-5 shrink-0 rounded-full bg-white shadow-[0_0_0_2px_var(--color-popover)] transition-shadow outline-none focus-visible:shadow-[0_0_0_2px_var(--color-popover),0_0_0_4px_rgb(255_255_255/40%)] active:shadow-[0_0_0_2px_var(--color-popover),0_0_0_4px_rgb(255_255_255/30%)]"
      />
    {/each}
  {/snippet}
</SliderPrimitive.Root>
