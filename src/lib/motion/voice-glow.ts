/*
MIT License

Copyright (c) 2026 Jakub Antalik

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/
// TypeScript port of voice-glow 0.2.1's styles.ts / voiceDriver.ts, trimmed to this
// app's single dark composer surface: https://github.com/Jakubantalik/Libraries.dev
// Keeps the seven-lobe light, spectrum flow and attack/release envelope; drops the
// light-theme variant, the second microphone, and the SVG displacement filter.

interface Lobe {
  x: number;
  w: number;
  h: number;
  band: 0 | 1 | 2;
  color: string;
}

const LOBES: Lobe[] = [
  { x: 0, w: 74, h: 46, band: 0, color: '255, 70, 120' },
  { x: -36, w: 54, h: 40, band: 1, color: '60, 190, 255' },
  { x: 36, w: 54, h: 40, band: 1, color: '175, 70, 255' },
  { x: -72, w: 48, h: 32, band: 2, color: '60, 220, 130' },
  { x: 72, w: 48, h: 32, band: 2, color: '255, 150, 40' },
  { x: -108, w: 42, h: 26, band: 1, color: '90, 100, 255' },
  { x: 108, w: 42, h: 26, band: 1, color: '40, 200, 190' },
];
const SPAN = 252 * 0.85;

export function voiceGlowBackground(
  width: number,
  height: number,
  alpha: number,
): string {
  return LOBES.map(
    (lobe, i) =>
      `radial-gradient(ellipse calc(${(lobe.w * width * 100) / 350}% * var(--voice-w, 1)) calc(${lobe.h * height}px * var(--voice-h, 0.8) * var(--voice-l${i}, 1)) at calc(50% + var(--voice-x${i}, ${(lobe.x * 100) / 350}%) * var(--voice-w, 1)) 100%, rgba(${lobe.color}, ${alpha}), transparent 75%)`,
  ).join(',');
}

function shape(raw: number, threshold = 0.015) {
  const input = Number.isFinite(raw) ? Math.max(0, Math.min(1, raw)) : 0;
  if (input <= threshold) return 0;
  const t = (input - threshold) / (1 - threshold);
  return (1 - Math.exp(-3 * t)) / (1 - Math.exp(-3));
}

function follow(previous: number, target: number, dt: number, release = 0.86) {
  const tau = target > previous ? 0.325 : release;
  return previous + (target - previous) * (1 - Math.exp(-dt / tau));
}

/** One mounted listening session; no DOM or audio ownership. */
export function createVoiceGlow() {
  let level = 0;
  let time = 0;
  let phase = 0;
  const bands = [0, 0, 0];
  return (
    raw: number,
    elapsed: number,
    still = false,
  ): Record<string, string | number> => {
    const dt = Math.max(0, Math.min(0.05, elapsed));
    if (!still) {
      time += dt;
      level = follow(level, shape(raw), dt);
      const inputs = [
        raw,
        raw * (0.72 + 0.28 * Math.sin(time * 9.1)),
        raw * (0.6 + 0.4 * Math.sin(time * 13.7 + 2)),
      ];
      for (let i = 0; i < bands.length; i += 1) {
        bands[i] = follow(bands[i], shape(inputs[i], 0.009), dt, 0.989);
      }
    }
    const breathe = 0.5 + 0.5 * Math.sin((Math.PI * 2 * time) / 5.2);
    const effective = still ? 0.28 : level + (1 - level) * 0.18 * breathe;
    if (!still) phase = (phase + 48 * effective * dt) % SPAN;
    const properties: Record<string, string | number> = {
      '--voice-glow': 0.15 + 0.85 * effective,
      '--voice-h': 0.5 + 1.2 * effective,
      '--voice-w': 0.85 + 1.05 * effective,
      '--voice-lift': `${60 * effective}px`,
      '--voice-hue': `${still ? 0 : -24 * Math.cos((Math.PI * 2 * time) / 12)}deg`,
    };
    LOBES.forEach((lobe, i) => {
      const x =
        ((((lobe.x * 0.85 + (still ? 0 : phase) + SPAN / 2) % SPAN) + SPAN) %
          SPAN) -
        SPAN / 2;
      const edge = Math.max(0, 1 - (x / (SPAN / 2 + 4)) ** 2);
      properties[`--voice-x${i}`] = `${(x * 100) / 350}%`;
      properties[`--voice-l${i}`] =
        (still ? 1 : 0.6 + 0.7 * bands[lobe.band]) * edge;
    });
    return properties;
  };
}
