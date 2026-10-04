<!--
  A traveling aurora glow along an element's top edge, shown while `active`.

  Ported from the `line` size of border-beam (https://libraries.dev/beam, MIT, Jakub Antalik),
  with its dark `colorful` palette. The library glows along an element's bottom edge, so this
  draws the same layers and flips them to the top.
-->
<script lang="ts" module>
  /** The glow's position along the edge, as the library writes it: `calc(var(--aurora-x) * 100% ± offset)`. */
  function at(offsetX: number, offsetY: number) {
    const x =
      offsetX === 0 ? '' : ` ${offsetX > 0 ? '+' : '-'} ${Math.abs(offsetX)}px`;
    const y =
      offsetY === 0 ? '' : ` ${offsetY > 0 ? '+' : '-'} ${Math.abs(offsetY)}px`;
    return `calc(var(--aurora-x) * 100%${x}) calc(100%${y})`;
  }

  type Blob = [color: string, w: number, h: number, x: number, y: number];

  function blobs(list: Blob[]) {
    return list
      .map(
        ([color, w, h, x, y]) =>
          `radial-gradient(ellipse calc(${w}px * var(--aurora-w)) calc(${h}px * var(--aurora-h)) at ${at(x, y)}, ${color}, transparent)`,
      )
      .join(', ');
  }

  /** The 1px colored edge, with a white highlight at the beam's head. */
  const STROKE = [
    `radial-gradient(ellipse calc(24px * var(--aurora-w)) calc(28px * var(--aurora-h)) at ${at(0, 2)}, rgba(255, 255, 255, 0.38) 0%, rgba(255, 255, 255, 0.12) 30%, transparent 65%)`,
    blobs([
      ['rgb(255, 50, 100)', 36, 36, 0, 2],
      ['rgb(40, 180, 220)', 30, 32, 39, 0],
      ['rgb(50, 200, 80)', 33, 28, -36, 2],
      ['rgb(180, 40, 240)', 29, 34, -54, 0],
      ['rgb(255, 160, 30)', 27, 30, 51, -1],
      ['rgb(100, 70, 255)', 36, 24, 21, 1],
      ['rgb(40, 140, 255)', 30, 22, -21, 0],
      ['rgb(240, 50, 180)', 25, 28, 66, 1],
      ['rgb(30, 185, 170)', 23, 30, -66, -1],
    ]),
  ].join(', ');

  /** The soft wash of color just inside the edge. */
  const INNER = blobs([
    ['rgba(255, 50, 100, 0.48)', 33, 30, 0, 0],
    ['rgba(40, 180, 220, 0.42)', 24, 26, 39, -3],
    ['rgba(50, 200, 80, 0.48)', 27, 24, -36, 0],
    ['rgba(180, 40, 240, 0.42)', 23, 28, -54, -2],
    ['rgba(255, 160, 30, 0.50)', 24, 24, 51, -1],
    ['rgba(100, 70, 255, 0.45)', 30, 20, 21, 0],
    ['rgba(40, 140, 255, 0.40)', 25, 18, -21, -2],
    ['rgba(240, 50, 180, 0.45)', 21, 24, 66, 0],
    ['rgba(30, 185, 170, 0.52)', 18, 26, -66, -1],
  ]);

  type Spike = [
    width: string,
    height: string,
    left: string,
    lift: number,
    color1: string,
    color2: string,
    stop: number,
    end: number,
  ];

  /** Thin rays of light that flicker up out of the edge, plus the beam's bright core. */
  const BLOOM = [
    ...(
      [
        ['0.8px * var(--aurora-spike)', '92px', '8%', 2, 'rgb(255, 60, 80)', 'rgb(255, 60, 80)', 30, 88],
        ['10px * var(--aurora-spike2)', '35px', '22%', 4, 'rgba(40, 190, 180, 0.98)', 'rgba(40, 190, 180, 0.49)', 50, 95],
        ['2px * (2 - var(--aurora-spike))', '72px', '36%', 3, 'rgb(100, 70, 255)', 'rgba(100, 70, 255, 1)', 40, 90],
        ['14px * var(--aurora-spike2)', '28px', '50%', 2, 'rgba(255, 170, 40, 0.59)', 'rgba(255, 170, 40, 0.29)', 55, 96],
        ['1.2px * (2 - var(--aurora-spike2))', '85px', '64%', 4, 'rgb(50, 200, 100)', 'rgba(50, 200, 100, 1)', 35, 89],
        ['7px * var(--aurora-spike)', '45px', '78%', 2, 'rgba(200, 50, 240, 0.91)', 'rgba(200, 50, 240, 0.45)', 48, 94],
        ['0.6px * (2 - var(--aurora-spike))', '60px', '92%', 3, 'rgb(40, 140, 255)', 'rgba(40, 140, 255, 1)', 42, 91],
      ] satisfies Spike[]
    ).map(
      ([width, height, left, lift, color1, color2, stop, end]) =>
        `radial-gradient(ellipse calc(${width}) calc(${height} * var(--aurora-h)) at ${left} calc(100% - ${lift}px), ${color1}, ${color2} ${stop}%, transparent ${end}%)`,
    ),
    `radial-gradient(ellipse calc(21px * var(--aurora-spike)) calc(15px * var(--aurora-spike2)) at ${at(0, 1)}, rgba(255, 255, 255, 1) 0%, rgba(255, 255, 255, 0.9) 20%, rgba(255, 255, 255, 0.5) 50%, transparent 100%)`,
    `radial-gradient(ellipse calc(42px * var(--aurora-w)) calc(40px * var(--aurora-h)) at ${at(0, 0)}, rgba(255, 255, 255, 0.3) 0%, rgba(255, 255, 255, 0.12) 25%, rgba(255, 255, 255, 0.03) 55%, transparent 80%)`,
  ].join(', ');
</script>

<script lang="ts">
  import { fade } from 'svelte/transition';
  import { cn } from '$lib/utils';

  let {
    active,
    duration = 3.1,
    class: className,
  }: {
    /** Fades the glow in, and back out when it turns false. */
    active: boolean;
    /** Seconds for the beam to travel from one end of the edge to the other. */
    duration?: number;
    class?: string;
  } = $props();
</script>

{#if active}
  <div
    class={cn('aurora pointer-events-none relative overflow-hidden', className)}
    style:--aurora-duration="{duration}s"
    aria-hidden="true"
    in:fade={{ duration: 600 }}
    out:fade={{ duration: 500 }}
  >
    <div class="layer inner" style:background={INNER}></div>
    <div class="layer stroke" style:background={STROKE}></div>
    <div class="layer bloom" style:background={BLOOM}></div>
  </div>
{/if}

<style>
  @property --aurora-x {
    syntax: '<number>';
    initial-value: 0;
    inherits: true;
  }
  @property --aurora-w {
    syntax: '<number>';
    initial-value: 1;
    inherits: true;
  }
  @property --aurora-h {
    syntax: '<number>';
    initial-value: 1;
    inherits: true;
  }
  @property --aurora-spike {
    syntax: '<number>';
    initial-value: 1;
    inherits: true;
  }
  @property --aurora-spike2 {
    syntax: '<number>';
    initial-value: 1;
    inherits: true;
  }
  @property --aurora-edge {
    syntax: '<number>';
    initial-value: 1;
    inherits: true;
  }

  .aurora {
    /* The library's beam rides a bottom edge; flipping it puts the beam on the top edge. */
    transform: scaleY(-1);
    animation:
      travel var(--aurora-duration) linear infinite,
      edge-fade var(--aurora-duration) linear infinite,
      breathe calc(var(--aurora-duration) * 1.3) ease-in-out infinite,
      spike calc(var(--aurora-duration) * 1.33) ease-in-out infinite,
      spike2 calc(var(--aurora-duration) * 1.7) ease-in-out infinite;
  }

  .layer {
    position: absolute;
    inset: 0;
  }

  .inner {
    z-index: 1;
    box-shadow: inset 0 0 9px 1px rgba(255, 255, 255, 0.1);
    mask-image:
      radial-gradient(
        ellipse calc(78px * var(--aurora-w)) calc(60px * var(--aurora-h)) at
          calc(var(--aurora-x) * 100%) 100%,
        white 0%,
        rgba(255, 255, 255, 0.5) 45%,
        transparent 100%
      ),
      linear-gradient(white, transparent 28px, transparent calc(100% - 28px), white),
      linear-gradient(
        to right,
        white,
        transparent 28px,
        transparent calc(100% - 28px),
        white
      );
    mask-composite: intersect, add;
    opacity: calc(var(--aurora-edge) * 0.7);
    animation: hue-shift 12s ease-in-out infinite;
  }

  .stroke {
    z-index: 2;
    padding: 1px;
    mask:
      radial-gradient(
        ellipse calc(78px * var(--aurora-w)) calc(60px * var(--aurora-h)) at
          calc(var(--aurora-x) * 100%) 100%,
        white 0%,
        rgba(255, 255, 255, 0.5) 45%,
        transparent 100%
      ),
      linear-gradient(#fff 0 0) content-box,
      linear-gradient(#fff 0 0);
    mask-composite: intersect, exclude;
    opacity: calc(var(--aurora-edge) * 1.14);
    animation: hue-shift 12s ease-in-out infinite;
  }

  .bloom {
    z-index: 3;
    mask: radial-gradient(
      ellipse calc(84px * var(--aurora-w)) calc(110px * var(--aurora-h)) at
        calc(var(--aurora-x) * 100%) 100%,
      white 0%,
      rgba(255, 255, 255, 0.5) 35%,
      transparent 100%
    );
    opacity: calc(var(--aurora-edge) * 0.8);
    animation: hue-shift-bloom 8s ease-in-out infinite;
  }

  @media (prefers-reduced-motion: reduce) {
    .aurora,
    .layer {
      animation: none;
    }
    .aurora {
      --aurora-x: 0.5;
    }
    .layer {
      filter: brightness(1.3) saturate(1.2);
    }
    .bloom {
      filter: blur(8px) brightness(1.3) saturate(1.2);
    }
  }

  @keyframes travel {
    0% { --aurora-x: 0.06; --aurora-w: 0.5; }
    10% { --aurora-x: 0.15; --aurora-w: 0.8; }
    20% { --aurora-x: 0.25; --aurora-w: 1.1; }
    30% { --aurora-x: 0.35; --aurora-w: 1.3; }
    40% { --aurora-x: 0.44; --aurora-w: 1.45; }
    50% { --aurora-x: 0.5; --aurora-w: 1.5; }
    60% { --aurora-x: 0.56; --aurora-w: 1.45; }
    70% { --aurora-x: 0.65; --aurora-w: 1.3; }
    80% { --aurora-x: 0.75; --aurora-w: 1.1; }
    90% { --aurora-x: 0.85; --aurora-w: 0.8; }
    100% { --aurora-x: 0.94; --aurora-w: 0.5; }
  }

  @keyframes edge-fade {
    0%, 12.5% { --aurora-edge: 0; }
    32.5%, 67.5% { --aurora-edge: 1; }
    87.5%, 100% { --aurora-edge: 0; }
  }

  @keyframes breathe {
    0%, 100% { --aurora-h: 0.8; }
    25% { --aurora-h: 1.25; }
    55% { --aurora-h: 0.85; }
    80% { --aurora-h: 1.3; }
  }

  @keyframes spike {
    0%, 100% { --aurora-spike: 0.8; }
    25% { --aurora-spike: 1.3; }
    50% { --aurora-spike: 0.9; }
    75% { --aurora-spike: 1.4; }
  }

  @keyframes spike2 {
    0%, 100% { --aurora-spike2: 1.2; }
    25% { --aurora-spike2: 0.7; }
    50% { --aurora-spike2: 1.4; }
    75% { --aurora-spike2: 0.8; }
  }

  @keyframes hue-shift {
    0%, 100% { filter: hue-rotate(-13deg) brightness(1.3) saturate(1.2); }
    50% { filter: hue-rotate(13deg) brightness(1.3) saturate(1.2); }
  }

  @keyframes hue-shift-bloom {
    0%, 100% { filter: blur(8px) hue-rotate(-23deg) brightness(1.3) saturate(1.2); }
    50% { filter: blur(8px) hue-rotate(23deg) brightness(1.3) saturate(1.2); }
  }
</style>
