import type { HTMLButtonAttributes } from 'svelte/elements';
import type { PaneType, ToolPaneType } from '$shared/contracts';

export type PaneSize = 'full' | 'two-thirds' | 'half' | 'third';

/** What every pane in the strip is given by the page that lays them out. */
export type PaneProps = {
  /** Spread on the pane's grip so it can be dragged, or moved with the arrow keys. */
  dragHandle: HTMLButtonAttributes;
  /** The pane's current size, so its size menu can leave it out of the list of sizes to switch to. */
  size: PaneSize;
  onresize: (size: PaneSize) => void;
  onclose: () => void;
  onrename: (title: string) => void;
};

/** What every panel (insights, settings, shortcuts) is given; it opens over the app. */
export type PanelProps = { onclose: () => void };

/** The tool panes, in the order the add menu lists them. */
export const TOOL_PANES: { type: ToolPaneType; label: string; icon: string }[] =
  [
    { type: 'files', label: 'Files', icon: 'folder' },
    { type: 'terminal', label: 'Terminal', icon: 'terminal' },
    { type: 'diff', label: 'Code diff', icon: 'code' },
    { type: 'browser', label: 'Browser', icon: 'browser' },
  ];

export function toolPaneIcon(type: ToolPaneType) {
  return TOOL_PANES.find((pane) => pane.type === type)!.icon;
}

/** Any pane's icon: an agent's is its provider's logo, named after it. */
export function paneIcon(type: PaneType) {
  return TOOL_PANES.find((pane) => pane.type === type)?.icon ?? type;
}

export const PANE_SIZES: {
  value: PaneSize;
  label: string;
  icon: string;
  class: string;
}[] = [
  { value: 'full', label: 'Full', icon: 'full', class: 'basis-full' },
  {
    value: 'two-thirds',
    label: 'Wide',
    icon: 'two-thirds',
    class: 'basis-2/3 min-w-105',
  },
  { value: 'half', label: 'Half', icon: 'half', class: 'basis-1/2 min-w-105' },
  {
    value: 'third',
    label: 'Third',
    icon: 'one-third',
    class: 'basis-1/3 min-w-90',
  },
];

/**
 * The size of a pane that hasn't been resized. The sidebar takes its share of the window, so
 * two panes fit at a time: each takes half the strip, and the launcher takes half too.
 */
export function defaultPaneSize(_paneCount: number): PaneSize {
  return 'half';
}
