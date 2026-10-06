<script lang="ts">
  import Markdown from './markdown.svelte';
  import type { ConversationMessage } from '$shared/contracts';

  let { message }: { message: ConversationMessage } = $props();
</script>

{#if message.role === 'user'}
  <p
    class="w-fit max-w-4/5 self-end rounded-md bg-surface-raised px-4 py-2 text-sm whitespace-pre-wrap text-foreground wrap-anywhere @lg:max-w-100"
  >
    {message.text}
  </p>
{:else if message.kind === 'error' || message.kind === 'capacity'}
  <p class="text-sm whitespace-pre-wrap text-destructive wrap-anywhere">
    {message.text}
  </p>
{:else}
  <Markdown text={message.text} />
{/if}
