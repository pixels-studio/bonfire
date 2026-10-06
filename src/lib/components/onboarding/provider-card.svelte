<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import Icon from '$lib/components/icon/icon.svelte';
  import { limits } from '$lib/stores/limits.svelte';
  import { toast } from '$lib/stores/toast.svelte';
  import type { AssistantProvider, ProviderAccount } from '$shared/contracts';
  import { PROVIDER_LABELS, errorMessage } from '$shared/domain';

  let {
    provider,
    account = $bindable(),
    error = $bindable(),
  }: {
    provider: AssistantProvider;
    /** Undefined while it is being checked. */
    account?: ProviderAccount;
    /** Why the account couldn't be checked. */
    error?: string;
  } = $props();

  const label = $derived(PROVIDER_LABELS[provider]);
  let connecting = $state(false);

  const DETAILS: Record<AssistantProvider, string> = {
    claude: 'Claude Code, with your Claude subscription or Console account',
    codex: 'OpenAI Codex, with your ChatGPT plan',
  };

  const description = $derived.by(() => {
    if (connecting) return 'Finish signing in in your browser';
    if (error) return error;
    if (!account) return 'Checking account…';
    if (!account.signedIn) return DETAILS[provider];
    const plan =
      account.plan &&
      account.plan.charAt(0).toUpperCase() + account.plan.slice(1);
    return [account.email, plan].filter(Boolean).join(' · ') || 'Signed in';
  });

  async function connect() {
    connecting = true;
    try {
      const result = await window.bonfire.providers.connect(provider);
      // This computer never waits for a code; only a machine reached over SSH does.
      if ('needsCode' in result || 'userCode' in result)
        throw Error('Sign-in needs a code.');
      account = result;
      error = undefined;
      limits.refresh();
    } catch (cause) {
      toast(errorMessage(cause), { variant: 'error' });
    } finally {
      connecting = false;
    }
  }
</script>

<div class="flex items-center gap-3.5 rounded-xl bg-foreground/4 p-4">
  <div class="grid size-10 shrink-0 place-content-center rounded-lg bg-muted">
    <Icon name={provider} class="size-5" />
  </div>
  <div class="flex min-w-0 flex-1 flex-col">
    <span class="text-sm font-medium">{label}</span>
    <span
      class="truncate text-sm text-muted-foreground"
      class:text-destructive={!!error && !connecting}
      title={description}
    >
      {description}
    </span>
  </div>
  {#if account?.signedIn && !connecting}
    <span
      class="flex items-center gap-1 text-xs font-medium text-success"
      aria-label={`Signed in to ${label}`}
    >
      <Icon name="check" class="size-4" /> Connected
    </span>
  {:else if connecting}
    <Button
      variant="secondary"
      size="sm"
      onclick={() => window.bonfire.providers.cancelConnect(provider)}
    >
      Cancel
    </Button>
  {:else}
    <Button size="sm" disabled={!account && !error} onclick={connect}>
      Sign in
    </Button>
  {/if}
</div>
