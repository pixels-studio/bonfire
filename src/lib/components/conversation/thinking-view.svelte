<script lang="ts">
  import type { ConversationMessage } from '$shared/contracts';

  let { message }: { message: ConversationMessage } = $props();
  const streaming = $derived(message.status === 'streaming');
</script>

<details class="text-sm text-muted-foreground" open={streaming}>
  <summary class="w-fit cursor-pointer">
    {streaming ? 'Thinking…' : 'Thought process'}
  </summary>
  <p class="mt-2 whitespace-pre-wrap">{message.text}</p>
</details>
