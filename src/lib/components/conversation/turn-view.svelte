<script lang="ts">
  import AttachmentView from './attachment-view.svelte';
  import TextView from './text-view.svelte';
  import ThinkingView from './thinking-view.svelte';
  import ToolView from './tool-view.svelte';
  import WorkGroup from './work-group.svelte';
  import type { ConversationMessage } from '$shared/contracts';

  let {
    messages,
    expanded,
  }: {
    /** A prompt (with its attachments) followed by the assistant's replies. */
    messages: ConversationMessage[];
    /** Keeps the turn as it streamed, rather than folding its work away. */
    expanded: boolean;
  } = $props();

  const promptLength = $derived.by(() => {
    const index = messages.findIndex((item) => item.role !== 'user');
    return index === -1 ? messages.length : index;
  });
  const replies = $derived(messages.slice(promptLength));
  // A turn loaded from history folds everything up to its last tool call away. One watched
  // live is never regrouped when it ends, which would shrink the page and remount its rows.
  const workLength = $derived(
    expanded ? 0 : replies.findLastIndex((item) => item.kind === 'tool') + 1,
  );
</script>

{#snippet entry(message: ConversationMessage)}
  {#if message.kind === 'text' || message.kind === 'error'}
    <TextView {message} />
  {:else if message.kind === 'thinking'}
    <!-- Thinking without text (e.g. redacted) has nothing to expand. -->
    {#if message.text || message.status === 'streaming'}
      <ThinkingView {message} />
    {/if}
  {:else if message.kind === 'tool'}
    <ToolView {message} />
  {:else if message.kind === 'attachment'}
    <AttachmentView
      class="max-w-4/5 self-end @lg:max-w-100"
      name={message.text}
      size={message.size}
      previewUrl={message.previewUrl}
    />
  {/if}
{/snippet}

{#each messages.slice(0, promptLength) as message (message.id)}
  {@render entry(message)}
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
