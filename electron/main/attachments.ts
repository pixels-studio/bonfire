import { readFile, stat } from 'node:fs/promises';

function mimeFor(path: string) {
  const ext = path.split('.').pop()?.toLowerCase();
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'gif') return 'image/gif';
  return 'image/jpeg';
}

export async function readAttachment(path: string) {
  const [data, stats] = await Promise.all([readFile(path), stat(path)]);
  return {
    size: stats.size,
    previewUrl: `data:${mimeFor(path)};base64,${data.toString('base64')}`,
  };
}
