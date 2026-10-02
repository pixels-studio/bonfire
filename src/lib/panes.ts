export type PaneSize = 'full' | 'half' | 'third';
export type PaneView = 'chat' | 'terminal' | 'diff' | 'files';

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
