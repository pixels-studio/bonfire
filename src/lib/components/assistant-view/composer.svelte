<script lang="ts" module>
  import type { Attachment } from '$shared/contracts';

  /** Where picked and pasted attachments are held until the message is sent. */
  export type AttachmentSource = {
    pick: () => Promise<Attachment | null>;
    text: (text: string) => Promise<Attachment>;
  };
</script>

<script lang="ts">
  import ArrowUp from '@lucide/svelte/icons/arrow-up';
  import X from '@lucide/svelte/icons/x';
  import type { Snippet } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import * as Tooltip from '$lib/components/ui/tooltip';
  import Icon from '$lib/components/icon/icon.svelte';
  import AttachmentView from '../conversation/attachment-view.svelte';
  import { preferences } from '$lib/stores/preferences.svelte';
  import { toast } from '$lib/stores/toast.svelte';
  import { cn } from '$lib/utils';
  import { LONG_TEXT_THRESHOLD, errorMessage } from '$shared/domain';
  import {
    MAX_TEXT_ATTACHMENT_LENGTH,
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
    paneId = '',
    label,
    running = false,
    disabled = false,
    placeholder,
    attach = {
      pick: () => window.bonfire.assistant.pickAttachment(paneId),
      text: (text) => window.bonfire.assistant.attachText(paneId, text),
    },
    allowEmpty = false,
    submitLabel = 'Send message',
    textareaClass,
    autofocus = false,
    onsend,
    children,
  }: {
    /** The pane the composer sends to; unset when it starts something new. */
    paneId?: string;
    label: string;
    running?: boolean;
    /** Blocks sending, e.g. until a project is chosen. */
    disabled?: boolean;
    placeholder?: string;
    attach?: AttachmentSource;
    /** Lets an empty message be sent, for a composer that starts something rather than chats. */
    allowEmpty?: boolean;
    submitLabel?: string;
    textareaClass?: string;
    autofocus?: boolean;
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
    if ((!text && !allowEmpty) || disabled) return;
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
      const attachment = await attach.pick();
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
      attachments.push(await attach.text(text));
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
  <!-- svelte-ignore a11y_autofocus -->
  <textarea
    class={cn(
      'block min-h-15 w-full resize-none bg-transparent text-sm outline-none placeholder:text-muted-foreground',
      textareaClass,
    )}
    aria-label={label}
    {autofocus}
    placeholder={placeholder ??
      (running ? FOLLOW_UP_PLACEHOLDERS[followUp] : 'Ask for changes')}
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
          <Icon name="stop" />
        </Button>
      {/if}
      {#if !running || prompt.trim()}
        <Button
          type="submit"
          size="icon"
          class="bg-brand text-white hover:bg-brand/80"
          aria-label={running ? FOLLOW_UP_ACTIONS[followUp] : submitLabel}
          disabled={disabled || (!prompt.trim() && !allowEmpty)}
        >
          <ArrowUp />
        </Button>
      {/if}
    </div>
  </div>
</form>
