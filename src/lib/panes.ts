import { cubicInOut } from 'svelte/easing';
import type { TransitionConfig } from 'svelte/transition';
import { reducedMotion } from '$lib/utils';

export type PaneSize = 'full' | 'half' | 'third';

export const PANE_SIZES: {
  value: PaneSize;
  label: string;
  icon: string;
  class: string;
}[] = [
  { value: 'full', label: 'Full', icon: 'full', class: 'basis-full' },
  { value: 'half', label: 'Half', icon: 'half', class: 'basis-1/2 min-w-105' },
  {
    value: 'third',
    label: 'Third',
    icon: 'one-third',
    class: 'basis-1/3 min-w-90',
  },
];

export function defaultPaneSize(paneCount: number): PaneSize {
  if (paneCount === 1) return 'full';
  if (paneCount === 2) return 'half';
  return 'third';
}

/**
 * Grows a strip item in from no width, or shrinks it away, so its neighbors
 * slide over at the same pace as they resize. Its content keeps its width
 * meanwhile, clipped rather than reflowed.
 */
export function paneWidth(
  node: HTMLElement,
  _params?: unknown,
  { direction }: { direction?: 'in' | 'out' | 'both' } = {},
): TransitionConfig {
  const width = node.getBoundingClientRect().width;
  const content = node.firstElementChild as HTMLElement | null;
  if (content) content.style.width = `${content.offsetWidth}px`;
  return {
    duration: reducedMotion() ? 0 : 200,
    easing: cubicInOut,
    css: (t) =>
      `flex-basis: ${t * width}px; min-width: ${t * width}px; overflow: hidden;`,
    tick: (t) => {
      if (direction === 'in' && t === 1 && content) content.style.width = '';
    },
  };
}
