import { readFile } from 'node:fs/promises';

export type ImageMimeType =
  'image/png' | 'image/webp' | 'image/gif' | 'image/jpeg';

export function imageMimeType(path: string): ImageMimeType {
  const extension = path.split('.').pop()?.toLowerCase();
  if (extension === 'png') return 'image/png';
  if (extension === 'webp') return 'image/webp';
  if (extension === 'gif') return 'image/gif';
  return 'image/jpeg';
}

export async function readImage(path: string) {
  const data = await readFile(path);
  const mimeType = imageMimeType(path);
  const base64 = data.toString('base64');
  return {
    size: data.byteLength,
    mimeType,
    base64,
    previewUrl: `data:${mimeType};base64,${base64}`,
  };
}
