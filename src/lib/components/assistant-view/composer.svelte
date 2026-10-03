<script lang="ts">
  import ArrowUp from '@lucide/svelte/icons/arrow-up';
  import Square from '@lucide/svelte/icons/square';
  import X from '@lucide/svelte/icons/x';
  import type { Snippet } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import * as Tooltip from '$lib/components/ui/tooltip';
  import Icon from '$lib/components/icon/icon.svelte';
  import AttachmentView from '../conversation/attachment-view.svelte';
  import { preferences } from '$lib/stores/preferences.svelte';
  import { toast } from '$lib/stores/toast.svelte';
  import { LONG_TEXT_THRESHOLD, errorMessage } from '$shared/domain';
  import {
    MAX_TEXT_ATTACHMENT_LENGTH,
    type Attachment,
    type FollowUpMode,
  } from '$shared/contracts';

  const MAX_ATTACHMENTS = 8;
  const FOLLOW_UP_ACTIONS: Record<FollowUpMode, string> = {
    queue: 'Queue message',
    steer: 'Steer response',
  };
  const FOLLOW_UP_PLACEHOLDERS: Record<FollowUpMode, string> = {
    queue: 'Queue a follow-up',
    steer: 'Steer the current run',
  };

  let {
    paneId,
    label,
    running,
    disabled,
    onsend,
    children,
  }: {
    paneId: string;
    label: string;
    running: boolean;
    /** Blocks sending, e.g. until a project is chosen. */
    disabled: boolean;
    /**
     * Sends the message; `followUp` says how, when a turn is already running. A
     * rejection hands the draft back to the composer.
     */
    onsend: (
      text: string,
      attachmentIds: string[],
      followUp?: FollowUpMode,
    ) => Promise<void>;
    children: Snippet;
  } = $props();

  let prompt = $state('');
  let attachments = $state<Attachment[]>([]);
  const canAttach = $derived(attachments.length < MAX_ATTACHMENTS);
  const followUp = $derived(preferences.current.followUp);

  /** Sends the draft. While a turn runs, `invert` swaps queueing and steering for this message. */
  async function send(invert = false) {
    const text = prompt.trim();
    if (!text || disabled) return;
    const draft = { prompt, attachments };
    prompt = '';
    attachments = [];
    try {
      await onsend(
        text,
        draft.attachments.map(({ id }) => id),
        running ? followUpMode(invert) : undefined,
      );
    } catch {
      // Nothing typed is lost, unless the user has already started a new draft.
      if (!prompt && !attachments.length) ({ prompt, attachments } = draft);
    }
  }

  function followUpMode(invert: boolean): FollowUpMode {
    if (!invert) return followUp;
    return followUp === 'queue' ? 'steer' : 'queue';
  }

  async function pickAttachment() {
    try {
      const attachment = await window.bonfire.assistant.pickAttachment(paneId);
      if (attachment) attachments.push(attachment);
    } catch (cause) {
      toast(errorMessage(cause), { variant: 'error' });
    }
  }

  function removeAttachment(id: string) {
    attachments = attachments.filter((attachment) => attachment.id !== id);
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    void send(event.metaKey || event.ctrlKey);
  }

  /** Turns a long paste into an attachment, so the message itself stays readable. */
  async function handlePaste(event: ClipboardEvent) {
    const text = event.clipboardData?.getData('text/plain') ?? '';
    if (
      !preferences.current.convertLongText ||
      text.length <= LONG_TEXT_THRESHOLD
    )
      return;
    event.preventDefault();
    if (!canAttach) {
      toast(`You can attach up to ${MAX_ATTACHMENTS} files.`);
      return;
    }
    if (text.length > MAX_TEXT_ATTACHMENT_LENGTH) {
      toast('That text is too long to attach.', { variant: 'error' });
      return;
    }
    try {
      attachments.push(await window.bonfire.assistant.attachText(paneId, text));
    } catch (cause) {
      toast(errorMessage(cause), { variant: 'error' });
    }
  }
</script>

<form
  class="rounded-lg bg-composer px-4 py-3"
  onsubmit={(event) => {
    event.preventDefault();
    void send();
  }}
>
  {#if attachments.length}
    <div
      class="flex gap-2 overflow-x-auto pb-2"
      aria-label="Selected attachments"
    >
      {#each attachments as attachment (attachment.id)}
        <div class="relative shrink-0">
          <AttachmentView
            class="max-w-60"
            name={attachment.name}
            size={attachment.size}
            previewUrl={attachment.previewUrl}
          />
          <button
            type="button"
            class="absolute top-1 right-1 grid place-items-center rounded-full bg-muted p-1"
            aria-label={`Remove ${attachment.name}`}
            onclick={() => removeAttachment(attachment.id)}
          >
            <X class="size-3" />
          </button>
        </div>
      {/each}
    </div>
  {/if}
  <textarea
    class="block min-h-15 w-full resize-none bg-transparent text-sm outline-none placeholder:text-muted-foreground"
    aria-label={label}
    placeholder={disabled
      ? 'Select a project to start'
      : running
        ? FOLLOW_UP_PLACEHOLDERS[followUp]
        : 'Ask for changes'}
    bind:value={prompt}
    onkeydown={handleKeydown}
    onpaste={handlePaste}></textarea>
  <div class="flex items-center justify-between gap-3">
    <div class="flex min-w-0 items-center gap-6">
      {@render children()}
    </div>
    <div class="flex items-center gap-2.5">
      <Tooltip.Root>
        <Tooltip.Trigger>
          {#snippet child({ props })}
            <Button
              {...props}
              variant="secondary"
              size="icon"
              aria-label="Add image"
              disabled={!canAttach}
              onclick={pickAttachment}
            >
              <Icon name="attachment" />
            </Button>
          {/snippet}
        </Tooltip.Trigger>
        <Tooltip.Content>Add image</Tooltip.Content>
      </Tooltip.Root>
      {#if running}
        <Button
          variant="secondary"
          size="icon"
          aria-label="Stop response"
          onclick={() => window.bonfire.assistant.cancel(paneId)}
        >
          <Square />
        </Button>
      {/if}
      {#if !running || prompt.trim()}
        <Button
          type="submit"
          size="icon"
          class="bg-brand text-white hover:bg-brand/80"
          aria-label={running ? FOLLOW_UP_ACTIONS[followUp] : 'Send message'}
          disabled={disabled || !prompt.trim()}
        >
          <ArrowUp />
        </Button>
      {/if}
    </div>
  </div>
</form>
