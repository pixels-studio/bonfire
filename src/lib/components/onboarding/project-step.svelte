<script lang="ts" module>
  /** The clone form, which the footer's button submits from outside it. */
  export const FORM_ID = 'clone-project';
</script>

<script lang="ts">
  import { onMount } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';
  import Icon from '$lib/components/icon/icon.svelte';
  import FolderDialog, { type Folder } from './folder-dialog.svelte';
  import RepositoryList from './repository-list.svelte';
  import { toast } from '$lib/stores/toast.svelte';
  import type { Project } from '$shared/contracts';
  import {
    cloneUrl,
    errorMessage,
    folderName,
    repositoryName,
  } from '$shared/domain';
  import { connections } from '$lib/stores/connections.svelte';
  import { cn } from '$lib/utils';

  type Source = 'github' | 'url' | 'folder';

  let {
    githubSignedIn,
    onconnectGithub,
    oncreated,
    clone: cloneState = $bindable(),
  }: {
    /** Undefined while GitHub is being checked. */
    githubSignedIn?: boolean;
    /** Goes back to the GitHub step. */
    onconnectGithub: () => void;
    oncreated: (project: Project) => void;
    /** What the footer needs for its button; unset when the tab has nothing to do yet. */
    clone?: { ready: boolean; cloning: boolean; name: string };
  } = $props();

  let source = $state<Source>('folder');
  let selected = $state<string>();
  let typed = $state('');
  /** Where a clone goes. */
  let parent = $state('');
  let cloning = $state(false);
  /** The existing folder to add, once chosen. */
  let folder = $state<Folder>();
  let adding = $state(false);
  let choosingFolder = $state(false);
  const folderSource = $derived(connections.find(folder?.connectionId));

  const SOURCES: { value: Source; label: string; icon: string }[] = [
    { value: 'folder', label: 'Existing folder', icon: 'folder' },
    { value: 'github', label: 'From GitHub', icon: 'github' },
    { value: 'url', label: 'Clone URL', icon: 'git' },
  ];

  const canClone = $derived(
    source === 'url' || (source === 'github' && !!githubSignedIn),
  );

  $effect(() => {
    cloneState = canClone
      ? { ready: !!url && !!parent.trim(), cloning, name }
      : source === 'folder'
        ? { ready: !!folder, cloning: adding, name: '' }
        : undefined;
  });

  const url = $derived(
    source === 'github' ? selected : typed ? cloneUrl(typed) : undefined,
  );
  const name = $derived(url ? repositoryName(url) : '');
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

<form id={FORM_ID} class="flex min-h-0 flex-1 flex-col gap-5" onsubmit={submit}>
  <div
    class="flex gap-10 border-b border-border"
    role="tablist"
    aria-label="Where the project comes from"
  >
    {#each SOURCES as option (option.value)}
      <button
        type="button"
        role="tab"
        aria-selected={source === option.value}
        disabled={cloning || adding}
        class={cn(
          'flex items-center gap-2 pb-5 text-sm text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:text-foreground disabled:pointer-events-none',
          source === option.value && 'text-foreground',
        )}
        onclick={() => (source = option.value)}
      >
        <Icon name={option.icon} class="size-4" />
        {option.label}
      </button>
    {/each}
  </div>

  {#if source === 'folder'}
    {#if folder}
      <div class="flex items-center gap-3.5 rounded-xl bg-foreground/4 p-4">
        <div
          class="grid size-10 shrink-0 place-content-center rounded-lg bg-muted"
        >
          <Icon
            name={folder.connectionId ? 'server' : 'computer'}
            class="size-5"
          />
        </div>
        <div class="flex min-w-0 flex-1 flex-col">
          <span class="truncate text-sm font-medium">
            {folderName(folder.path)}
          </span>
          <span
            class="truncate text-sm text-muted-foreground"
            title={folder.path}
          >
            {folderSource ? `${folderSource.name} · ` : ''}{folder.path}
          </span>
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={adding}
          onclick={() => (choosingFolder = true)}
        >
          Change
        </Button>
      </div>
    {:else}
      <div
        class="flex flex-col items-center gap-4 rounded-xl border border-dashed border-border px-6 py-10 text-center"
      >
        <div class="flex gap-2 text-muted-foreground">
          <Icon name="computer" class="size-6" />
          <Icon name="server" class="size-6" />
        </div>
        <p class="max-w-80 text-sm text-pretty text-muted-foreground">
          Use a repository already on this computer, or on another machine over
          SSH.
        </p>
        <Button type="button" onclick={() => (choosingFolder = true)}>
          Choose folder
        </Button>
      </div>
    {/if}
  {:else}
    {#if source === 'github'}
      {#if githubSignedIn}
        <RepositoryList bind:selected disabled={cloning} />
      {:else if githubSignedIn === undefined}
        <div class="h-66 animate-pulse rounded-lg bg-muted/40"></div>
      {:else}
        <div
          class="flex flex-col items-center gap-4 rounded-xl border border-dashed border-border px-6 py-10 text-center"
        >
          <Icon name="github" class="size-6 text-muted-foreground" />
          <p class="max-w-80 text-sm text-pretty text-muted-foreground">
            Connect GitHub to pick from your repositories, or paste a clone URL
            instead.
          </p>
          <Button variant="secondary" onclick={onconnectGithub}>
            Connect GitHub
          </Button>
        </div>
      {/if}
    {:else}
      <label class="flex flex-col gap-2">
        <Label>Repository</Label>
        <Input
          bind:value={typed}
          class="h-9.5 px-3.5"
          placeholder="https://github.com/owner/repo.git or owner/repo"
          spellcheck={false}
          autocomplete="off"
          disabled={cloning}
          aria-invalid={!!typed.trim() && !url}
        />
        {#if typed.trim() && !url}
          <span class="text-xs text-destructive">
            Enter an HTTPS or SSH clone URL, or owner/repo for GitHub.
          </span>
        {/if}
      </label>
    {/if}

    {#if source === 'url' || githubSignedIn}
      <div
        class="mt-3 flex items-center gap-3.5 rounded-xl bg-foreground/4 p-4"
      >
        <div
          class="grid size-10 shrink-0 place-content-center rounded-lg bg-muted"
        >
          <Icon name="folder" class="size-5" />
        </div>
        <div class="flex min-w-0 flex-1 flex-col">
          <span class="text-sm font-medium">Choose location</span>
          <span class="truncate text-sm text-muted-foreground" title={parent}>
            {parent ? parent.replace(/[\\/]+$/, '') : '…'}{#if name}/{name}{/if}
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
  {/if}
</form>

<FolderDialog
  bind:open={choosingFolder}
  value={folder}
  ondone={(chosen) => (folder = chosen)}
/>
