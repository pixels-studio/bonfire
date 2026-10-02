<script lang="ts">
  import type { ConversationMessage } from '$shared/contracts';

  let { message }: { message: ConversationMessage } = $props();
</script>

<article class:user={message.role === 'user'} class="message">
  <p>{message.text}</p>
</article>

<style>
  .message {
    color: var(--foreground-muted);
    font-size: 14px;
    line-height: 20px;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .message p {
    margin: 0;
  }
  .user {
    align-self: flex-end;
    width: fit-content;
    max-width: min(400px, 88%);
    padding: 8px 16px;
    border-radius: 20px;
    background: var(--surface-raised);
    color: var(--foreground);
  }
</style>
