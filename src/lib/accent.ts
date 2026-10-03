/**
 * The accent slider sweeps OKLCH hues from blue through violet, red, orange, and yellow to
 * green: 230° up to 510° (150° once wrapped). Cyan and teal, between 150° and 230°, are left
 * out. Slider values stay unwrapped so the sweep is one continuous range.
 */
export const ACCENT_RANGE = { min: 230, max: 510 } as const;

/** The slider position for a hue; hues outside the sweep snap to its nearer end. */
export function accentSliderValue(hue: number) {
  const value = hue < ACCENT_RANGE.min ? hue + 360 : hue;
  if (value <= ACCENT_RANGE.max) return value;
  const pastEnd = value - ACCENT_RANGE.max;
  const beforeStart = ACCENT_RANGE.min + 360 - value;
  return pastEnd < beforeStart ? ACCENT_RANGE.max : ACCENT_RANGE.min;
}

export function accentHue(sliderValue: number) {
  return sliderValue % 360;
}

/** Applies the accent to the whole app; the theme derives every accent color from it. */
export function applyAccent(hue: number) {
  document.documentElement.style.setProperty('--accent-hue', String(hue));
}
