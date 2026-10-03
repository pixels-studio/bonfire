<script lang="ts">
  import { onMount } from 'svelte';
  import { Switch } from '$lib/components/ui/switch';
  import { limits } from '$lib/stores/limits.svelte';
  import { preferences } from '$lib/stores/preferences.svelte';
  import { toast } from '$lib/stores/toast.svelte';
  import type { AssistantProvider, ProviderAccount } from '$shared/contracts';
  import { PROVIDER_LABELS, errorMessage } from '$shared/domain';
  import AccountButton from './account-button.svelte';
  import Setting from './setting.svelte';

  let { provider }: { provider: AssistantProvider } = $props();

  const label = $derived(PROVIDER_LABELS[provider]);
  let account = $state<ProviderAccount>();
  let accountError = $state('');
  let connecting = $state(false);

  const enabled = $derived(preferences.current.providers[provider]);
  // Turning off the last provider would leave nothing to chat with.
  const isLastEnabled = $derived(
    enabled && preferences.enabledProviders.length === 1,
  );

  const description = $derived.by(() => {
    if (connecting) return 'Finish signing in in your browser';
    if (accountError) return accountError;
    if (!account) return 'Checking account';
    if (!account.signedIn) return 'Not signed in';
    const plan = account.plan && capitalize(account.plan);
    return [account.email, plan].filter(Boolean).join(' · ') || 'Signed in';
  });

  function capitalize(text: string) {
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  async function loadAccount() {
    try {
      account = await window.bonfire.providers.account(provider);
      accountError = '';
    } catch (cause) {
      accountError = errorMessage(cause);
    }
  }

  async function connect() {
    connecting = true;
    try {
      account = await window.bonfire.providers.connect(provider);
      accountError = '';
      limits.refresh();
    } catch (cause) {
      toast(errorMessage(cause), { variant: 'error' });
    } finally {
      connecting = false;
    }
  }

  function setEnabled(next: boolean) {
    void preferences.update({
      providers: { ...preferences.current.providers, [provider]: next },
    });
  }

  onMount(() => {
    void loadAccount();
  });
</script>

<Setting title={label} {description} inline>
  {#snippet control(props)}
    <div class="flex items-center gap-2">
      <AccountButton
        label={account?.signedIn
          ? `Switch ${label} account`
          : `Sign in to ${label}`}
        signingIn={connecting}
        disabled={!account && !accountError}
        onclick={connect}
        oncancel={() => window.bonfire.providers.cancelConnect(provider)}
      />
      <Switch
        {...props}
        checked={enabled}
        disabled={isLastEnabled}
        onCheckedChange={setEnabled}
      />
    </div>
  {/snippet}
</Setting>
