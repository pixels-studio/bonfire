import { randomUUID } from 'node:crypto';
import { readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { NativeImage } from 'electron';
import type { Attachment, ConversationMessage } from '../../shared/contracts';

/**
 * The longer side, in pixels, of the preview kept for an image. Its chip crops it to a
 * 16px square with CSS; a hover hands the same preview to the full image, uncropped, so
 * this is sized for that larger use rather than the chip.
 */
const PREVIEW_MAX_SIZE = 480;
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

/** Makes an image's preview; where Electron's image tools are out of reach, another process's. */
export type Previewer = (
  data: Buffer,
  mimeType: string,
  path?: string,
) => Promise<string | undefined>;

export async function readImage(
  path: string,
  preview: Previewer = imagePreview,
) {
  const data = await readFile(path);
  const mimeType = imageMimeType(path);
  const base64 = data.toString('base64');
  return {
    size: data.byteLength,
    mimeType,
    base64,
    previewUrl: await preview(data, mimeType, path),
  };
}

/** The image scaled down to fit within the preview size, kept at its own aspect ratio. */
function scaledPreview(image: NativeImage) {
  if (image.isEmpty()) return undefined;
  const { width, height } = image.getSize();
  if (Math.max(width, height) <= PREVIEW_MAX_SIZE) return image.toDataURL();
  // Only the longer side is given, so Electron scales the other to match it.
  const long = width >= height ? 'width' : 'height';
  return image
    .resize({ [long]: PREVIEW_MAX_SIZE, quality: 'good' })
    .toDataURL();
}

/**
 * A preview of an image, for its chip and the larger view hovering it shows. PNG and JPEG
 * are scaled directly; other formats go through the system's thumbnailer when the file is
 * at hand, and are otherwise kept whole if small, or left without a preview.
 */
export async function imagePreview(
  data: Buffer,
  mimeType: string,
  path?: string,
): Promise<string | undefined> {
  // Loaded on use, so code that never handles an image runs outside Electron, as in tests.
  const { nativeImage } = await import('electron');
  const preview = scaledPreview(nativeImage.createFromBuffer(data));
  if (preview) return preview;
  if (path && process.platform !== 'linux') {
    const size = { width: PREVIEW_MAX_SIZE, height: PREVIEW_MAX_SIZE };
    const thumbnail = await nativeImage
      .createThumbnailFromPath(path, size)
      .catch(() => undefined);
    const fromThumbnail = thumbnail && scaledPreview(thumbnail);
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
 * megabytes per image. Returns those messages with their previews shrunk, to replace them.
 */
export async function shrinkPreviews(
  messages: readonly Readonly<ConversationMessage>[],
) {
  const shrunk: ConversationMessage[] = [];
  for (const message of messages) {
    const url = message.previewUrl;
    if (!url || url.length <= LEGACY_PREVIEW_LENGTH) continue;
    const match = /^data:([^;,]+);base64,/.exec(url);
    if (!match) continue;
    const data = Buffer.from(url.slice(match[0].length), 'base64');
    shrunk.push({
      ...(message as ConversationMessage),
      previewUrl: await imagePreview(data, match[1]),
    });
  }
  return shrunk;
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

  constructor(private readonly preview: Previewer = imagePreview) {}

  async addImage(paneId: string, file: { name: string; path: string }) {
    const { size, previewUrl, mimeType, base64 } = await readImage(
      file.path,
      this.preview,
    );
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
  addText(paneId: string, text: string, name = PASTED_TEXT_NAME): Attachment {
    const attachment = {
      id: randomUUID(),
      name,
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
