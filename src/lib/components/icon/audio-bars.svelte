<script lang="ts">
  import { cn } from '$lib/utils.js';

  let { class: className }: { class?: string } = $props();

  /** The waveform glyph's strokes, as [x, y1, y2] on its 24-unit grid. */
  const BARS = [
    [3.75, 10.75, 13.25],
    [7.75, 5.75, 18.25],
    [12, 9.75, 14.25],
    [16.25, 7.75, 16.25],
    [20.25, 10.75, 13.25],
  ];
</script>

<!-- Decorative: bars idle at rest, then wiggle on hover like a live waveform, and settle
     back the moment the pointer leaves. Each stroke scales from its own center, so the
     rounded caps stay anchored as in the static glyph. -->
<svg
  class={cn('audio-bars size-4', className)}
  viewBox="0 0 24 24"
  fill="none"
  aria-hidden="true"
>
  {#each BARS as [x, y1, y2], index (index)}
    <path
      class="audio-bars-line"
      d="M{x} {y1}V{y2}"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
    />
  {/each}
</svg>

<style>
  .audio-bars-line {
    transform-box: fill-box;
    transform-origin: center;
    transform: scaleY(1);
    transition: transform 200ms ease;
  }
  .audio-bars:hover .audio-bars-line {
    animation: audio-bars-wiggle 850ms ease-in-out infinite;
  }
  .audio-bars-line:nth-child(1) {
    animation-duration: 760ms;
  }
  .audio-bars-line:nth-child(2) {
    animation-duration: 900ms;
    animation-delay: 90ms;
  }
  .audio-bars-line:nth-child(3) {
    animation-duration: 680ms;
    animation-delay: 160ms;
  }
  .audio-bars-line:nth-child(4) {
    animation-duration: 840ms;
    animation-delay: 40ms;
  }
  .audio-bars-line:nth-child(5) {
    animation-duration: 720ms;
    animation-delay: 120ms;
  }
  @keyframes audio-bars-wiggle {
    0%,
    100% {
      transform: scaleY(1);
    }
    25% {
      transform: scaleY(1.6);
    }
    50% {
      transform: scaleY(0.5);
    }
    75% {
      transform: scaleY(1.25);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .audio-bars:hover .audio-bars-line {
      animation: none;
    }
  }
</style>
