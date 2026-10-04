<!--
  A colorful glow fixed at the center of an element's top edge that pulses, blooms and drifts
  through its colors while `active`. Bonfire shows it along the top of the window while an
  agent works.

  Built on the look of voice-glow (https://libraries.dev/voice, MIT, Jakub Antalik), cut down
  to this one use: no microphone, no sweep, dark only. Where the library follows a voice, a
  built-in wave drives the glow. The layers are drawn for a bottom edge, as in the library, and
  the whole glow is flipped onto the top edge.
-->
<script lang="ts" module>
  /** The seven colored lobes the glow is painted from, centre first. */
  const LOBES = [
    { x: 0, w: 74, h: 46, band: 0 },
    { x: -36, w: 54, h: 40, band: 1 },
    { x: 36, w: 54, h: 40, band: 1 },
    { x: -72, w: 48, h: 32, band: 2 },
    { x: 72, w: 48, h: 32, band: 2 },
    { x: -108, w: 42, h: 26, band: 1 },
    { x: 108, w: 42, h: 26, band: 1 },
  ];
  const LOBE_SPACING = 0.85;
  /** The lobes drift sideways and wrap around within this span. */
  const SPAN = 36 * LOBES.length * LOBE_SPACING;

  /** The library's dark `colorful` palette, one color per lobe. */
  export const DEFAULT_COLORS = [
    'rgb(255, 70, 120)',
    'rgb(60, 190, 255)',
    'rgb(175, 70, 255)',
    'rgb(60, 220, 130)',
    'rgb(255, 150, 40)',
    'rgb(90, 100, 255)',
    'rgb(40, 200, 190)',
  ];

  /** The band line's chromatic fringes, as `r, g, b`. */
  const BAND = {
    core: '255, 255, 255',
    above: '255, 70, 80',
    mid: '90, 255, 150',
    below: '80, 140, 255',
  };

  // The library's `default` shape on its dark theme.
  const GLOW_W = 0.65;
  const GLOW_H = 1.25;
  const RANGE_W = 170 * 0.75;
  const RANGE_H = 64;
  const FADE = 75;
  const REACH = 1.2;
  const SPREAD = 1.05;
  const FLOW = 48;
  const BEND = 60;
  const BAND_STRENGTH = 1.55;
  const BAND_WIDTH = 2.15;
  const BAND_POSITION = 0.35;
  const BAND_CURVE = 1.75;
  const BAND_SPREAD = 0.87;
  const BAND_SKEW = 0.12;
  const BAND_OFFSET = -27;
  const BAND_ABERRATION = 0.89;
  const DISTORTION = 0.62;
  const HUE_RANGE = 24;
  const HUE_DURATION = 12;
  const CONTOUR_POINTS = 56;
  const MIN_FRAME_MS = 1000 / 60 - 2;
  const TAU = Math.PI * 2;

  function channels(color: string) {
    const hex = color.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (hex) {
      const h =
        hex[1].length === 3 ? [...hex[1]].map((c) => c + c).join('') : hex[1];
      return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).join(', ');
    }
    const rgb = color.match(
      /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i,
    );
    return rgb ? `${rgb[1]}, ${rgb[2]}, ${rgb[3]}` : '255, 255, 255';
  }

  /** One radial gradient per lobe, sized and placed by the variables the loop writes. */
  function lobes(
    colors: string[],
    alpha: number,
    sw: number,
    sh: number,
    y: number,
    fade: number,
  ) {
    return LOBES.map((lobe, i) => {
      const color = `rgba(${channels(colors[i % colors.length])}, ${alpha})`;
      const w = `calc(${Math.round(lobe.w * sw)}px * var(--vw))`;
      const h = `calc(${Math.round(lobe.h * sh)}px * var(--vh) * var(--l${i}))`;
      return `radial-gradient(ellipse ${w} ${h} at calc(50% + var(--x${i}) * var(--vw)) calc(100% + ${y}px), ${color} 0%, transparent ${fade}%)`;
    }).join(', ');
  }

  const HIGHLIGHT =
    'radial-gradient(ellipse calc(30px * var(--vw)) calc(30px * var(--vh)) at 50% calc(100% + 2px), rgba(255, 255, 255, 0.45) 0%, rgba(255, 255, 255, 0.14) 30%, transparent 65%)';

  const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);

  /** A smooth, uneven rise and fall in −1…1, like a voice's loudness. */
  function wave(t: number) {
    return (
      0.6 * Math.sin(t * 1.3) +
      0.3 * Math.sin(t * 2.9 + 1) +
      0.1 * Math.sin(t * 7.1 + 2)
    );
  }

  function wrap(x: number) {
    const half = SPAN / 2;
    return ((((x + half) % SPAN) + SPAN) % SPAN) - half;
  }

  /** Lobes shrink toward the ends of the span, so the wrap-around is never seen. */
  function taper(x: number) {
    const r = x / (SPAN / 2 + 4);
    return Math.max(0, 1 - r * r);
  }

  /** The band's profile: a bell, a little skewed, that falls to 0 at ±1. */
  function bell(u: number) {
    const s = Math.max(
      0.05,
      BAND_SPREAD * (u < 0 ? 1 - BAND_SKEW : 1 + BAND_SKEW),
    );
    const v = Math.exp(-Math.pow(Math.abs(u) / s, BAND_CURVE));
    const floor = Math.exp(-Math.pow(1 / s, BAND_CURVE));
    return Math.max(0, (v - floor) / (1 - floor));
  }

  /** The band line across the glow, as points from its left end to its right. */
  function contour(
    width: number,
    height: number,
    w: number,
    h: number,
    lift: number,
  ) {
    const centre = width / 2;
    const half = RANGE_W * w;
    const rise = Math.min(height * 0.82, (RANGE_H * h + lift) * BAND_POSITION);
    const base = height - BAND_OFFSET;
    const points: [number, number][] = [];
    for (let i = 0; i <= CONTOUR_POINTS; i++) {
      const x = centre - half + (2 * half * i) / CONTOUR_POINTS;
      points.push([x, base - rise * bell((x - centre) / Math.max(1, half))]);
    }
    return points;
  }
