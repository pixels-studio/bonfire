import { resolvePlace, type Place } from './machines';

/** Favicons larger than this aren't worth sending to the renderer. */
const FAVICON_LIMIT_BYTES = 512 * 1024;

const CANDIDATES = [
  'public/favicon.svg',
  'public/favicon.ico',
  'public/favicon.png',
  'static/favicon.svg',
  'static/favicon.ico',
  'static/favicon.png',
  'favicon.svg',
  'favicon.ico',
  'favicon.png',
  'src/favicon.svg',
  'src/favicon.ico',
  'src/favicon.png',
];

function mimeFor(path: string) {
  if (path.endsWith('.svg')) return 'image/svg+xml';
  if (path.endsWith('.png')) return 'image/png';
  return 'image/x-icon';
}

export async function favicon(project: Place): Promise<string | null> {
  const { machine, path } = resolvePlace(project);
  for (const candidate of CANDIDATES) {
    try {
      const data = await machine.readFile(
        machine.path.join(path, candidate),
        FAVICON_LIMIT_BYTES,
      );
      return `data:${mimeFor(candidate)};base64,${data.toString('base64')}`;
    } catch {
      continue;
    }
  }
  return null;
}
