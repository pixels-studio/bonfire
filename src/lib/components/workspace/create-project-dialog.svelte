<script lang="ts">
  import { untrack } from 'svelte';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import { Button } from '$lib/components/ui/button';
  import * as Dialog from '$lib/components/ui/dialog';
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
  import Icon from '$lib/components/icon/icon.svelte';
  import ConnectionDialog from '../settings/connection-dialog.svelte';
  import RemoteFolderBrowser from './remote-folder-browser.svelte';
  import { connections } from '$lib/stores/connections.svelte';
  import { toast } from '$lib/stores/toast.svelte';
  import type { Project } from '$shared/contracts';
  import { errorMessage, folderName } from '$shared/domain';

  let {
    open = $bindable(),
    oncreated,
  }: {
    open: boolean;
    oncreated: (project: Project) => void;
  } = $props();

  let name = $state('');
  /** Whether the name was typed rather than taken from the folder. */
  let named = false;
  /** Where the folder is picked from: a connection's id, or this computer when unset. */
  let connectionId = $state<string>();
  let folder = $state<{ path: string; connectionId?: string }>();
  let browsing = $state(false);
  let addingConnection = $state(false);
  let creating = $state(false);

  const source = $derived(connections.find(connectionId));

  $effect(() => {
    if (!open) return;
    untrack(() => {
      name = '';
      named = false;
      connectionId = undefined;
      folder = undefined;
      browsing = false;
      void connections.load();
    });
  });

  function pick(path: string) {
    folder = { path, connectionId };
    browsing = false;
    if (!named) name = folderName(path);
  }

  async function add() {
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
    browsing = !!id;
  }

  async function create(event: SubmitEvent) {
    event.preventDefault();
    if (!folder) return;
    creating = true;
    try {
      const project = await window.bonfire.projects.create({
        name: name.trim() || folderName(folder.path),
        path: folder.path,
        connectionId: folder.connectionId,
      });
      open = false;
      oncreated(project);
    } catch (cause) {
      toast(errorMessage(cause), { variant: 'error', duration: 0 });
    } finally {
      creating = false;
    }
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="w-[min(34rem,calc(100vw-2rem))] gap-0 p-0">
    <Dialog.Header>
      <Dialog.Title class="text-lg font-semibold">Create project</Dialog.Title>
    </Dialog.Header>
    <form class="flex flex-col" onsubmit={create}>
      <Dialog.Body class="gap-6">
        <div
          class="flex items-center rounded-lg border border-input transition-colors focus-within:border-brand dark:bg-input/30"
        >
          <input
            bind:value={name}
            oninput={() => (named = !!name.trim())}
            class="h-9.5 min-w-0 flex-1 bg-transparent px-3.5 text-sm outline-none placeholder:text-muted-foreground"
            placeholder="Project name"
            aria-label="Project name"
            spellcheck={false}
          />
        </div>

        <div class="flex flex-col gap-3">
          <span class="text-sm text-muted-foreground">Source folder</span>
          <div class="overflow-hidden rounded-lg border border-border">
            {#if folder}
              {@const remote = connections.find(folder.connectionId)}
              <div class="flex items-center gap-3 py-2.5 pr-2 pl-3">
                {#if folder.connectionId}
                  <Icon name="server" class="shrink-0 text-muted-foreground" />
                {:else}
                  <Icon
                    name="computer"
                    class="shrink-0 text-muted-foreground"
                  />
                {/if}
                <div class="flex min-w-0 flex-1 flex-col">
                  <span class="truncate font-mono text-xs" title={folder.path}>
                    {folder.path}
                  </span>
                  <span class="text-xs text-muted-foreground">
                    {remote ? `On ${remote.name}` : 'On this computer'}
                  </span>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  class="text-muted-foreground"
                  aria-label="Remove folder"
                  onclick={() => (folder = undefined)}
                >
                  <Icon name="close" class="size-4" />
                </Button>
              </div>
            {:else if browsing && connectionId}
              {#key connectionId}
                <RemoteFolderBrowser
                  {connectionId}
                  onselect={pick}
                  oncancel={() => (browsing = false)}
                />
              {/key}
            {:else}
              <div class="flex flex-col items-center gap-3 px-6 py-7">
                <p class="text-muted-foreground">
                  Add a folder on
                  <DropdownMenu.Root>
                    <DropdownMenu.Trigger
                      class="inline-flex items-center gap-1 rounded-sm font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                    >
                      {source?.name ?? 'this computer'}
                      <ChevronDown class="size-3.5 text-muted-foreground" />
                    </DropdownMenu.Trigger>
                    <DropdownMenu.Content align="center" class="w-56">
                      <DropdownMenu.Item onclick={() => chooseSource()}>
                        <Icon name="computer" /> This computer
                      </DropdownMenu.Item>
                      {#each connections.all as connection (connection.id)}
                        <DropdownMenu.Item
                          onclick={() => chooseSource(connection.id)}
                        >
                          <Icon name="server" />
                          <span class="truncate">{connection.name}</span>
                        </DropdownMenu.Item>
                      {/each}
                      <DropdownMenu.Separator />
                      <DropdownMenu.Item
                        onclick={() => (addingConnection = true)}
                      >
                        <Icon name="plus" /> SSH connection
                      </DropdownMenu.Item>
                    </DropdownMenu.Content>
                  </DropdownMenu.Root>
                </p>
                <Button type="button" variant="secondary" onclick={add}>
                  Add
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
        <Button
          type="submit"
          class="min-w-20"
          disabled={!folder}
          loading={creating}
        >
          Create
        </Button>
      </Dialog.Footer>
    </form>
  </Dialog.Content>
</Dialog.Root>

<ConnectionDialog
  bind:open={addingConnection}
  onsaved={(connection) => chooseSource(connection.id)}
/>
