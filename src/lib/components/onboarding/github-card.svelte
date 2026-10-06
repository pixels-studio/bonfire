<script lang="ts">
  import { onMount } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import Icon from '$lib/components/icon/icon.svelte';
  import { toast } from '$lib/stores/toast.svelte';
  import type { GithubSignIn, GithubStatus } from '$shared/contracts';
  import { errorMessage } from '$shared/domain';

  let {
    status = $bindable(),
  }: {
    /** Undefined while gh is being checked. */
    status?: GithubStatus;
  } = $props();

  /** A device-flow sign-in waiting for the user to enter its code. */
  let signIn = $state<GithubSignIn>();
  let starting = $state(false);
  let checking = $state(false);

  const login = $derived(status?.installed ? status.login : undefined);

  async function check() {
    checking = true;
    try {
      status = await window.bonfire.github.status();
    } catch (cause) {
      toast(errorMessage(cause), { variant: 'error' });
    } finally {
      checking = false;
    }
  }

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
    if (!status) void check();
    return window.bonfire.github.onSignInEnd((end) => {
      status = end.status;
      signIn = undefined;
      if (end.error) toast(end.error, { variant: 'error' });
    });
  });
</script>

<div class="flex flex-col rounded-xl bg-foreground/4">
  <div class="flex items-center gap-3.5 p-4">
    <div class="grid size-10 shrink-0 place-content-center rounded-lg bg-muted">
      <Icon name="github" class="size-5" />
    </div>
    <div class="flex min-w-0 flex-1 flex-col">
      <span class="text-sm font-medium">GitHub</span>
      <span class="truncate text-sm text-muted-foreground">
        {#if !status}
          Checking the GitHub CLI…
        {:else if !status.installed}
          Bonfire uses the GitHub CLI (gh), which isn’t installed
        {:else if login}
          @{login} via the GitHub CLI
        {:else}
          Signs in through the GitHub CLI; Bonfire keeps no tokens
        {/if}
      </span>
    </div>
    {#if login}
      <span class="flex items-center gap-1 text-xs font-medium text-success">
        <Icon name="check" class="size-4" /> Connected
      </span>
    {:else if signIn}
      <Button
        variant="secondary"
        size="sm"
        onclick={() => window.bonfire.github.cancelConnect()}
      >
        Cancel
      </Button>
    {:else if status && !status.installed}
      <Button variant="secondary" size="sm" loading={checking} onclick={check}>
        Check again
      </Button>
    {:else}
      <Button size="sm" disabled={!status} loading={starting} onclick={connect}>
        Sign in
      </Button>
    {/if}
  </div>

  {#if signIn}
    <div class="flex flex-col items-center gap-2 px-4 pt-1 pb-5 text-center">
      <span class="text-xs text-muted-foreground">
        Enter this code on the GitHub page that opened
      </span>
      <span
        class="font-mono text-2xl font-semibold tracking-[0.2em] select-all"
      >
        {signIn.userCode}
      </span>
      <span class="text-xs text-muted-foreground">
        Copied to your clipboard
      </span>
    </div>
  {:else if status && !status.installed}
    <div class="px-4 pt-0 pb-4 text-xs text-muted-foreground">
      Install it with <code
        class="rounded bg-muted px-1.5 py-0.5 font-mono text-foreground select-all"
        >brew install gh</code
      >, or from cli.github.com, then check again.
    </div>
  {/if}
</div>
