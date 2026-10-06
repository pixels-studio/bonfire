<script lang="ts">
  import AttachmentChip from './attachment-chip.svelte';
  import EditedFiles from './edited-files.svelte';
  import TextView from './text-view.svelte';
  import ThinkingView from './thinking-view.svelte';
  import ToolView from './tool-view.svelte';
  import WorkGroup from './work-group.svelte';
  import type { ConversationMessage } from '$shared/contracts';
  import { editedPaths, promptParts } from '$shared/domain';

  let {
    messages,
    paneId,
    projectId,
    expanded,
  }: {
    /** A prompt (with its attachments) followed by the assistant's replies. */
    messages: ConversationMessage[];
    /** The pane the turn belongs to, so its last reply can be forked into a new one. */
    paneId: string;
    /** The pane's project, so the turn's edited files can be looked up; unset for very old panes. */
    projectId?: string;
    /** Keeps the turn as it streamed, rather than folding its work away. */
    expanded: boolean;
  } = $props();

  const promptLength = $derived.by(() => {
    const index = messages.findIndex((item) => item.role !== 'user');
    return index === -1 ? messages.length : index;
  });
  const replies = $derived(messages.slice(promptLength));
  const prompt = $derived(messages.slice(0, promptLength));
  const promptAttachments = $derived(
    new Map(
      prompt
        .filter((item) => item.kind === 'attachment')
        .map((item) => [item.id, item]),
    ),
  );
  /** Attachments the text places itself; the rest are shown on their own. */
  const placed = $derived(
    new Set(
      prompt.flatMap((item) =>
        item.kind === 'text'
          ? promptParts(item.text).flatMap((part) =>
              'attachmentId' in part ? [part.attachmentId] : [],
            )
          : [],
      ),
    ),
  );
  // A turn loaded from history folds everything up to its last tool call away. One watched
  // live is never regrouped when it ends, which would shrink the page and remount its rows.
  // A call that returned an image is never folded in: it's worth seeing without expanding.
  const workLength = $derived(
    expanded
      ? 0
      : replies.findLastIndex(
          (item) => item.kind === 'tool' && !item.tool?.images?.length,
        ) + 1,
  );
  /** The turn's final reply, which carries the copy button and timestamp once complete. */
  const lastReplyId = $derived(
    replies.findLast(
      (item) => item.kind === 'text' && item.role === 'assistant',
    )?.id,
  );
  const editedFilePaths = $derived(editedPaths(replies));
  const turnComplete = $derived(
    replies.length > 0 && !replies.some((item) => item.status === 'streaming'),
  );
</script>

{#snippet entry(message: ConversationMessage)}
  {#if message.kind === 'text' || message.kind === 'error' || message.kind === 'capacity'}
    <TextView {message} {paneId} isLastReply={message.id === lastReplyId} />
  {:else if message.kind === 'thinking'}
    <!-- Thinking without text (e.g. redacted) has nothing to expand. -->
    {#if message.text || message.status === 'streaming'}
      <ThinkingView {message} />
    {/if}
  {:else if message.kind === 'notice'}
    <div
      class="flex items-center gap-3 text-xs text-muted-foreground"
      role="separator"
      aria-label={message.text}
    >
      <span class="h-px grow bg-border"></span>
      {message.text}
      <span class="h-px grow bg-border"></span>
    </div>
  {:else if message.kind === 'tool'}
    <ToolView {message} />
  {/if}
{/snippet}

{#each prompt as message (message.id)}
  {#if message.kind === 'attachment'}
    {#if !placed.has(message.id)}
      <p
        class="w-fit max-w-4/5 self-end rounded-3xl bg-surface-raised px-4 py-2 text-sm @lg:max-w-100"
      >
        <AttachmentChip name={message.text} previewUrl={message.previewUrl} />
      </p>
    {/if}
  {:else if message.kind === 'text' && message.role === 'user' && promptParts(message.text).some((part) => !('text' in part))}
    {@const parts = promptParts(message.text)}
    <!-- Chips and skills sit in the text where the user put them. -->
    <p
      class={[
        'w-fit max-w-4/5 self-end rounded-3xl bg-surface-raised px-4 py-2 text-sm whitespace-pre-wrap text-foreground wrap-anywhere @lg:max-w-100',
        parts.some((part) => 'attachmentId' in part) && 'leading-7',
      ]}
    >
      {#each parts as part}
        {#if 'skill' in part}<span class="text-brand">/{part.skill}</span
          >{:else if 'attachmentId' in part}
          {@const attachment = promptAttachments.get(part.attachmentId)}
          {#if attachment}
            <AttachmentChip
              name={attachment.text}
              previewUrl={attachment.previewUrl}
            />
          {/if}
        {:else}{part.text}{/if}
      {/each}
    </p>
  {:else}
    {@render entry(message)}
  {/if}
{/each}
{#if workLength}
  <WorkGroup messages={replies.slice(0, workLength)}>
    {#each replies.slice(0, workLength) as message (message.id)}
      {@render entry(message)}
    {/each}
  </WorkGroup>
{/if}
{#each replies.slice(workLength) as message (message.id)}
  {@render entry(message)}
{/each}
{#if turnComplete && projectId && editedFilePaths.length}
  <EditedFiles {projectId} paths={editedFilePaths} />
{/if}
