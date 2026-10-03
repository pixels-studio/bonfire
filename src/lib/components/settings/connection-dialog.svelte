<script lang="ts">
  import { untrack } from 'svelte';
  import Globe from '@lucide/svelte/icons/globe';
  import { Label } from '$lib/components/ui/label';
  import { Button } from '$lib/components/ui/button';
  import * as Dialog from '$lib/components/ui/dialog';
  import { Input } from '$lib/components/ui/input';
  import Icon from '$lib/components/icon/icon.svelte';
  import SegmentedControl from '../insights/segmented-control.svelte';
  import { connections } from '$lib/stores/connections.svelte';
  import { toast } from '$lib/stores/toast.svelte';
  import {
    sshConnectionInput,
    type SshAuth,
    type SshConnection,
    type SshConnectionInput,
  } from '$shared/contracts';
  import { errorMessage } from '$shared/domain';

  let {
    open = $bindable(),
    connection,
    onsaved,
  }: {
    open: boolean;
    /** The connection to edit; a new one is added without it. */
    connection?: SshConnection;
    onsaved?: (connection: SshConnection) => void;
  } = $props();

  const AUTH_OPTIONS: { value: SshAuth; label: string }[] = [
    { value: 'default', label: 'No Auth' },
    { value: 'identity', label: 'Identity' },
  ];

  let name = $state('');
  let host = $state('');
  let port = $state('');
  let auth = $state<SshAuth>('default');
  let identityFile = $state('');
  let checking = $state(false);
  /** Why the last attempt to connect failed; saving again keeps the connection anyway. */
  let failure = $state<string>();

  // Each time the dialog opens it starts from the saved connection, or blank.
  $effect(() => {
    if (!open) return;
    const saved = untrack(() => connection);
    name = saved?.name ?? '';
    host = saved?.host ?? '';
    port = saved?.port ? String(saved.port) : '';
    auth = saved?.auth ?? 'default';
    identityFile = saved?.identityFile ?? '';
    failure = undefined;
  });

  // A changed field deserves a fresh attempt before saving anyway.
  $effect(() => {
    void [name, host, port, auth, identityFile];
    failure = undefined;
  });

  function input() {
    return sshConnectionInput.safeParse({
      id: connection?.id,
      name: name.trim() || host.trim(),
      host,
      port: port.trim() ? Number(port) : undefined,
      auth,
      identityFile: auth === 'identity' ? identityFile : undefined,
    });
  }

  async function chooseIdentity() {
    const path = await window.bonfire.connections.chooseIdentity();
    if (path) identityFile = path;
  }

  async function save(event: SubmitEvent) {
    event.preventDefault();
    const parsed = input();
    if (!parsed.success) {
      toast(parsed.error.issues[0]?.message ?? 'Check the connection', {
        variant: 'error',
      });
      return;
    }
    const entered: SshConnectionInput = parsed.data;
    if (entered.auth === 'identity' && !entered.identityFile) {
      toast('Choose the key file to sign in with.', { variant: 'error' });
      return;
    }
    checking = true;
    try {
      if (!failure) {
        const check = await window.bonfire.connections.check(entered);
        if (!check.ok) {
          failure = check.error;
          return;
        }
      }
      const saved = await connections.save(entered);
      open = false;
      onsaved?.(saved);
    } catch (cause) {
      toast(errorMessage(cause), { variant: 'error' });
    } finally {
      checking = false;
    }
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="w-[min(32rem,calc(100vw-2rem))] gap-0 p-0">
    <Dialog.Header>
      <Dialog.Title class="text-lg font-semibold">
        {connection ? 'Edit SSH connection' : 'Add SSH connection'}
      </Dialog.Title>
    </Dialog.Header>
    <form class="flex flex-col" onsubmit={save}>
      <Dialog.Body class="gap-4">
        <label class="flex flex-col gap-2">
          <Label>Display name</Label>
          <div
            class="flex items-center rounded-lg border border-input transition-colors focus-within:border-brand dark:bg-input/30"
          >
            <span
              class="grid h-8.5 w-10 shrink-0 place-items-center border-r border-input text-brand"
              aria-hidden="true"
            >
              <Globe class="size-4" />
            </span>
            <input
              bind:value={name}
              class="h-8.5 min-w-0 flex-1 bg-transparent px-2.5 text-sm outline-none placeholder:text-muted-foreground"
              placeholder={host.trim() || 'Build server'}
              spellcheck={false}
            />
          </div>
        </label>
        <label class="flex flex-col gap-2">
          <Label>Hostname</Label>
          <Input
            bind:value={host}
            class="h-8.5"
            placeholder="host.com or user@host.com"
            autocapitalize="off"
            spellcheck={false}
            required
          />
        </label>
        <label class="flex flex-col gap-2">
          <Label>
            SSH port <span class="opacity-60"> (optional) </span>
          </Label>
          <Input
            bind:value={port}
            class="h-8.5"
            inputmode="numeric"
            pattern="[0-9]*"
            placeholder="22"
          />
        </label>
        <div class="flex flex-col gap-2">
          <SegmentedControl
            items={AUTH_OPTIONS}
            bind:value={auth}
            class="w-full"
            aria-label="Authentication"
          />
          {#if auth === 'identity'}
            <div class="flex gap-2">
              <Input
                bind:value={identityFile}
                class="h-8.5 font-mono text-xs"
                placeholder="~/.ssh/id_ed25519"
                aria-label="Private key file"
                spellcheck={false}
              />
              <Button
                type="button"
                variant="secondary"
                class="shrink-0"
                onclick={chooseIdentity}
              >
                Choose…
              </Button>
            </div>
          {:else}
            <p class="text-xs text-muted-foreground">
              Signs in with your SSH agent and ~/.ssh/config, like ssh in a
              terminal.
            </p>
          {/if}
        </div>
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
        <Button type="submit" class="min-w-20" loading={checking}>
          {#if failure}
            Save anyway
          {:else}
            Save
          {/if}
        </Button>
      </Dialog.Footer>
    </form>
  </Dialog.Content>
</Dialog.Root>
