<script lang="ts">
  import Icon from '$lib/components/icon/icon.svelte';
  import Markdown from './markdown.svelte';
  import type { ConversationMessage } from '$shared/contracts';

  let { message }: { message: ConversationMessage } = $props();
  const streaming = $derived(message.status === 'streaming');
</script>

<details class="group text-sm text-muted-foreground">
  <summary
    class="flex w-fit cursor-pointer list-none items-center gap-1 hover:text-foreground [&::-webkit-details-marker]:hidden"
  >
    <span class={streaming ? 'shimmer-text' : ''}>
      {streaming ? 'Thinking' : 'Thought process'}
    </span>
    <Icon
      name="chevron-down"
      class="size-3.5 text-muted-foreground transition-transform group-open:rotate-180 motion-reduce:transition-none"
    />
  </summary>
  {#if message.text}
    <Markdown
      text={message.text}
      class="mt-2 border-l border-border pl-3 prose-muted"
    />
  {/if}
</details>
