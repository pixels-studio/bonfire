import { randomUUID } from 'node:crypto';
import { readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { NativeImage } from 'electron';
import type { Attachment, ConversationMessage } from '../../shared/contracts';

/**
 * The side, in pixels, of the square preview kept for an image. Chips draw it at 16px, so
 * this stays sharp at 4x while weighing a few kilobytes instead of the whole image.
 */
const PREVIEW_SIZE = 64;
/** Images the preview can't be made from are kept as they are only up to this size. */
const MAX_RAW_PREVIEW_BYTES = 128_000;

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
    previewUrl: await imagePreview(data, mimeType, path),
  };
}

/** A centred square of the image, scaled down to the preview size, as a PNG data URL. */
function squarePreview(image: NativeImage) {
  if (image.isEmpty()) return undefined;
  const { width, height } = image.getSize();
  const side = Math.min(width, height);
  const square = image.crop({
    x: Math.floor((width - side) / 2),
    y: Math.floor((height - side) / 2),
    width: side,
    height: side,
  });
  const size = Math.min(side, PREVIEW_SIZE);
  return square
    .resize({ width: size, height: size, quality: 'good' })
    .toDataURL();
}

/**
 * A small preview of an image for its chip. PNG and JPEG are scaled directly; other formats
 * go through the system's thumbnailer when the file is at hand, and are otherwise kept
 * whole if small, or left without a preview.
 */
export async function imagePreview(
  data: Buffer,
  mimeType: string,
  path?: string,
): Promise<string | undefined> {
  // Loaded on use, so code that never handles an image runs outside Electron, as in tests.
  const { nativeImage } = await import('electron');
  const preview = squarePreview(nativeImage.createFromBuffer(data));
  if (preview) return preview;
  if (path && process.platform !== 'linux') {
    const size = { width: PREVIEW_SIZE, height: PREVIEW_SIZE };
    const thumbnail = await nativeImage
      .createThumbnailFromPath(path, size)
      .catch(() => undefined);
    const fromThumbnail = thumbnail && squarePreview(thumbnail);
    if (fromThumbnail) return fromThumbnail;
  }
  return data.byteLength <= MAX_RAW_PREVIEW_BYTES
    ? `data:${mimeType};base64,${data.toString('base64')}`
    : undefined;
}

/** Previews larger than this were saved whole by older versions. */
const LEGACY_PREVIEW_LENGTH = 32_000;

/**
 * Older versions kept each image's whole data as its preview, which made saved state
 * megabytes per image. Shrinks those in place; returns whether any changed.
 */
export async function shrinkPreviews(messages: ConversationMessage[]) {
  let changed = false;
  for (const message of messages) {
    const url = message.previewUrl;
    if (!url || url.length <= LEGACY_PREVIEW_LENGTH) continue;
    const match = /^data:([^;,]+);base64,/.exec(url);
    if (!match) continue;
    const data = Buffer.from(url.slice(match[0].length), 'base64');
    message.previewUrl = await imagePreview(data, match[1]);
    changed = true;
  }
  return changed;
}

/** Where a pasted image is written, as providers read images from disk. */
export const PASTE_FOLDER_PREFIX = 'bonfire-paste-';
/** How long pasted images are kept: past any turn that could still be reading one. */
const PASTE_TTL_MS = 24 * 60 * 60_000;

/** Removes pasted images left from earlier days; nothing else ever deletes them. */
export async function removeStalePastes(now = Date.now()) {
  const root = tmpdir();
  const names = await readdir(root).catch(() => []);
  await Promise.all(
    names
      .filter((name) => name.startsWith(PASTE_FOLDER_PREFIX))
      .map(async (name) => {
        const folder = join(root, name);
        const { mtimeMs } = await stat(folder);
        if (now - mtimeMs > PASTE_TTL_MS)
          await rm(folder, { recursive: true, force: true });
      })
      .map((removal) => removal.catch(() => {})),
  );
}

/** The file extension for image data, judged by its leading bytes; undefined if not a supported image. */
export function sniffImageExtension(data: Uint8Array) {
  const starts = (...bytes: number[]) => bytes.every((b, i) => data[i] === b);
  if (starts(0x89, 0x50, 0x4e, 0x47)) return 'png';
  if (starts(0xff, 0xd8, 0xff)) return 'jpg';
  if (starts(0x47, 0x49, 0x46, 0x38)) return 'gif';
  if (starts(0x52, 0x49, 0x46, 0x46) && data[8] === 0x57 && data[9] === 0x45)
    return 'webp';
  return undefined;
}

const PASTED_TEXT_NAME = 'Pasted text.txt';

/** An attachment waiting to be sent, owned by a pane. */
export type PendingAttachment = Attachment & { paneId: string } & (
    | { kind: 'image'; path: string; mimeType: ImageMimeType; base64: string }
    | { kind: 'text'; text: string }
  );

/** Attachments picked or pasted but not yet sent, shared by every provider. */
export class PendingAttachments {
  private readonly items = new Map<string, PendingAttachment>();

  async addImage(paneId: string, file: { name: string; path: string }) {
    const { size, previewUrl, mimeType, base64 } = await readImage(file.path);
    const attachment = { id: randomUUID(), name: file.name, size, previewUrl };
    this.items.set(attachment.id, {
      ...attachment,
      paneId,
      kind: 'image',
      path: file.path,
      mimeType,
      base64,
    });
    return attachment;
  }

  /** Holds pasted text as an attachment, so a long paste doesn't flood the message. */
  addText(paneId: string, text: string): Attachment {
    const attachment = {
      id: randomUUID(),
      name: PASTED_TEXT_NAME,
      size: Buffer.byteLength(text),
    };
    this.items.set(attachment.id, {
      ...attachment,
      paneId,
      kind: 'text',
      text,
    });
    return attachment;
  }

  /** The pane's attachments with these ids; throws if any is gone or belongs elsewhere. */
  get(paneId: string, ids: string[]) {
    return ids.map((id) => {
      const attachment = this.items.get(id);
      if (attachment?.paneId !== paneId)
        throw Error('Attachment is no longer available');
      return attachment;
    });
  }

  delete(ids: Iterable<string>) {
    for (const id of ids) this.items.delete(id);
  }

  /** Drops everything the pane still holds. */
  discard(paneId: string) {
    for (const [id, attachment] of this.items)
      if (attachment.paneId === paneId) this.items.delete(id);
  }
}
