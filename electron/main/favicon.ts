import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

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

export async function favicon(projectPath: string): Promise<string | null> {
  for (const candidate of CANDIDATES) {
    try {
      const data = await readFile(join(projectPath, candidate));
      return `data:${mimeFor(candidate)};base64,${data.toString('base64')}`;
    } catch {
      continue;
    }
  }
  return null;
}
