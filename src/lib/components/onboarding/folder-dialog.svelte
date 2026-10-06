<script lang="ts" module>
  /** A folder on this computer, or on an SSH connection when `connectionId` is set. */
  export type Folder = { path: string; connectionId?: string };
</script>

<script lang="ts">
  import { untrack } from 'svelte';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import { Button } from '$lib/components/ui/button';
  import * as Dialog from '$lib/components/ui/dialog';
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
  import { Label } from '$lib/components/ui/label';
  import Icon from '$lib/components/icon/icon.svelte';
  import ConnectionDialog from '../settings/connection-dialog.svelte';
  import RemoteFolderBrowser from '../workspace/remote-folder-browser.svelte';
  import { connections } from '$lib/stores/connections.svelte';
  import { toast } from '$lib/stores/toast.svelte';
  import { errorMessage } from '$shared/domain';

  let {
    open = $bindable(),
    value,
    remote = false,
    ondone,
  }: {
    open: boolean;
    /** Starts on an SSH connection, or asks for one when there is none. */
    remote?: boolean;
    /** The folder chosen before, so the dialog can open on it. */
    value?: Folder;
    ondone: (folder: Folder) => void;
  } = $props();

  /** Where the folder is picked from: a connection's id, or this computer when unset. */
  let connectionId = $state<string>();
  let folder = $state<Folder>();
  let browsing = $state(false);
  let addingConnection = $state(false);

  const source = $derived(connections.find(connectionId));
  const folderSource = $derived(connections.find(folder?.connectionId));

  $effect(() => {
    if (!open) return;
    untrack(() => {
      connectionId = value?.connectionId;
      folder = value;
      browsing = false;
      void connections.load().then(() => {
        if (!remote || connectionId || !open) return;
        const first = connections.all[0];
        if (first) chooseSource(first.id);
        else addingConnection = true;
      });
    });
  });

  function pick(path: string) {
    folder = { path, connectionId };
    browsing = false;
  }

  async function browse() {
    if (connectionId) {
      browsing = true;
      return;
    }
    try {
      const path = await window.bonfire.projects.chooseFolder();
      if (path) pick(path);
    } catch (cause) {
      toast(errorMessage(cause), { variant: 'error' });
    }
  }

  function chooseSource(id?: string) {
    connectionId = id;
    folder = undefined;
    browsing = !!id;
  }

  function done() {
    if (!folder) return;
    open = false;
    ondone(folder);
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="w-[min(34rem,calc(100vw-2rem))] gap-0 p-0">
    <Dialog.Header>
      <Dialog.Title class="text-lg font-semibold">Choose folder</Dialog.Title>
    </Dialog.Header>
    <Dialog.Body class="gap-6">
      <div class="flex flex-col gap-3">
        <Label>
          Folder on
          <DropdownMenu.Root>
            <DropdownMenu.Trigger
              class="inline-flex items-center gap-1 rounded-sm font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
            >
              {source?.name ?? 'this computer'}
              <ChevronDown class="size-3.5 text-muted-foreground" />
            </DropdownMenu.Trigger>
            <DropdownMenu.Content align="start" class="w-56">
              <DropdownMenu.Item onclick={() => chooseSource()}>
                <Icon name="computer" /> This computer
              </DropdownMenu.Item>
              {#each connections.all as connection (connection.id)}
                <DropdownMenu.Item onclick={() => chooseSource(connection.id)}>
                  <Icon name="server" />
                  <span class="truncate">{connection.name}</span>
                </DropdownMenu.Item>
              {/each}
              <DropdownMenu.Separator />
              <DropdownMenu.Item onclick={() => (addingConnection = true)}>
                <Icon name="plus" /> SSH connection
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Root>
        </Label>

        <div class="overflow-hidden rounded-lg border border-border">
          {#if browsing && connectionId}
            {#key connectionId}
              <RemoteFolderBrowser
                {connectionId}
                onselect={pick}
                oncancel={() => (browsing = false)}
              />
            {/key}
          {:else if folder}
            <div class="flex items-center gap-3 py-2.5 pr-2 pl-3">
              <Icon
                name={folder.connectionId ? 'server' : 'computer'}
                class="shrink-0 text-muted-foreground"
              />
              <div class="flex min-w-0 flex-1 flex-col">
                <span class="truncate text-sm" title={folder.path}>
                  {folder.path}
                </span>
                <span class="text-xs text-muted-foreground">
                  {folderSource
                    ? `On ${folderSource.name}`
                    : 'On this computer'}
                </span>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                class="text-muted-foreground"
                onclick={browse}
              >
                Change
              </Button>
            </div>
          {:else}
            <div class="flex flex-col items-center gap-3 px-6 py-7">
              <p class="text-muted-foreground">
                Pick the folder your project lives in.
              </p>
              <Button type="button" variant="secondary" onclick={browse}>
                Browse
              </Button>
            </div>
          {/if}
        </div>
      </div>
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
      <Button type="button" class="min-w-20" disabled={!folder} onclick={done}>
        Done
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>

<ConnectionDialog
  bind:open={addingConnection}
  onsaved={(connection) => chooseSource(connection.id)}
/>