</script>

<script lang="ts">
  import { fade } from 'svelte/transition';
  import { MediaQuery } from 'svelte/reactivity';
  import { cn } from '$lib/utils';

  let {
    active,
    intensity = 0.6,
    variation = 0.35,
    speed = 1,
    colors = DEFAULT_COLORS,
    class: className,
  }: {
    /** Fades the glow in, and back out when it turns false. */
    active: boolean;
    /** 0–1: how bright, tall and wide the glow sits on average. */
    intensity?: number;
    /** 0–1: how far it pulses above and below `intensity`. */
    variation?: number;
    /** Multiplies the speed of every motion: the pulse, the drift and the hue shift. */
    speed?: number;
    /** The lobe colors, centre outward (cycled if fewer than seven). */
    colors?: string[];
    class?: string;
  } = $props();

  const uid = $props.id();
  const filterId = `aurora-glow-${uid}`;
  const reducedMotion = new MediaQuery('(prefers-reduced-motion: reduce)');

  const strokeBg = $derived(
    `${HIGHLIGHT}, ${lobes(colors, 1, GLOW_W, GLOW_H, 2, FADE)}`,
  );
  const innerBg = $derived(
    lobes(colors, 0.46, GLOW_W * 0.9, GLOW_H * 0.9, 0, FADE),
  );
  const bloomBg = $derived(
    lobes(colors, 0.9, GLOW_W * 1.15, GLOW_H * 1.5, 0, FADE + 2),
  );

  let el = $state<HTMLDivElement>();
  let canvas = $state<HTMLCanvasElement>();
  let displace = $state<SVGFEDisplacementMapElement>();
  let noiseShift = $state<SVGFEOffsetElement>();
  let filter = $state<SVGFilterElement>();

  $effect(() => {
    if (!el || !canvas) return;
    const node = el;
    const ctx = canvas.getContext('2d');
    const still = reducedMotion.current;
    let width = node.clientWidth;
    let height = node.clientHeight;
    const resize = new ResizeObserver(() => {
      width = node.clientWidth;
      height = node.clientHeight;
      if (still) paint(0);
    });
    resize.observe(node);

    let t = 0;
    let phase = 0;
    let filterTop = -1;

    function paint(dt: number) {
      const level = still
        ? intensity
        : clamp01(intensity + variation * wave(t));
      const glow = 0.15 + 0.85 * level;
      const h = 0.5 + REACH * level;
      const w = 0.85 + SPREAD * level;
      const lift = BEND * level;
      if (!still) phase = (((phase + FLOW * level * dt) % SPAN) + SPAN) % SPAN;

      const style = node.style;
      style.setProperty('--glow', glow.toFixed(3));
      style.setProperty('--vw', w.toFixed(3));
      style.setProperty('--vh', h.toFixed(3));
      style.setProperty('--bh', `${lift.toFixed(1)}px`);
      // Each lobe's height follows a band of the "voice": low in the centre, higher outward.
      const bands = [
        level,
        level * (0.72 + 0.28 * Math.sin(t * 9.1)),
        level * (0.6 + 0.4 * Math.sin(t * 13.7 + 2)),
      ];
      for (let i = 0; i < LOBES.length; i++) {
        const x = wrap(LOBES[i].x * LOBE_SPACING + phase);
        style.setProperty(`--x${i}`, `${x.toFixed(1)}px`);
        style.setProperty(
          `--l${i}`,
          ((0.6 + 0.7 * bands[LOBES[i].band]) * taper(x)).toFixed(3),
        );
      }
      const hue = still
        ? 0
        : -HUE_RANGE + HUE_RANGE * (1 - Math.cos((TAU * t) / HUE_DURATION));
      style.setProperty('--hue', `${hue.toFixed(2)}deg`);

      if (!width || !height) return;
      const points = contour(width, height, w, h, lift);
      clipAtLine(points);
      fitFilter(points);
      drawBand(points, level);
      if (displace)
        displace.scale.baseVal = still ? 0 : DISTORTION * 120 * glow;
      if (noiseShift && !still) {
        noiseShift.dx.baseVal = 8 * Math.sin(t * 0.9);
        noiseShift.dy.baseVal = 4 * Math.sin(t * 0.6 + 1.3);
      }
    }

    /** Splits the glow at the band line: the part under it is the part that warps. */
    function clipAtLine(points: [number, number][]) {
      const px = (n: number) => `${n.toFixed(1)}px`;
      const line = points.map(([x, y]) => `${px(x)} ${px(y)}`);
      const H = px(height);
      const W = px(width);
      node.style.setProperty(
        '--clip-below',
        `polygon(0 ${H}, ${line.join(', ')}, ${W} ${H})`,
      );
      node.style.setProperty(
        '--clip-above',
        `polygon(0 0, ${W} 0, ${W} ${H}, ${line.slice().reverse().join(', ')}, 0 ${H})`,
      );
    }

    /** Narrows the distortion filter to the strip under the band line, which is all it touches. */
    function fitFilter(points: [number, number][]) {
      if (!filter) return;
      let top = height;
      for (const [, y] of points) if (y < top) top = y;
      const t = Math.max(
        0,
        Math.min(0.9, Math.floor((top - 6) / height / 0.05) * 0.05),
      );
      if (t === filterTop) return;
      filterTop = t;
      const bottom = 1 + Math.max(0.1, 12 / height);
      filter.setAttribute('y', `${(t * 100).toFixed(0)}%`);
      filter.setAttribute('height', `${((bottom - t) * 100).toFixed(1)}%`);
    }

    /** The band: the line drawn along the glow's crest, with red, green and blue fringes. */
    function drawBand(points: [number, number][], level: number) {
      if (!canvas || !ctx) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const pw = Math.round(width * dpr);
      const ph = Math.round(height * dpr);
      if (canvas.width !== pw || canvas.height !== ph) {
        canvas.width = pw;
        canvas.height = ph;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      const strength = Math.min(1, 0.6 * BAND_STRENGTH * level);
      if (strength < 5e-3) return;

      const lineWidth = 14 * BAND_WIDTH * (1 + 0.35 * level);
      const aberration = BAND_ABERRATION * (0.35 + 0.65 * level);
      const offY = 4 + 12 * aberration;
      const offX = 4 * aberration;
      const alpha = 0.42 * strength;
      const blur = ((3.5 * BAND_WIDTH) / 2) * dpr;
      const x0 = points[0][0];
      const x1 = points[points.length - 1][0];
      const gradient = (rgb: string, a: number) => {
        const g = ctx.createLinearGradient(x0, 0, x1, 0);
        g.addColorStop(0, `rgba(${rgb}, 0)`);
        g.addColorStop(0.18, `rgba(${rgb}, ${a.toFixed(3)})`);
        g.addColorStop(0.82, `rgba(${rgb}, ${a.toFixed(3)})`);
        g.addColorStop(1, `rgba(${rgb}, 0)`);
        return g;
      };
      const trace = (dx: number, dy: number) => {
        ctx.beginPath();
        ctx.moveTo(points[0][0] + dx, points[0][1] + dy);
        for (let i = 1; i < points.length; i++)
          ctx.lineTo(points[i][0] + dx, points[i][1] + dy);
      };
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      // A wide soft halo first, then each fringe in four passes from wide and faint to thin and bright.
      ctx.filter = `blur(${(blur * 3).toFixed(1)}px)`;
      ctx.strokeStyle = gradient(BAND.core, alpha * 0.3);
      ctx.lineWidth = lineWidth * 2.2;
      trace(0, 0);
      ctx.stroke();
      ctx.filter = `blur(${blur.toFixed(1)}px)`;
      const fringes = [
        { rgb: BAND.above, a: 1, ox: offX, oy: -offY },
        { rgb: BAND.mid, a: 0.55, ox: offX * 0.35, oy: -offY * 0.35 },
        { rgb: BAND.below, a: 1, ox: -offX, oy: offY },
        { rgb: BAND.core, a: 0.9, ox: 0, oy: 0 },
      ];
      for (const f of fringes) {
        for (const [wide, a] of [
          [1, 0.16],
          [0.72, 0.2],
          [0.46, 0.26],
          [0.22, 0.34],
        ]) {
          ctx.strokeStyle = gradient(f.rgb, alpha * f.a * a);
          ctx.lineWidth = Math.max(0.6, lineWidth * wide);
          trace(f.ox, f.oy);
          ctx.stroke();
        }
      }
      ctx.filter = 'none';
    }

    if (still) {
      paint(0);
      return () => resize.disconnect();
    }

    let raf = 0;
    let last = 0;
    function frame(now: number) {
      raf = requestAnimationFrame(frame);
      if (last && now - last < MIN_FRAME_MS) return;
      const dt = (last ? Math.min(0.05, (now - last) / 1000) : 1 / 60) * speed;
      last = now;
      t += dt;
      paint(dt);
    }
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      resize.disconnect();
    };
  });
