import type { HTMLButtonAttributes } from 'svelte/elements';
import type { ToolPaneType } from '$shared/contracts';

export type PaneSize = 'full' | 'half' | 'third';

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

/** What every panel (activity, insights, settings, shortcuts) is given; it has a fixed title. */
export type PanelProps = Omit<PaneProps, 'onrename'>;

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
