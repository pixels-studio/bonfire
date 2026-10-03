import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { Attachment } from '../../shared/contracts';

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
