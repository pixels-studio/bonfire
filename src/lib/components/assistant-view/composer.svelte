<script lang="ts">
  import ArrowUp from '@lucide/svelte/icons/arrow-up';
  import Square from '@lucide/svelte/icons/square';
  import X from '@lucide/svelte/icons/x';
  import type { Snippet } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import * as Tooltip from '$lib/components/ui/tooltip';
  import Icon from '$lib/components/icon/icon.svelte';
  import AttachmentView from '../conversation/attachment-view.svelte';
  import { toast } from '$lib/stores/toast.svelte';
  import { errorMessage } from '$shared/domain';
  import type { Attachment } from '$shared/contracts';

  const MAX_ATTACHMENTS = 8;

  let {
    paneId,
    label,
    running,
    onsend,
    children,
  }: {
    paneId: string;
    label: string;
    running: boolean;
    onsend: (text: string, attachmentIds: string[]) => void;
    children: Snippet;
  } = $props();

  let prompt = $state('');
  let attachments = $state<Attachment[]>([]);
  const canAttach = $derived(!running && attachments.length < MAX_ATTACHMENTS);

  function send() {
    const text = prompt.trim();
    if (!text || running) return;
    onsend(
      text,
      attachments.map(({ id }) => id),
    );
    prompt = '';
    attachments = [];
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
    if (event.key !== 'Enter' || event.shiftKey) return;
    event.preventDefault();
    send();
  }
</script>

<form
  class="rounded-lg bg-composer px-4 py-3"
  onsubmit={(event) => {
    event.preventDefault();
    send();
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
    placeholder="Ask for changes"
    bind:value={prompt}
    onkeydown={handleKeydown}
    disabled={running}></textarea>
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
      {:else}
        <Button
          type="submit"
          size="icon"
          class="bg-brand text-white hover:bg-brand/80"
          aria-label="Send message"
          disabled={!prompt.trim()}
        >
          <ArrowUp />
        </Button>
      {/if}
    </div>
  </div>
</form>
