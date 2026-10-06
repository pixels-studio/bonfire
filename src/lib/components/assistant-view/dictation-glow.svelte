<script lang="ts">
  import { fade } from 'svelte/transition';
  import { reducedMotion } from '$lib/utils';
  import { createVoiceGlow, voiceGlowBackground } from '$lib/motion/voice-glow';

  /** Reads the current microphone level each frame; avoids a per-frame Svelte state write. */
  let { getLevel = () => 0 }: { getLevel?: () => number } = $props();
  let element: HTMLDivElement;
  const inner = voiceGlowBackground(0.65 * 0.9, 1.25 * 0.9, 0.46);
  const bloom = voiceGlowBackground(0.65 * 1.15, 1.25 * 1.5, 0.9);
  const edge = voiceGlowBackground(0.65, 1.25, 1);
  const reduced = reducedMotion();

  $effect(() => {
    const step = createVoiceGlow();
    let raf = 0;
    let lastTime = 0;
    const paint = (dt: number, still = false) => {
      for (const [property, value] of Object.entries(
        step(getLevel(), dt, still),
      ))
        element.style.setProperty(property, String(value));
    };
    const frame = (time: number) => {
      // Caps decorative work on high-refresh displays; the envelope survives the skip.
      if (!lastTime || time - lastTime >= 1000 / 60 - 2) {
        paint(lastTime ? (time - lastTime) / 1000 : 1 / 60);
        lastTime = time;
      }
      raf = requestAnimationFrame(frame);
    };
    const onVisibility = () => {
      cancelAnimationFrame(raf);
      lastTime = 0;
      if (document.hidden) paint(0, true);
      else raf = requestAnimationFrame(frame);
    };
    paint(0, reduced);
    if (!reduced) raf = requestAnimationFrame(frame);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  });
</script>

<div
  bind:this={element}
  class="dictation-glow"
  aria-hidden="true"
  in:fade={{ duration: reduced ? 0 : 350 }}
  out:fade={{ duration: reduced ? 0 : 250 }}
>
  <div class="light inner" style:background-image={inner}></div>
  <div class="light bloom" style:background-image={bloom}></div>
  <div class="light core"></div>
  <div class="light edge" style:background-image={edge}></div>
</div>

<style>
  .dictation-glow {
    position: absolute;
    inset: 0;
    border-radius: inherit;
    overflow: hidden;
    pointer-events: none;
    --strength: 0.75;
    --inner: 0.47;
    --bloom: 0.89;
    --saturation: 1.2;
  }
  .light {
    position: absolute;
    inset: 0;
    border-radius: inherit;
    filter: hue-rotate(var(--voice-hue, 0deg)) saturate(var(--saturation));
  }
  .inner {
    opacity: calc(var(--voice-glow, 0.3) * var(--inner) * var(--strength));
    mask-image: radial-gradient(
      ellipse calc(36.4% * var(--voice-w, 1))
        calc(64px * var(--voice-h, 0.8) + var(--voice-lift, 0px)) at 50% 100%,
      black,
      rgb(0 0 0 / 0.5) 45%,
      transparent
    );
  }
  .bloom {
    filter: blur(10px) hue-rotate(var(--voice-hue, 0deg))
      saturate(var(--saturation));
    opacity: calc(var(--voice-glow, 0.3) * var(--bloom) * var(--strength));
    mask-image: radial-gradient(
      ellipse calc(42.9% * var(--voice-w, 1))
        calc(130px * var(--voice-h, 0.8) + var(--voice-lift, 0px)) at 50% 100%,
      black,
      rgb(0 0 0 / 0.5) 35%,
      transparent
    );
  }
  .core {
    background: radial-gradient(
      ellipse 8% calc(30px * var(--voice-h, 0.8)) at 50% 100%,
      rgb(255 255 255 / 0.45),
      transparent 70%
    );
    opacity: calc(var(--voice-glow, 0.3) * var(--strength));
    filter: blur(6px);
  }
  .edge {
    padding: 1px;
    mask:
      linear-gradient(white, white) content-box,
      linear-gradient(white, white);
    mask-composite: exclude;
    opacity: calc(var(--voice-glow, 0.3) * var(--strength));
  }
</style>
