<script lang="ts">
  import { Slider } from 'bits-ui';
  import {
    ACCENT_RANGE,
    ACCENT_STOPS,
    accentStopHue,
    accentStopIndex,
    applyAccent,
  } from '$lib/accent';
  import type { SettingControlProps } from './setting.svelte';

  /** The track shows every accent the slider can reach, at the accent's own lightness. */
  const TRACK = `linear-gradient(to right in oklch longer hue, ${[
    ACCENT_RANGE.min,
    ACCENT_RANGE.max % 360,
  ]
    .map((hue) => `oklch(var(--accent-lightness) var(--accent-chroma) ${hue})`)
    .join(', ')})`;

  let {
    hue,
    oncommit,
    ...controlProps
  }: SettingControlProps & {
    hue: number;
    /** Called once a drag or key press settles, rather than on every step. */
    oncommit: (hue: number) => void;
  } = $props();

  /** The stop the thumb is on mid-drag; the accent follows it live, and is saved on release. */
  let dragging = $state<number>();
  const value = $derived(dragging ?? accentStopIndex(hue));
</script>

<!-- The gradient pill pads the thumb's travel, so the thumb never meets its edge. -->
<div class="rounded-full p-[3px]" style={`background: ${TRACK}`}>
  <Slider.Root
    type="single"
    {value}
    min={0}
    max={ACCENT_STOPS - 1}
    step={1}
    thumbPositioning="contain"
    onValueChange={(next) => {
      dragging = next;
      applyAccent(accentStopHue(next));
    }}
    onValueCommit={(next) => {
      dragging = undefined;
      oncommit(accentStopHue(next));
    }}
    class="relative flex h-3.5 w-full touch-none items-center select-none"
  >
    <!-- Inset by the thumb's radius, so the end markers sit under the thumb at its ends. -->
    <span
      class="pointer-events-none absolute inset-x-[7px] flex justify-between"
      aria-hidden="true"
    >
      {#each { length: ACCENT_STOPS } as _, marker (marker)}
        <span class="size-1 -mx-0.5 rounded-full bg-black/35"></span>
      {/each}
    </span>
    <Slider.Thumb
      index={0}
      {...controlProps}
      class="relative block size-3.5 rounded-full bg-white shadow-md ring-1 ring-black/10 outline-none transition-shadow duration-150 focus-visible:ring-3 focus-visible:ring-white/50 motion-reduce:transition-none"
    />
  </Slider.Root>
</div>
