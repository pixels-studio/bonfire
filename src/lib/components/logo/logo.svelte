<script lang="ts">
  import { cn } from '$lib/utils';

  /** Embers rising through the flame: where each starts and the wandering path it takes. */
  const EMBERS = [
    {
      x: 190,
      y: 360,
      r: 12,
      fill: '#FFE9A8',
      dur: 2.1,
      delay: 0,
      p: [-30, -100, 40, -190, -15, -290],
    },
    {
      x: 330,
      y: 380,
      r: 9,
      fill: '#FFC24A',
      dur: 2.6,
      delay: 0.5,
      p: [45, -75, -35, -165, 55, -265],
    },
    {
      x: 255,
      y: 340,
      r: 8,
      fill: '#FFF3C8',
      dur: 1.8,
      delay: 1.1,
      p: [-50, -65, 20, -150, -65, -240],
    },
    {
      x: 400,
      y: 330,
      r: 11,
      fill: '#FF9A3C',
      dur: 2.9,
      delay: 0.2,
      p: [-40, -90, 30, -175, 10, -230],
    },
    {
      x: 120,
      y: 300,
      r: 8,
      fill: '#FFC24A',
      dur: 2.3,
      delay: 1.6,
      p: [35, -75, -20, -140, 45, -205],
    },
    {
      x: 290,
      y: 370,
      r: 13,
      fill: '#FFD27A',
      dur: 3.1,
      delay: 0.8,
      p: [60, -50, -45, -125, 30, -300],
    },
    {
      x: 350,
      y: 290,
      r: 7,
      fill: '#FFF3C8',
      dur: 2,
      delay: 1.9,
      p: [-60, -55, 15, -130, -75, -190],
    },
    {
      x: 215,
      y: 270,
      r: 9,
      fill: '#FF9A3C',
      dur: 2.7,
      delay: 1.3,
      p: [50, -70, -10, -150, 40, -240],
    },
  ];

  let {
    active = false,
    idle,
    warm = false,
    class: className,
  }: {
    /** Stirs the fire: the flame flickers and embers drift up through it. */
    active?: boolean;
    /** Banks the fire down to the surrounding text colour while true; left out, it always burns. */
    idle?: boolean;
    /** Burns amber into rose instead of orange into red. */
    warm?: boolean;
    class?: string;
  } = $props();

  const uid = $props.id();
</script>

<svg
  class={cn('logo', className)}
  data-active={active}
  data-warm={warm}
  width="24"
  height="24"
  viewBox="-40 -60 592 735"
  fill="none"
  xmlns="http://www.w3.org/2000/svg"
  role="img"
  aria-label="Bonfire"
>
  <g class="flame">
    {#if idle !== undefined}
      <use
        href="#{uid}-shape"
        fill="currentColor"
        class="bank"
        data-idle={idle}
      />
    {/if}
    <use
      href="#{uid}-shape"
      fill="url(#{uid}-flame)"
      class="lit"
      data-idle={idle}
    />
  </g>

  <g class="embers">
    {#each EMBERS as ember, index (index)}
      <circle
        class="ember"
        cx={ember.x}
        cy={ember.y}
        r={ember.r}
        fill={ember.fill}
        style:--x1="{ember.p[0]}px"
        style:--y1="{ember.p[1]}px"
        style:--x2="{ember.p[2]}px"
        style:--y2="{ember.p[3]}px"
        style:--x3="{ember.p[4]}px"
        style:--y3="{ember.p[5]}px"
        style:animation-duration="{ember.dur}s"
        style:animation-delay="{ember.delay}s"
      />
    {/each}
  </g>

  <defs>
    <path
      id="{uid}-shape"
      d="M229.518 1.44827C236.234 -1.08248 243.742 -0.268593 249.753 3.67093C303.471 38.9069 333.938 91.3283 350.93 141.872C360.504 170.355 365.956 198.72 368.898 223.981C387.592 204.824 406.243 184.829 412.929 175.296C416.721 169.89 422.651 166.422 429.193 165.784C435.734 165.147 442.233 167.402 446.986 171.978C486.921 210.451 503.366 259.551 509.399 307.956C528.837 462.652 436.572 569.079 324.87 602.851C213.586 636.491 80.5638 598.411 20.8736 465.298C-14.8751 385.33 -3.26657 305.908 44.6968 235.359C60.8713 211.584 80.679 190.455 100.108 171.593C106.321 165.573 112.4 159.762 118.342 154.11C162.415 112.194 198.355 78.0225 215.694 16.5313C217.655 9.57797 222.796 3.9837 229.518 1.44827ZM160.75 401.85C143.077 401.85 128.75 416.177 128.75 433.85V472.25C128.755 489.919 143.08 504.25 160.75 504.25C178.419 504.25 192.744 489.919 192.75 472.25V433.85C192.749 416.177 178.423 401.85 160.75 401.85ZM301.549 401.85C283.875 401.85 269.55 416.177 269.549 433.85V472.25C269.554 489.919 283.88 504.25 301.549 504.25C319.218 504.25 333.544 489.919 333.549 472.25V433.85C333.549 416.177 319.223 401.85 301.549 401.85Z"
    />
    <linearGradient
      id="{uid}-flame"
      x1="256"
      y1="0"
      x2="256"
      y2="614.4"
      gradientUnits="userSpaceOnUse"
    >
      <stop stop-color={warm ? '#FBBF24' : '#FA641F'} />
      <stop offset="1" stop-color={warm ? '#F43F5E' : '#EC0000'} />
    </linearGradient>
  </defs>
</svg>

<style>
  .logo {
    overflow: hidden;
    transition: filter 300ms ease-out;
  }
  .logo[data-active='true'] {
    filter: drop-shadow(0 0 3px rgb(250 100 31 / 0.55));
  }
  .logo[data-warm='true'][data-active='true'] {
    filter: drop-shadow(0 0 4px rgb(251 113 133 / 0.55));
  }
  .lit,
  .bank {
    transition: opacity 300ms ease-out;
  }
  .lit[data-idle='true'],
  .bank[data-idle='false'] {
    opacity: 0;
  }

  .embers {
    opacity: 0;
    transition: opacity 250ms ease-out;
  }

  .flame,
  .ember {
    transform-box: fill-box;
  }
  .flame {
    transform-origin: 50% 100%;
  }
  .ember {
    transform-origin: 50% 50%;
  }

  @media (prefers-reduced-motion: no-preference) {
    .logo[data-active='true'] .embers {
      opacity: 1;
    }
    .logo[data-active='true'] .flame {
      animation: flicker 1.1s ease-in-out infinite;
    }
    .logo[data-active='true'] .ember {
      animation-name: rise;
      animation-timing-function: ease-in-out;
      animation-iteration-count: infinite;
    }
  }

  @keyframes flicker {
    0%,
    100% {
      transform: scale(1, 1) skewX(0deg);
    }
    22% {
      transform: scale(1.02, 1.06) skewX(-1.6deg);
    }
    47% {
      transform: scale(0.98, 0.97) skewX(1.2deg);
    }
    74% {
      transform: scale(1.015, 1.045) skewX(1.8deg);
    }
  }

  @keyframes rise {
    0% {
      opacity: 0;
      transform: translate(0, 0) scale(0.5);
    }
    15% {
      opacity: 1;
    }
    40% {
      transform: translate(var(--x1), var(--y1)) scale(1);
    }
    70% {
      opacity: 0.9;
      transform: translate(var(--x2), var(--y2)) scale(0.8);
    }
    100% {
      opacity: 0;
      transform: translate(var(--x3), var(--y3)) scale(0.3);
    }
  }
</style>
