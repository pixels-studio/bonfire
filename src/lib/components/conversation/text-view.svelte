<script lang="ts">
  import { cn } from '$lib/utils';
  import type { ConversationMessage } from '$shared/contracts';

  let { message }: { message: ConversationMessage } = $props();
</script>

<p
  class={cn(
    'text-sm whitespace-pre-wrap text-foreground/80 wrap-anywhere',
    message.role === 'user' &&
      'w-fit max-w-4/5 self-end rounded-3xl bg-surface-raised px-4 py-2 text-foreground @lg:max-w-100',
  )}
>
  {message.text}
</p>
