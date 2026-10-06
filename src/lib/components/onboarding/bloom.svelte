<script lang="ts">
  /**
   * A bloom of firelight between two views, after Deals' mystic dissolve: the
   * outgoing view brightens and blows out into an orange and rose glow, and the
   * incoming one emerges from it as the light clears.
   *
   * `out()` plays up to the peak and resolves there, so the caller can swap what
   * `children` renders behind the light; `reveal()` then clears it.
   */
  import type { Snippet } from 'svelte';
  import { reducedMotion } from '$lib/utils';

  let { children }: { children: Snippet } = $props();

  // Timing (ms).
  const BLOOM = 900;
  const REVEAL = 1200;
  // With reduced motion it is only a crossfade.
  const FADE_OUT = 200;
  const FADE_IN = 280;

  /** How far the warm light washes over the dark app at its brightest. */
  const VEIL = 0.7;
  const AURA = 0.9;

  let phase = $state<'idle' | 'out' | 'peak' | 'in'>('idle');
  let reduce = $state(false);
  /** Progress through the current phase, 0..1. */
  let k = $state(0);

  const easeIn = (x: number) => x * x * x;
  const easeOut = (x: number) => 1 - Math.pow(1 - x, 3);

  let frame = 0;
  function run(duration: number) {
    cancelAnimationFrame(frame);
    k = 0;
    return new Promise<void>((resolve) => {
      const start = performance.now();
      const step = (now: number) => {
        k = Math.min(1, (now - start) / duration);
        if (k < 1) frame = requestAnimationFrame(step);
        else resolve();
      };
      frame = requestAnimationFrame(step);
    });
  }

  /** Blows the current view out into the light; resolves at the peak. */
  export async function out() {
    reduce = reducedMotion();
    phase = 'out';
    await run(reduce ? FADE_OUT : BLOOM);
    phase = 'peak';
  }

  /** Clears the light over whatever is showing now. */
  export async function reveal() {
    if (phase === 'idle') return;
    phase = 'in';
    await run(reduce ? FADE_IN : REVEAL);
    phase = 'idle';
  }

  $effect(() => () => cancelAnimationFrame(frame));

  /** Outgoing content swells into the light; incoming settles out of it. */
  const contentStyle = $derived.by(() => {
    if (phase === 'idle') return '';
    if (phase === 'peak') return 'opacity:0;';
    if (reduce) return `opacity:${phase === 'out' ? 1 - k : k};`;
    if (phase === 'out') {
      const bk = easeIn(k);
      // It only fades in the last stretch, once the light covers it.
      const gone = easeIn(Math.max(0, (k - 0.6) / 0.4));
      return (
        `opacity:${(1 - gone).toFixed(3)};` +
        `filter:brightness(${(1 + bk * 2.4).toFixed(2)}) saturate(${(1 + bk * 0.6).toFixed(2)}) blur(${(bk * 3).toFixed(1)}px);` +
        `transform:scale(${(1 + bk * 0.02).toFixed(4)});`
      );
    }
    // The push-in carries on: the new view starts a touch small and grows into place.
    const rk = easeOut(k);
    return (
      `opacity:${rk.toFixed(3)};` +
      `filter:brightness(${(1 + (1 - rk) * 1.4).toFixed(2)}) blur(${((1 - rk) * 3).toFixed(1)}px);` +
      `transform:scale(${(1 - (1 - rk) * 0.02).toFixed(4)});`
    );
  });

  /** The light grows from the centre, holds, then clears late. */
  const light = $derived.by(() => {
    if (reduce || phase === 'idle') return { veil: 0, aura: 0, spread: 1 };
    if (phase === 'out') {
      const bk = easeIn(k);
      return { veil: Math.min(1, bk * 1.25), aura: bk, spread: bk };
    }
    if (phase === 'peak') return { veil: 1, aura: 1, spread: 1 };
    return {
      veil: Math.pow(1 - k, 0.85),
      aura: Math.pow(1 - k, 0.9),
      spread: 1,
    };
  });

  const veilStyle = $derived(
    `opacity:${(light.veil * VEIL).toFixed(3)};` +
      `--inner:${(light.spread * 70).toFixed(0)}%;--outer:${(24 + light.spread * 120).toFixed(0)}%;`,
  );
</script>

<div
  class="bloom-content"
  class:running={phase !== 'idle'}
  style={contentStyle}
>
  {@render children()}
</div>

{#if phase !== 'idle' && !reduce}
  <div
    class="aura"
    style="opacity:{(light.aura * AURA).toFixed(3)}"
    aria-hidden="true"
  ></div>
  <div class="veil" style={veilStyle} aria-hidden="true"></div>
{/if}

<style>
  /* Only promoted while it runs: a transform here would otherwise trap the app's fixed overlays. */
  .bloom-content.running {
    will-change: transform, opacity, filter;
    pointer-events: none;
  }

  .aura,
  .veil {
    position: fixed;
    inset: 0;
    z-index: 100;
    pointer-events: none;
  }

  /* Embers of orange and rose, blurred together into one luminous cloud. */
  .aura {
    background:
      radial-gradient(40% 48% at 34% 40%, #fb923c, transparent 70%),
      radial-gradient(44% 50% at 62% 34%, #f43f5e, transparent 70%),
      radial-gradient(46% 48% at 60% 64%, #fb7185, transparent 70%),
      radial-gradient(40% 44% at 36% 66%, #f97316, transparent 72%);
    filter: blur(48px);
    animation: drift 2.4s cubic-bezier(0.23, 1, 0.32, 1) both;
  }

  /* Warm light rather than white, so the dark app glows instead of flashing. */
  .veil {
    z-index: 101;
    background: radial-gradient(
      120% 90% at 50% 46%,
      #ffe8d9 var(--inner),
      transparent var(--outer)
    );
  }

  @keyframes drift {
    from {
      transform: scale(0.85) rotate(-6deg);
    }
    to {
      transform: scale(1.1) rotate(4deg);
    }
  }
</style>
