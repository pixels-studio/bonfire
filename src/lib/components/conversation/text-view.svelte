<script lang="ts">
  import Icon from '$lib/components/icon/icon.svelte';
  import { Button } from '$lib/components/ui/button';
  import * as Tooltip from '$lib/components/ui/tooltip';
  import Markdown from './markdown.svelte';
  import { toast } from '$lib/stores/toast.svelte';
  import { errorMessage } from '$shared/domain';
  import type { ConversationMessage } from '$shared/contracts';

  let {
    message,
    isLastReply = false,
  }: { message: ConversationMessage; isLastReply?: boolean } = $props();

  let copied = $state(false);

  const seconds = $derived(
    message.durationMs === undefined
      ? null
      : Math.max(1, Math.round(message.durationMs / 1000)),
  );
  const time = $derived(
    message.createdAt === undefined
      ? null
      : new Date(message.createdAt).toLocaleTimeString(undefined, {
          hour: 'numeric',
          minute: '2-digit',
        }),
  );

  async function copy() {
    try {
      await window.bonfire.app.copyText(message.text);
      copied = true;
      setTimeout(() => (copied = false), 1500);
    } catch (cause) {
      toast(errorMessage(cause), { variant: 'error' });
    }
  }
</script>

{#if message.role === 'user'}
  <p
    class="w-fit max-w-4/5 self-end rounded-3xl bg-surface-raised px-4 py-2 text-sm whitespace-pre-wrap text-foreground wrap-anywhere @lg:max-w-100"
  >
    {message.text}
  </p>
{:else if message.kind === 'error' || message.kind === 'capacity'}
  <p class="text-sm whitespace-pre-wrap text-destructive wrap-anywhere">
    {message.text}
  </p>
{:else}
  <Markdown text={message.text} />
  {#if isLastReply && message.status === 'complete'}
    <div class="flex items-center gap-1.5 text-xs text-muted-foreground">
      {#if seconds !== null}
        <span class="tabular-nums">{seconds}s</span>
        <span aria-hidden="true">·</span>
      {/if}
      {#if time !== null}
        <span class="tabular-nums">{time}</span>
        <span aria-hidden="true">·</span>
      {/if}
      <Tooltip.Root>
        <Tooltip.Trigger>
          {#snippet child({ props })}
            <Button
              {...props}
              variant="ghost"
              size="icon-xs"
              aria-label="Copy response"
              class={copied
                ? 'bg-green-600/10 text-green-600 hover:bg-green-600/10 hover:text-green-600'
                : 'text-muted-foreground hover:text-foreground'}
              onclick={copy}
            >
              <Icon name={copied ? 'check' : 'copy'} />
            </Button>
          {/snippet}
        </Tooltip.Trigger>
        <Tooltip.Content>{copied ? 'Copied' : 'Copy'}</Tooltip.Content>
      </Tooltip.Root>
    </div>
  {/if}
{/if}
