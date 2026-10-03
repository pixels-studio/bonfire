<script lang="ts">
  import { onMount } from 'svelte';
  import { toast } from '$lib/stores/toast.svelte';
  import type { GithubSignIn, GithubStatus } from '$shared/contracts';
  import { errorMessage } from '$shared/domain';
  import AccountButton from './account-button.svelte';
  import Setting from './setting.svelte';

  let status = $state<GithubStatus>();
  /** A device-flow sign-in waiting for the user to enter its code. */
  let signIn = $state<GithubSignIn>();
  let starting = $state(false);

  const login = $derived(status?.installed ? status.login : undefined);

  const description = $derived.by(() => {
    if (signIn) return `Enter ${signIn.userCode} on GitHub (copied)`;
    if (!status) return 'Checking the GitHub CLI';
    if (!status.installed) return 'Install the GitHub CLI (gh) to connect';
    if (login) return `@${login} via the GitHub CLI`;
    return 'Not signed in';
  });

  async function connect() {
    starting = true;
    try {
      signIn = await window.bonfire.github.connect();
    } catch (cause) {
      toast(errorMessage(cause), { variant: 'error' });
    } finally {
      starting = false;
    }
  }

  onMount(() => {
    window.bonfire.github
      .status()
      .then((next) => (status = next))
      .catch((cause) => toast(errorMessage(cause), { variant: 'error' }));
    return window.bonfire.github.onSignInEnd((end) => {
      status = end.status;
      signIn = undefined;
      if (end.error) toast(end.error, { variant: 'error' });
    });
  });
</script>

<Setting title="GitHub integration" {description} inline>
  {#snippet control()}
    <AccountButton
      label={login ? 'Switch GitHub account' : 'Sign in to GitHub'}
      signingIn={starting || !!signIn}
      disabled={!status?.installed}
      onclick={connect}
      oncancel={() => window.bonfire.github.cancelConnect()}
    />
  {/snippet}
</Setting>
