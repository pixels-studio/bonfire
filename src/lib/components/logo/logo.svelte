<script lang="ts">
  import { cn } from '$lib/utils';

  /** Embers rising through the flame: where each starts and the wandering path it takes. */
  const EMBERS = [
    {
      x: 9.6,
      y: 16,
      r: 0.5,
      fill: '#FFE9A8',
      dur: 2.1,
      delay: 0,
      p: [-1.2, -4, 1.6, -7.5, -0.6, -11.5],
    },
    {
      x: 13.4,
      y: 16.5,
      r: 0.4,
      fill: '#FFC24A',
      dur: 2.6,
      delay: 0.5,
      p: [1.8, -3, -1.4, -6.5, 2.2, -10.5],
    },
    {
      x: 11.6,
      y: 15.5,
      r: 0.35,
      fill: '#FFF3C8',
      dur: 1.8,
      delay: 1.1,
      p: [-2, -2.5, 0.8, -6, -2.6, -9.5],
    },
    {
      x: 15.2,
      y: 15,
      r: 0.45,
      fill: '#FF9A3C',
      dur: 2.9,
      delay: 0.2,
      p: [-1.6, -3.5, 1.2, -7, 0.4, -9],
    },
    {
      x: 8.2,
      y: 14,
      r: 0.35,
      fill: '#FFC24A',
      dur: 2.3,
      delay: 1.6,
      p: [1.4, -3, -0.8, -5.5, 1.8, -8],
    },
    {
      x: 12.4,
      y: 16.2,
      r: 0.55,
      fill: '#FFD27A',
      dur: 3.1,
      delay: 0.8,
      p: [2.4, -2, -1.8, -5, 1.2, -12],
    },
    {
      x: 14.2,
      y: 13.5,
      r: 0.3,
      fill: '#FFF3C8',
      dur: 2,
      delay: 1.9,
      p: [-2.4, -2.2, 0.6, -5.2, -3, -7.5],
    },
    {
      x: 10.4,
      y: 13,
      r: 0.4,
      fill: '#FF9A3C',
      dur: 2.7,
      delay: 1.3,
      p: [2, -2.8, -0.4, -6, 1.6, -9.5],
    },
  ];

  let {
    active = false,
    class: className,
  }: {
    /** Stirs the fire: the flame flickers and embers drift up through it. */
    active?: boolean;
    class?: string;
  } = $props();

  const uid = $props.id();
</script>

<svg
  class={cn('logo', className)}
  data-active={active}
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  xmlns="http://www.w3.org/2000/svg"
  role="img"
  aria-label="Bonfire"
