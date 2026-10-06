import type { AssistantProvider, Attachment } from '$shared/contracts';
import { errorMessage } from '$shared/domain';
import { toast } from './toast.svelte';

/** A fork's summary, waiting for its new pane's composer to mount so it can show it. */
export const forkSeeds = new Map<string, Attachment>();

/** Summarizes a conversation up to a reply and opens the summary in a new pane. */
class ForkStore {
  /** The reply id being summarized, if any; a reply can only be forked once at a time. */
  running = $state<string>();
  /** Told of the pane a fork opened, so it can be brought on screen. */
  onForked?: (paneId: string) => void | Promise<void>;

  async run(paneId: string, messageId: string, provider: AssistantProvider) {
    if (this.running) return;
    this.running = messageId;
    try {
      const forked = await window.bonfire.panes.fork(
        paneId,
        messageId,
        provider,
      );
      forkSeeds.set(forked.pane.id, forked.attachment);
      await this.onForked?.(forked.pane.id);
    } catch (cause) {
      toast(errorMessage(cause), { variant: 'error' });
    } finally {
      this.running = undefined;
    }
  }
}

export const fork = new ForkStore();
