<script lang="ts">
  import { untrack } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import * as Dialog from '$lib/components/ui/dialog';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';
  import { toast } from '$lib/stores/toast.svelte';
  import type { AssistantProvider, SshConnection } from '$shared/contracts';
  import { PROVIDER_LABELS, errorMessage } from '$shared/domain';

  let {
    open = $bindable(),
    provider,
    connection,
  }: {
    open: boolean;
    provider: AssistantProvider;
    /** The machine to sign into; the dialog does nothing without one. */
    connection?: SshConnection;
  } = $props();

  const label = $derived(PROVIDER_LABELS[provider]);

  let phase = $state<'connecting' | 'code' | 'submitting' | 'device'>(
    'connecting',
  );
  let code = $state('');
  let deviceCode = $state('');
  let failure = $state<string>();

  async function start(target: SshConnection) {
    phase = 'connecting';
    failure = undefined;
    code = '';
    try {
      const result = await window.bonfire.providers.connect(
        provider,
        target.id,
      );
      if ('needsCode' in result) {
        phase = 'code';
        return;
      }
      if ('userCode' in result) {
        deviceCode = result.userCode;
        phase = 'device';
        try {
          await window.bonfire.providers.awaitSignIn(provider);
        } catch (cause) {
          failure = errorMessage(cause);
          return;
        }
        toast(`Signed in to ${label} on ${target.name}.`);
        open = false;
        return;
      }
      toast(`Signed in to ${label} on ${target.name}.`);
      open = false;
    } catch (cause) {
      failure = errorMessage(cause);
    }
  }

  // Each time the dialog opens it starts a fresh sign-in for the connection it was given.
  $effect(() => {
    if (!open) return;
    const target = untrack(() => connection);
    if (target) void start(target);
  });

  // Leaving the dialog, by any path, gives up a sign-in still waiting to finish.
  $effect(() => {
    if (open) return;
    void window.bonfire.providers.cancelConnect(provider);
  });

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (!connection) return;
    phase = 'submitting';
    failure = undefined;
    try {
      await window.bonfire.providers.submitSignInCode(provider, code.trim());
      toast(`Signed in to ${label} on ${connection.name}.`);
      open = false;
    } catch (cause) {
      failure = errorMessage(cause);
      phase = 'code';
    }
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="w-[min(28rem,calc(100vw-2rem))] gap-0 p-0">
    <Dialog.Header>
      <Dialog.Title class="text-lg font-semibold">
        Sign in to {label} on {connection?.name}
      </Dialog.Title>
    </Dialog.Header>
    {#if phase === 'connecting'}
      <Dialog.Body class="py-6">
        <p class="text-sm text-muted-foreground">
          Opening the sign-in page in your browser…
        </p>
        {#if failure}
          <p
            class="mt-3 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-pretty text-destructive"
            role="alert"
          >
            {failure}
          </p>
        {/if}
      </Dialog.Body>
      <Dialog.Footer>
        <Button
          variant="secondary"
          class="min-w-20"
          onclick={() => (open = false)}
        >
          Cancel
        </Button>
      </Dialog.Footer>
    {:else if phase === 'device'}
      <Dialog.Body class="gap-4">
        <p class="text-sm text-muted-foreground">
          On the page that opened, enter this code to finish signing in.
        </p>
        <p
          class="self-center rounded-lg bg-foreground/4 px-4 py-2 font-mono text-lg tracking-wider"
        >
          {deviceCode}
        </p>
        {#if failure}
          <p
            class="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-pretty text-destructive"
            role="alert"
          >
            {failure}
          </p>
        {:else}
          <p class="text-center text-xs text-muted-foreground">
            Waiting for you to finish in the browser…
          </p>
        {/if}
      </Dialog.Body>
      <Dialog.Footer>
        <Button
          variant="secondary"
          class="min-w-20"
          onclick={() => (open = false)}
        >
          {failure ? 'Close' : 'Cancel'}
        </Button>
      </Dialog.Footer>
    {:else}
      <form class="flex flex-col" onsubmit={submit}>
        <Dialog.Body class="gap-4">
          <p class="text-sm text-muted-foreground">
            Finish signing in on the page that opened, then paste the code it
            shows here.
          </p>
          <label class="flex flex-col gap-2">
            <Label>Code</Label>
            <Input
              bind:value={code}
              class="h-8.5 font-mono"
              autocapitalize="off"
              spellcheck={false}
              autocomplete="off"
              required
            />
          </label>
          {#if failure}
            <p
              class="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-pretty text-destructive"
              role="alert"
            >
              {failure}
            </p>
          {/if}
        </Dialog.Body>
        <Dialog.Footer>
          <Button
            type="button"
            variant="secondary"
            class="min-w-20"
            onclick={() => (open = false)}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            class="min-w-20"
            loading={phase === 'submitting'}
          >
            Finish
          </Button>
        </Dialog.Footer>
      </form>
    {/if}
  </Dialog.Content>
</Dialog.Root>
