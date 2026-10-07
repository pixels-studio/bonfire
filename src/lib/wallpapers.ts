import { DEFAULT_WALLPAPER } from '../../shared/domain';

/**
 * The pictures a user can put behind the window. The project home shows the photo; inside a
 * task it gives way to `gradient`, the same photo's colors run top to bottom and darkened, so
 * the panes keep the mood without a blurred photo to repaint behind them.
 *
 * Each gradient's stops are the average color of five horizontal bands of the photo, taken
 * down to OKLCH lightness 0.18 to 0.31 with their chroma capped, so white text stays legible.
 */
export type Wallpaper = {
  id: string;
  name: string;
  /** Unset for the plain background. */
  src?: string;
  /** A small copy for the settings picker. */
  thumb?: string;
  gradient?: string;
};

const photo = (id: string, name: string, stops: string[]): Wallpaper => ({
  id,
  name,
  src: `/wallpapers/${id}.jpg`,
  thumb: `/wallpapers/${id}-thumb.jpg`,
  gradient: `linear-gradient(to bottom, ${stops.join(', ')})`,
});

export const WALLPAPERS: Wallpaper[] = [
  photo('lagoon', 'Lagoon', [
    '#022a41',
    '#252d2e',
    '#341c0f',
    '#1e2021',
    '#111e26',
  ]),
  photo('shoreline', 'Shoreline', [
    '#332708',
    '#371f00',
    '#281e11',
    '#272015',
    '#1a1b1d',
  ]),
  photo('delta', 'Delta', [
    '#271f1a',
    '#21201f',
    '#291e17',
    '#042327',
    '#002531',
  ]),
  photo('palms', 'Palms', [
    '#1c1513',
    '#2a160c',
    '#341700',
    '#351c00',
    '#2e1404',
  ]),
  photo('storm', 'Storm', [
    '#2e1927',
    '#3a1617',
    '#381712',
    '#21151d',
    '#1b1212',
  ]),
  { id: 'none', name: 'None' },
];

/** The wallpaper for an id; an unknown id, say from another build, gets the default. */
export function wallpaperById(id: string) {
  return (
    WALLPAPERS.find((wallpaper) => wallpaper.id === id) ??
    WALLPAPERS.find((wallpaper) => wallpaper.id === DEFAULT_WALLPAPER)!
  );
}