>
  <g transform="translate(2.16 0.3) scale(0.82)">
    <g class="flame">
      <g filter="url(#{uid}-flame-shadow)">
        <path
          d="M11.1208 1.79774C11.3438 1.71433 11.5931 1.74114 11.7927 1.87098C13.5763 3.03225 14.5879 4.7599 15.1521 6.42567C15.47 7.36439 15.651 8.2992 15.7487 9.13172C16.3694 8.50038 16.9887 7.84141 17.2107 7.52723C17.3366 7.34908 17.5335 7.23476 17.7507 7.21375C17.9679 7.19275 18.1837 7.26706 18.3415 7.41786C19.6675 8.68582 20.2135 10.304 20.4138 11.8993C21.0592 16.9976 17.9957 20.5051 14.2868 21.6181C10.5918 22.7268 6.175 21.4718 4.19308 17.0848C3.0061 14.4493 3.39154 11.8318 4.98409 9.50672C5.52114 8.72316 6.17883 8.02679 6.82394 7.40516C7.03024 7.20677 7.23209 7.01527 7.4294 6.82899C8.89276 5.44754 10.0861 4.32138 10.6618 2.29481C10.7269 2.06565 10.8976 1.8813 11.1208 1.79774Z"
          fill="url(#{uid}-flame)"
        />
      </g>
    </g>
    <path
      class="spark"
      d="M12.2947 11.2439C12.2678 11.1024 12.144 11 12 11C11.856 11 11.7322 11.1024 11.7053 11.2439C11.5138 12.2494 11.1359 13.0149 10.5754 13.5754C10.0149 14.1359 9.24941 14.5138 8.24387 14.7053C8.10237 14.7322 8 14.856 8 15C8 15.144 8.10237 15.2678 8.24387 15.2947C9.24941 15.4862 10.0149 15.8641 10.5754 16.4246C11.1359 16.9852 11.5138 17.7506 11.7053 18.7561C11.7322 18.8976 11.856 19 12 19C12.144 19 12.2678 18.8976 12.2947 18.7561C12.4862 17.7506 12.8641 16.9852 13.4246 16.4246C13.9852 15.8641 14.7506 15.4862 15.7561 15.2947C15.8976 15.2678 16 15.144 16 15C16 14.856 15.8976 14.7322 15.7561 14.7053C14.7506 14.5138 13.9852 14.1359 13.4246 13.5754C12.8641 13.0149 12.4862 12.2494 12.2947 11.2439Z"
      fill="white"
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

  <ellipse
    cx="12"
    cy="22.9"
    rx="9"
    ry="1.1"
    fill="#1a0a02"
    opacity="0.45"
    filter="url(#{uid}-blur)"
  />
  <use href="#{uid}-log" transform="translate(12 19.7) rotate(-10)" />
  <g
    transform="translate(12 19.7) scale(-1 1) rotate(-10)"
    opacity="0.6"
    filter="url(#{uid}-blur)"
  >
    <rect x="-8.6" y="-1.6" width="17" height="4.6" rx="1" fill="#120702" />
  </g>
  <use
    href="#{uid}-log"
    transform="translate(12 19.9) scale(-1 1) rotate(-10)"
  />

  <defs>
    <filter
      id="{uid}-flame-shadow"
      x="3.5"
      y="1.75"
      width="17"
      height="24.248"
      filterUnits="userSpaceOnUse"
      color-interpolation-filters="sRGB"
    >
      <feFlood flood-opacity="0" result="BackgroundImageFix" />
      <feBlend
        mode="normal"
        in="SourceGraphic"
        in2="BackgroundImageFix"
        result="shape"
      />
      <feColorMatrix
        in="SourceAlpha"
        type="matrix"
        values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"
        result="hardAlpha"
      />
      <feOffset dy="3" />
      <feGaussianBlur stdDeviation="4" />
      <feComposite in2="hardAlpha" operator="arithmetic" k2="-1" k3="1" />
      <feColorMatrix
        type="matrix"
        values="0 0 0 0 0.616843 0 0 0 0 0.00361216 0 0 0 0 0.00361238 0 0 0 1 0"
      />
      <feBlend mode="normal" in2="shape" result="effect1_innerShadow" />
      <feColorMatrix
        in="SourceAlpha"
        type="matrix"
        values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"
        result="hardAlpha"
      />
      <feOffset dy="4" />
      <feGaussianBlur stdDeviation="5" />
      <feComposite in2="hardAlpha" operator="arithmetic" k2="-1" k3="1" />
      <feColorMatrix
        type="matrix"
        values="0 0 0 0 0.980392 0 0 0 0 0.669935 0 0 0 0 0 0 0 0 1 0"
      />
      <feBlend
        mode="normal"
        in2="effect1_innerShadow"
        result="effect2_innerShadow"
      />
    </filter>
    <filter
      id="{uid}-blur"
      x="-20%"
      y="-60%"
      width="140%"
      height="220%"
      color-interpolation-filters="sRGB"
    >
      <feGaussianBlur stdDeviation="0.45" />
    </filter>
    <linearGradient
      id="{uid}-flame"
      x1="12.0001"
      y1="1.75"
      x2="12.0001"
      y2="21.9987"
      gradientUnits="userSpaceOnUse"
    >
      <stop stop-color="#FA641F" />
      <stop offset="1" stop-color="#EC0000" />
    </linearGradient>
    <linearGradient
      id="{uid}-bark"
      x1="0"
      y1="-2.1"
      x2="0"
      y2="2.1"
      gradientUnits="userSpaceOnUse"
    >
      <stop stop-color="#A6693A" />
      <stop offset="0.25" stop-color="#7A4A27" />
      <stop offset="0.65" stop-color="#4D2E17" />
      <stop offset="1" stop-color="#241208" />
    </linearGradient>
    <radialGradient
      id="{uid}-end"
      cx="0"
      cy="0"
      r="1"
      gradientUnits="userSpaceOnUse"
      gradientTransform="translate(8.1 0) scale(1.2 2.1)"
    >
      <stop stop-color="#F3D9A4" />
      <stop offset="0.6" stop-color="#DDAE6E" />
      <stop offset="1" stop-color="#B27B43" />
    </radialGradient>
    <g id="{uid}-log">
      <path
        d="M-8.2 -2.1H8V2.1H-8.2C-9 2.1 -9.4 1 -9.4 0C-9.4 -1 -9 -2.1 -8.2 -2.1Z"
        fill="url(#{uid}-bark)"
      />
      <g
        stroke="#1B0D05"
        stroke-width="0.22"
        stroke-linecap="round"
        opacity="0.55"
      >
        <path d="M-8.3 -1.1H-3.6" />
        <path d="M-5.2 -0.2H1.4" />
        <path d="M-1.8 -1.5H5.2" />
        <path d="M-7.4 0.7H-2.6" />
        <path d="M0.2 0.9H6.6" />
        <path d="M-3.6 1.5H3" />
        <path d="M3 -0.5H7.3" />
      </g>
      <g
        stroke="#C98F55"
        stroke-width="0.14"
        stroke-linecap="round"
        opacity="0.5"
      >
        <path d="M-6.6 -1.7H-1.2" />
        <path d="M1.6 -1.2H6.4" />
        <path d="M-3.4 -0.6H0.4" />
      </g>
      <path
        d="M-8 -1.85H6.6"
        stroke="#FF9A3C"
        stroke-width="0.35"
        stroke-linecap="round"
        opacity="0.7"
      />
      <path d="M-8.2 1.9H8" stroke="#000" stroke-width="0.4" opacity="0.35" />
      <ellipse cx="8" cy="0" rx="1.2" ry="2.1" fill="#4A2B14" />
      <ellipse cx="8.05" cy="0" rx="1.05" ry="1.92" fill="url(#{uid}-end)" />
      <g stroke="#8E5A2B" stroke-width="0.14" opacity="0.75">
        <ellipse cx="8.08" cy="0" rx="0.78" ry="1.45" />
        <ellipse cx="8.1" cy="0" rx="0.5" ry="0.92" />
        <ellipse cx="8.12" cy="0" rx="0.22" ry="0.4" />
      </g>
      <path
        d="M8.1 0L9 -0.9"
        stroke="#7A4A22"
        stroke-width="0.12"
        opacity="0.6"
      />
    </g>
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

  .embers {
    opacity: 0;
    transition: opacity 250ms ease-out;
  }

  .flame,
  .spark,
  .ember {
    transform-box: fill-box;
  }
  .flame {
    transform-origin: 50% 100%;
  }
  .spark,
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
    .logo[data-active='true'] .spark {
      animation: twinkle 1.6s ease-in-out infinite;
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

  @keyframes twinkle {
    0%,
    100% {
      transform: scale(1) rotate(0deg);
    }
    50% {
      transform: scale(1.12) rotate(8deg);
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
