/**
 * The accent slider sweeps OKLCH hues from blue through violet, red, orange, and yellow to
 * green: 230° up to 510° (150° once wrapped). Cyan and teal, between 150° and 230°, are left
 * out. Slider values stay unwrapped so the sweep is one continuous range.
 */
export const ACCENT_RANGE = { min: 230, max: 510 } as const;

/** The slider snaps to evenly spaced stops across the sweep, the first and last at its ends. */
export const ACCENT_STOPS = 7;

const STOP_SPACING = (ACCENT_RANGE.max - ACCENT_RANGE.min) / (ACCENT_STOPS - 1);

/** The index of the stop nearest a hue; hues outside the sweep snap to its nearer end. */
export function accentStopIndex(hue: number) {
  const value = hue < ACCENT_RANGE.min ? hue + 360 : hue;
  const index = Math.round((value - ACCENT_RANGE.min) / STOP_SPACING);
  if (index < ACCENT_STOPS) return index;
  // Past the green end: the wrapped hues up to 150° belong to it, those beyond to blue.
  const pastEnd = value - ACCENT_RANGE.max;
  const beforeStart = ACCENT_RANGE.min + 360 - value;
  return pastEnd < beforeStart ? ACCENT_STOPS - 1 : 0;
}

/** The hue of a stop, wrapped into 0-360°. */
export function accentStopHue(index: number) {
  const hue = (ACCENT_RANGE.min + index * STOP_SPACING) % 360;
  return Math.round(hue * 100) / 100;
}

/** Applies the accent to the whole app; the theme derives every accent color from it. */
export function applyAccent(hue: number) {
  // Settings saved by another build can lack a hue; a bad value would void every surface color
  // derived from the accent, so the stylesheet's default stays.
  if (!Number.isFinite(hue)) return;
  document.documentElement.style.setProperty('--accent-hue', String(hue));
}
