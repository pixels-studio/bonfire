import { randomUUID } from 'node:crypto';
import type {
  AssistantEvent,
  AssistantProvider,
  AssistantSendInput,
  Attachment,
  ConversationMessage,
  Pane,
  Session,
  Usage,
} from '../../shared/contracts';
import {
  PROVIDER_LABELS,
  errorMessage,
  isDefaultTitle,
  titleFrom,
} from '../../shared/domain';
import { readImage, type ImageMimeType } from './attachments';
import type { Store } from './persistence';

export type ChooseImage = () => Promise<
  { name: string; path: string } | undefined
>;

export type PendingAttachment = Attachment & {
  paneId: string;
  path: string;
  mimeType: ImageMimeType;
  base64: string;
};

export type Turn = {
  pane: Pane;
  session: Session;
  input: AssistantSendInput;
  attachments: PendingAttachment[];
  controller: AbortController;
};

type MessageKind = ConversationMessage['kind'];
type MessageStatus = ConversationMessage['status'];

export function assistantMessage(
  id: string,
  kind: MessageKind,
  text: string,
  status: MessageStatus = 'complete',
): ConversationMessage {
  return { id, role: 'assistant', kind, text, status };
}

/** Shared turn lifecycle for chat providers; subclasses only translate SDK events. */
export abstract class ChatAssistant {
  protected abstract readonly provider: AssistantProvider;
  private readonly turns = new Map<string, AbortController>();
  private readonly attachments = new Map<string, PendingAttachment>();

  constructor(
    private readonly store: Store,
    private readonly emit: (event: AssistantEvent) => void,
    private readonly chooseImage: ChooseImage,
  ) {}

  protected abstract run(turn: Turn): Promise<void>;

  async pickAttachment(paneId: string): Promise<Attachment | null> {
    this.paneFor(paneId);
    const file = await this.chooseImage();
    if (!file) return null;
    const { size, previewUrl, mimeType, base64 } = await readImage(file.path);
    const attachment = { id: randomUUID(), name: file.name, size, previewUrl };
    this.attachments.set(attachment.id, {
      ...attachment,
      paneId,
      path: file.path,
      mimeType,
      base64,
    });
    return attachment;
  }

  async send(input: AssistantSendInput) {
    const pane = this.paneFor(input.paneId);
    const label = PROVIDER_LABELS[this.provider];
    if (this.turns.has(pane.id)) throw Error(`${label} is already responding`);

    const attachments = input.attachmentIds.map((id) => {
      const attachment = this.attachments.get(id);
      if (attachment?.paneId !== pane.id)
        throw Error('Attachment is no longer available');
      return attachment;
    });

    pane.model = input.model;
    pane.reasoningEffort = input.reasoningEffort;
    if (isDefaultTitle(pane.title)) pane.title = titleFrom(input.text);
    const { settings } = this.store.state;
    settings.lastProvider = this.provider;
    settings.lastModels = {
      ...settings.lastModels,
      [this.provider]: input.model,
    };

    for (const { id, name, size, previewUrl } of attachments)
      this.publish(pane, {
        id,
        role: 'user',
        kind: 'attachment',
        text: name,
        status: 'complete',
        size,
        previewUrl,
      });
    this.publish(pane, {
      id: randomUUID(),
      role: 'user',
      kind: 'text',
      text: input.text,
      status: 'complete',
    });

    const controller = new AbortController();
    this.turns.set(pane.id, controller);
    this.emit({ paneId: pane.id, type: 'status', status: 'running' });

    try {
      const session = this.store.session(pane.sessionId);
      await this.run({ pane, session, input, attachments, controller });
    } catch (cause) {
      if (!controller.signal.aborted) {
        const error = errorMessage(cause);
        this.publishError(pane, error);
        this.emit({ paneId: pane.id, type: 'status', status: 'failed', error });
      }
    } finally {
      for (const { id } of attachments) this.attachments.delete(id);
      this.turns.delete(pane.id);
      this.emit({ paneId: pane.id, type: 'status', status: 'idle' });
    }
  }

  cancel(paneId: string) {
    this.paneFor(paneId);
    this.turns.get(paneId)?.abort();
  }

  close() {
    for (const controller of this.turns.values()) controller.abort();
    this.turns.clear();
  }

  /** Inserts or replaces a message, optionally persisting, and notifies the renderer. */
  protected publish(pane: Pane, message: ConversationMessage, persist = true) {
    const index = pane.messages.findIndex((item) => item.id === message.id);
    if (index === -1) pane.messages.push(message);
    else pane.messages[index] = message;
    if (persist) this.store.save();
    this.emit({ paneId: pane.id, type: 'message', message });
  }

  protected publishError(pane: Pane, text: string) {
    this.publish(pane, assistantMessage(randomUUID(), 'error', text, 'failed'));
  }

  protected publishUsage(pane: Pane, usage: Usage) {
    pane.usage = usage;
    this.store.save();
    this.emit({ paneId: pane.id, type: 'usage', usage });
  }

  protected rememberThread(pane: Pane, threadId: string) {
    if (pane.threadId === threadId) return;
    pane.threadId = threadId;
    this.store.save();
  }

  private paneFor(paneId: string) {
    const pane = this.store.pane(paneId);
    if (pane.type !== this.provider)
      throw Error(
        `This pane is not a ${PROVIDER_LABELS[this.provider]} assistant`,
      );
    return pane;
  }
}
