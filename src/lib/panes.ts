import { cubicInOut } from 'svelte/easing';
import type { HTMLButtonAttributes } from 'svelte/elements';
import type { TransitionConfig } from 'svelte/transition';
import { reducedMotion } from '$lib/utils';
import type { ToolPaneType } from '$shared/contracts';

export type PaneSize = 'full' | 'half' | 'third';

/** What every pane in the strip is given by the page that lays them out. */
export type PaneProps = {
  /** Spread on the pane's grip so it can be dragged, or moved with the arrow keys. */
  dragHandle: HTMLButtonAttributes;
  onresize: (size: PaneSize) => void;
  onclose: () => void;
  onrename: (title: string) => void;
};

/** The tool panes, in the order the add menu lists them. */
export const TOOL_PANES: { type: ToolPaneType; label: string; icon: string }[] =
  [
    { type: 'files', label: 'Files', icon: 'folder' },
    { type: 'terminal', label: 'Terminal', icon: 'terminal' },
    { type: 'diff', label: 'Code diff', icon: 'code' },
  ];

export function toolPaneIcon(type: ToolPaneType) {
  return TOOL_PANES.find((pane) => pane.type === type)!.icon;
}

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