</script>

{#if active}
  <div
    class={cn('pointer-events-none', className)}
    aria-hidden="true"
    in:fade={{ duration: 600 }}
    out:fade={{ duration: 500 }}
  >
    <!-- Drawn for a bottom edge, like the library, and flipped onto the top one. -->
    <div class="glow" bind:this={el} style:--warp="url(#{filterId})">
      <div class="inner" style:background={innerBg}></div>
      <div class="inner warped" style:background={innerBg}></div>
      <div class="stroke" style:background={strokeBg}></div>
      <div class="bloom" style:background={bloomBg}></div>
      <div class="bloom warped" style:background={bloomBg}></div>
      <canvas class="band" bind:this={canvas}></canvas>

      <!-- Drifting noise with its green channel pinned to 0.5, so it only pushes sideways. -->
      <svg width="0" height="0" class="absolute">
        <filter
          bind:this={filter}
          id={filterId}
          x="-10%"
          y="0%"
          width="120%"
          height="110%"
          color-interpolation-filters="sRGB"
        >
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.0276 0.115"
            numOctaves="2"
            seed="7"
            result="noise"
          />
          <feOffset
            bind:this={noiseShift}
            in="noise"
            dx="0"
            dy="0"
            result="moved"
          />
          <feColorMatrix
            in="moved"
            type="matrix"
            values="1 0 0 0 0  0 0 0 0 0.5  0 0 0 0 0  0 0 0 0 1"
            result="map"
          />
          <feDisplacementMap
            bind:this={displace}
            in="SourceGraphic"
            in2="map"
            scale="0"
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>
      </svg>
    </div>
  </div>
{/if}

<style>
  .glow {
    --glow: 0.4;
    --vw: 1;
    --vh: 0.8;
    --bh: 0px;
    --hue: 0deg;
    --x0: 0px;
    --x1: -31px;
    --x2: 31px;
    --x3: -61px;
    --x4: 61px;
    --x5: -92px;
    --x6: 92px;
    --l0: 1;
    --l1: 1;
    --l2: 1;
    --l3: 1;
    --l4: 1;
    --l5: 1;
    --l6: 1;
    --tint: hue-rotate(var(--hue)) brightness(1.15) saturate(1.2);
    /* The centred ellipse each layer is shown through; it grows with the glow. */
    --range: radial-gradient(
      ellipse calc(127.5px * var(--vw)) calc(64px * var(--vh) + var(--bh)) at
        50% 100%,
      white 0%,
      rgba(255, 255, 255, 0.5) 45%,
      transparent 100%
    );

    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
    transform: scaleY(-1);
  }

  .glow > * {
    position: absolute;
    inset: 0;
    will-change: transform;
  }

  /* Soft light just inside the edge. */
  .inner {
    z-index: 1;
    box-shadow: inset 0 0 9px 1px rgba(255, 255, 255, 0.1);
    mask-image:
      radial-gradient(
        ellipse calc(127.5px * var(--vw)) calc(64px * var(--vh) + var(--bh)) at
          50% 100%,
        white 0%,
        rgba(255, 255, 255, 0.5) 45%,
        rgba(255, 255, 255, 0.3) 85%,
        transparent 100%
      ),
      linear-gradient(
        white,
        transparent 28px,
        transparent calc(100% - 28px),
        white
      ),
      linear-gradient(
        to right,
        white,
        transparent 28px,
        transparent calc(100% - 28px),
        white
      );
    mask-composite: intersect, add;
    opacity: calc(var(--glow) * 0.47);
    filter: var(--tint);
  }

  /* The colors painted into the 1px edge. */
  .stroke {
    z-index: 2;
    padding: 1px;
    mask:
      var(--range),
      linear-gradient(#fff 0 0) content-box,
      linear-gradient(#fff 0 0);
    mask-composite: intersect, exclude;
    opacity: calc(var(--glow) * 1.16);
    filter: var(--tint);
  }

  /* The blurred halo, tallest of the layers. */
  .bloom {
    z-index: 3;
    mask: radial-gradient(
      ellipse calc(150px * var(--vw)) calc(130px * var(--vh) + var(--bh)) at 50%
        100%,
      white 0%,
      rgba(255, 255, 255, 0.5) 35%,
      transparent 100%
    );
    opacity: calc(var(--glow) * 0.89);
    filter: blur(10px) var(--tint);
  }

  /* Each soft layer is drawn twice: plain above the band line, warped below it. */
  .inner,
  .bloom {
    clip-path: var(--clip-above, none);
  }
  .inner.warped {
    clip-path: var(--clip-below, inset(100%));
    filter: var(--tint) var(--warp);
  }
  .bloom.warped {
    clip-path: var(--clip-below, inset(100%));
    filter: blur(10px) var(--tint) var(--warp);
  }

  .band {
    z-index: 4;
    width: 100%;
    height: 100%;
    filter: var(--tint);
  }

  @media (prefers-reduced-motion: reduce) {
    .warped {
      display: none;
    }
    .inner,
    .bloom {
      clip-path: none;
    }
  }
</style>
