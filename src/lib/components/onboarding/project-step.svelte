<script lang="ts" module>
  /** The clone form, which the footer's button submits from outside it. */
  export const FORM_ID = 'clone-project';
</script>

<script lang="ts">
  import { onMount } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import { cn } from '$lib/utils';
  import Icon from '$lib/components/icon/icon.svelte';
  import FolderDialog, { type Folder } from './folder-dialog.svelte';
  import RepositoryList from './repository-list.svelte';
  import { toast } from '$lib/stores/toast.svelte';
  import type { Project } from '$shared/contracts';
  import { errorMessage, folderName, repositoryName } from '$shared/domain';
  import { connections } from '$lib/stores/connections.svelte';

  type Source = 'github' | 'folder';

  let {
    githubSignedIn,
    oncreated,
    clone: cloneState = $bindable(),
  }: {
    /** Undefined while GitHub is being checked. */
    githubSignedIn?: boolean;
    oncreated: (project: Project) => void;
    /** What the footer needs for its button; unset when nothing is picked yet. */
    clone?: { ready: boolean; cloning: boolean; name: string };
  } = $props();

  /** Whichever was picked last: a folder, or a GitHub repository. */
  let source = $state<Source>('folder');
  let selectedRepository = $state<string>();
  /** Where a clone goes. */
  let parent = $state('');
  let cloning = $state(false);
  /** The existing folder to add, once chosen. */
  let folder = $state<Folder>();
  let adding = $state(false);
  let choosingFolder = $state(false);
  const folderSource = $derived(connections.find(folder?.connectionId));

  // Picking a repository replaces a chosen folder, and the other way round.
  const selected = $derived(
    source === 'github' ? selectedRepository : undefined,
  );

  $effect(() => {
    cloneState =
      source === 'github' && githubSignedIn
        ? { ready: !!url && !!parent.trim(), cloning, name }
        : source === 'folder'
          ? { ready: !!folder, cloning: adding, name: '' }
          : undefined;
  });

  const url = $derived(source === 'github' ? selected : undefined);
  const name = $derived(url ? repositoryName(url) : '');

  function chosen(next: Folder) {
    folder = next;
    source = 'folder';
  }

  async function browseLocal() {
    try {
      const path = await window.bonfire.projects.chooseFolder();
      if (path) chosen({ path });
    } catch (cause) {
      toast(errorMessage(cause), { variant: 'error' });
    }
  }

  function openSsh() {
    choosingFolder = true;
  }

  async function browse(current: string) {
    try {
      return (await window.bonfire.projects.chooseFolder()) ?? current;
    } catch (cause) {
      toast(errorMessage(cause), { variant: 'error' });
      return current;
    }
  }

  /** The footer's button: adds the chosen folder, or clones what's picked. */
  function submit(event: SubmitEvent) {
    event.preventDefault();
    if (source === 'folder') void add();
    else void clone();
  }

  async function add() {
    if (!folder) return;
    adding = true;
    try {
      oncreated(
        await window.bonfire.projects.create({
          name: folderName(folder.path),
          path: folder.path,
          connectionId: folder.connectionId,
        }),
      );
    } catch (cause) {
      toast(errorMessage(cause), { variant: 'error', duration: 0 });
    } finally {
      adding = false;
    }
  }

  async function clone() {
    const into = parent.trim();
    if (!url || !into) return;
    cloning = true;
    try {
      oncreated(await window.bonfire.projects.clone({ url, parent: into }));
    } catch (cause) {
      toast(errorMessage(cause), { variant: 'error', duration: 0 });
    } finally {
      cloning = false;
    }
  }

  onMount(async () => {
    try {
      parent ||= await window.bonfire.projects.cloneFolder();
    } catch (cause) {
      toast(errorMessage(cause), { variant: 'error' });
    }
  });
</script>

<form id={FORM_ID} class="flex flex-col gap-12" onsubmit={submit}>
  <section class="flex flex-col gap-3" aria-labelledby="folder-heading">
    <h3 id="folder-heading" class="text-sm font-medium text-muted-foreground">
      Open a folder
    </h3>
    {#each ['local', 'ssh'] as kind (kind)}
      {@const remote = kind === 'ssh'}
      {@const chosen =
        source === 'folder' && folder && !!folder.connectionId === remote
          ? folder
          : undefined}
      <div
        class={cn(
          'flex items-center gap-3.5 rounded-xl bg-foreground/4 p-4',
          chosen && 'ring-[1.5px] ring-foreground',
        )}
      >
        <div
          class="grid size-10 shrink-0 place-content-center rounded-lg bg-muted"
        >
          <Icon name={remote ? 'server' : 'computer'} class="size-5" />
        </div>
        <div class="flex min-w-0 flex-1 flex-col">
          <span class="text-sm font-medium">
            {remote ? 'SSH' : 'Local folder'}
          </span>
          <span
            class="truncate text-sm text-muted-foreground"
            title={chosen?.path}
          >
            {#if chosen}
              {folderSource ? `${folderSource.name} · ` : ''}{chosen.path}
            {:else if remote}
              A repository on another machine
            {:else}
              A repository on this computer
            {/if}
          </span>
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={cloning || adding}
          onclick={() => (remote ? openSsh() : browseLocal())}
        >
          {chosen ? 'Change' : remote ? 'Choose' : 'Browse'}
        </Button>
      </div>
    {/each}
  </section>

  <section class="flex flex-col gap-3" aria-labelledby="github-heading">
    <h3 id="github-heading" class="text-sm font-medium text-muted-foreground">
      GitHub
    </h3>
    {#if githubSignedIn}
      <RepositoryList
        bind:selected={
          () => selected,
          (value) => {
            selectedRepository = value;
            source = 'github';
          }
        }
        disabled={cloning}
      />
      {#if selected}
        <div class="flex items-center gap-3.5 rounded-xl bg-foreground/4 p-4">
          <div
            class="grid size-10 shrink-0 place-content-center rounded-lg bg-muted"
          >
            <Icon name="folder" class="size-5" />
          </div>
          <div class="flex min-w-0 flex-1 flex-col">
            <span class="text-sm font-medium">Clone into</span>
            <span class="truncate text-sm text-muted-foreground" title={parent}>
              {parent
                ? parent.replace(/[\\/]+$/, '')
                : '…'}{#if name}/{name}{/if}
            </span>
          </div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={cloning}
            onclick={async () => (parent = await browse(parent))}
          >
            Browse
          </Button>
        </div>
      {/if}
    {:else if githubSignedIn === undefined}
      <div class="h-66 animate-pulse rounded-lg bg-muted/40"></div>
    {:else}
      <div
        class="flex flex-col items-center gap-4 rounded-xl border border-dashed border-border px-6 py-10 text-center"
      >
        <Icon name="github" class="size-6 text-muted-foreground" />
        <p class="max-w-80 text-sm text-pretty text-muted-foreground">
          Connect GitHub in the previous step to pick from your repositories.
        </p>
      </div>
    {/if}
  </section>
</form>

<FolderDialog
  bind:open={choosingFolder}
  remote
  value={folder?.connectionId ? folder : undefined}
  ondone={chosen}
/>
