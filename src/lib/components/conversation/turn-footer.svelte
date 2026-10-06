<script lang="ts">
  import Icon from '$lib/components/icon/icon.svelte';
  import { Button } from '$lib/components/ui/button';
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
  import * as Tooltip from '$lib/components/ui/tooltip';
  import { fork } from '$lib/stores/fork.svelte';
  import { preferences } from '$lib/stores/preferences.svelte';
  import { toast } from '$lib/stores/toast.svelte';
  import { PROVIDER_LABELS, errorMessage } from '$shared/domain';
  import type {
    AssistantProvider,
    ConversationMessage,
  } from '$shared/contracts';

  let {
    message,
    paneId,
  }: {
    message: ConversationMessage;
    paneId: string;
  } = $props();

  let copied = $state(false);
  const forking = $derived(fork.running === message.id);

  function forkTo(provider: AssistantProvider) {
    void fork.run(paneId, message.id, provider);
  }

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
  <DropdownMenu.Root>
    <DropdownMenu.Trigger disabled={forking}>
      {#snippet child({ props })}
        <Button
          {...props}
          variant="ghost"
          size="icon-xs"
          aria-label="Fork to new pane"
          loading={forking}
          class="text-muted-foreground hover:text-foreground"
        >
          <Icon name="fork" />
        </Button>
      {/snippet}
    </DropdownMenu.Trigger>
    <DropdownMenu.Content align="start" class="w-52">
      <DropdownMenu.Label>Fork to new pane</DropdownMenu.Label>
      {#each preferences.enabledProviders as provider (provider)}
        <DropdownMenu.Item onclick={() => forkTo(provider)}>
          <Icon name={provider} />
          {PROVIDER_LABELS[provider]}
        </DropdownMenu.Item>
      {/each}
    </DropdownMenu.Content>
  </DropdownMenu.Root>
</div>
