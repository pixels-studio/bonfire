<script lang="ts">
  import { onMount } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
  import * as Tooltip from '$lib/components/ui/tooltip';
  import Icon from '$lib/components/icon/icon.svelte';
  import SettingsSection from './settings-section.svelte';
  import ConnectionDialog from './connection-dialog.svelte';
  import { connections } from '$lib/stores/connections.svelte';
  import { toast } from '$lib/stores/toast.svelte';
  import { cn } from '$lib/utils';
  import type { ConnectionCheck, SshConnection } from '$shared/contracts';
  import { errorMessage } from '$shared/domain';

  let editing = $state(false);
  let target = $state<SshConnection>();
  /** How reaching each connection went, by id; missing while it is being tried. */
  let checks = $state<Record<string, ConnectionCheck>>({});

  function check(connection: SshConnection) {
    delete checks[connection.id];
    // Listed connections are reactive proxies, which IPC cannot clone.
    Promise.resolve()
      .then(() => window.bonfire.connections.check($state.snapshot(connection)))
      .then((result) => (checks[connection.id] = result))
      .catch((cause) => {
        checks[connection.id] = { ok: false, error: errorMessage(cause) };
      });
  }

  function edit(connection?: SshConnection) {
    target = connection;
    editing = true;
  }

  async function remove(connection: SshConnection) {
    try {
      await connections.remove(connection.id);
    } catch (cause) {
      toast(errorMessage(cause), { variant: 'error' });
    }
  }

  function address({ host, port }: SshConnection) {
    return port ? `${host}:${port}` : host;
  }

  onMount(() => {
    void connections.load().then(() => connections.all.forEach(check));
  });
</script>

<SettingsSection title="Connection" icon="server">
  {#snippet actions()}
    <Button
      variant="ghost"
      size="icon-sm"
      class="-my-1 text-muted-foreground"
      aria-label="Add connection"
      onclick={() => edit()}
    >
      <Icon name="plus" class="size-4" />
    </Button>
  {/snippet}

  {#if connections.all.length}
    <ul
      class="flex flex-col divide-y divide-border rounded-xl border border-border"
    >
      {#each connections.all as connection (connection.id)}
        {@const status = checks[connection.id]}
        <li
          class="grid grid-cols-[1fr_1fr_auto] items-center gap-2 py-2 pr-2 pl-3"
        >
          <div class="flex min-w-0 items-center gap-2">
            <Tooltip.Root>
              <Tooltip.Trigger
                class="grid size-5 shrink-0 place-items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                aria-label={!status
                  ? 'Connecting'
                  : status.ok
                    ? 'Connected'
                    : 'Disconnected'}
                onclick={() => check(connection)}
              >
                <span
                  class={cn(
                    'size-2 rounded-full',
                    !status &&
                      'animate-pulse bg-orange-500 motion-reduce:animate-none',
                    status?.ok && 'bg-emerald-500',
                    status && !status.ok && 'bg-destructive',
                  )}
                  aria-hidden="true"
                ></span>
              </Tooltip.Trigger>
              <Tooltip.Content class="max-w-72">
                <span class="block text-pretty">
                  {#if status && !status.ok}
                    {status.error}
                  {:else if status?.ok}
                    Connected. Home folder {status.home}
                  {:else}
                    Connecting…
                  {/if}
                  Click to try again.
                </span>
              </Tooltip.Content>
            </Tooltip.Root>
            <span class="min-w-0 truncate text-sm">{connection.name}</span>
          </div>
          <span
            class="min-w-0 truncate font-mono text-xs text-muted-foreground"
          >
            {address(connection)}
          </span>
          <DropdownMenu.Root>
            <DropdownMenu.Trigger>
              {#snippet child({ props })}
                <Button
                  {...props}
                  variant="ghost"
                  size="icon-sm"
                  class="text-muted-foreground"
                  aria-label={`Actions for ${connection.name}`}
                >
                  <Icon name="dots" class="size-4" />
                </Button>
              {/snippet}
            </DropdownMenu.Trigger>
            <DropdownMenu.Content align="end">
              <DropdownMenu.Item onclick={() => edit(connection)}>
                <Icon name="settings" /> Edit
              </DropdownMenu.Item>
              <DropdownMenu.Item
                variant="destructive"
                onclick={() => remove(connection)}
              >
                <Icon name="trash" /> Remove
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Root>
        </li>
      {/each}
    </ul>
  {:else}
    <div
      class="flex flex-col items-center gap-4 rounded-xl border border-border px-6 py-8 text-center"
    >
      <div class="flex items-center gap-2 text-foreground" aria-hidden="true">
        <Icon name="computer" class="size-7" />
        <span class="flex gap-1 px-1 text-muted-foreground">
          {#each [0.3, 0.6, 1] as opacity (opacity)}
            <span class="size-1.5 rounded-full bg-current" style:opacity></span>
          {/each}
        </span>
        <Icon name="server" class="size-7" />
      </div>
      <p class="text-pretty text-muted-foreground">
        Connect to a remote device through SSH connection
      </p>
      <Button size="sm" onclick={() => edit()}>Add</Button>
    </div>
  {/if}
</SettingsSection>

<ConnectionDialog
  bind:open={editing}
  connection={target}
  onsaved={(saved) => check(saved)}
/>
