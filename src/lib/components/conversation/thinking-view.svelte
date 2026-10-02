<script lang="ts">
  import type { ConversationMessage } from '$shared/contracts';

  let { message }: { message: ConversationMessage } = $props();
</script>

<details class="thinking" open={message.status === 'streaming'}>
  <summary>{message.status === 'streaming' ? 'Thinking…' : 'Thought process'}</summary>
  <p>{message.text}</p>
</details>

<style>
  .thinking {
    color: var(--foreground-subtle);
    font-size: 13px;
    line-height: 19px;
  }
  summary {
    cursor: pointer;
    width: fit-content;
  }
  p {
    margin: 8px 0 0;
    white-space: pre-wrap;
  }
</style>
