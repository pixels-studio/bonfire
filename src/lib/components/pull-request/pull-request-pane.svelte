<script lang="ts">
  import { overlayScrollbar } from '$lib/scrollbar';
  import { untrack } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import { Checkbox } from '$lib/components/ui/checkbox';
  import { Input, Textarea } from '$lib/components/ui/input';
  import Icon from '$lib/components/icon/icon.svelte';
  import { pullRequest } from '$lib/stores/pull-request.svelte';
  import { toast } from '$lib/stores/toast.svelte';
  import { cn } from '$lib/utils';
  import type { PullRequest, PullRequestDraft } from '$shared/contracts';
  import { errorMessage } from '$shared/domain';

  let { workspaceId }: { workspaceId: string } = $props();

  const CHECKS: Record<
    PullRequest['checks'],
    { label: string; class: string }
  > = {
    none: { label: 'No checks', class: 'text-muted-foreground' },
    pending: { label: 'Checks running', class: 'text-orange-400' },
    passing: { label: 'Checks passed', class: 'text-success' },
    failing: { label: 'Checks failed', class: 'text-destructive' },
  };

  const pull = $derived(pullRequest.current);
  /** A closed pull request is over; the branch can open another. */
  const composing = $derived(pull === null || pull?.state === 'closed');

  let draft = $state<PullRequestDraft>();
  let loadError = $state('');
  let title = $state('');
  let body = $state('');
  let commit = $state(true);
  let creating = $state(false);

  async function loadDraft() {
    const id = workspaceId;
    draft = undefined;
    loadError = '';
    try {
      const next = await window.bonfire.github.pullRequestDraft(id);
      if (id !== workspaceId) return;
      draft = next;
      title = next.title;
      body = next.body;
      commit = true;
    } catch (cause) {
      if (id === workspaceId) loadError = errorMessage(cause);
    }
  }

  // Each time there is a pull request to compose, start from what the branch holds.
  $effect(() => {
    if (!composing) return;
    void workspaceId;
    untrack(() => void loadDraft());
  });

  /** Without committing, only commits already on the branch go into the pull request. */
  const nothingToOpen = $derived(
    !!draft && !draft.commits.length && !(commit && draft.uncommitted),
  );

  async function create(event: SubmitEvent) {
    event.preventDefault();
    if (creating || !title.trim()) return;
    creating = true;
    try {
      await pullRequest.create({ title, body, commit });
    } catch (cause) {
      toast(errorMessage(cause), { variant: 'error', duration: 0 });
    } finally {
      creating = false;
    }
  }

  function open() {
    window.bonfire.github
      .openPullRequest(workspaceId)
      .catch((cause) => toast(errorMessage(cause), { variant: 'error' }));
  }
</script>

<div
  {@attach overlayScrollbar}
  class="flex h-full min-h-0 flex-col overflow-y-auto px-4 pb-4"
>
  {#if pull === undefined}
    <div
      class="grid flex-1 place-content-center"
      role="status"
      aria-label="Loading"
    >
      <div
        class="size-5 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground motion-reduce:animate-pulse"
      ></div>
    </div>
  {:else if pull && !composing}
    <div class="flex flex-col gap-4">
      <div class="flex flex-col gap-1.5">
        <div class="flex items-center gap-2 text-sm text-muted-foreground">
          <Icon name="git" />
          <span class="font-mono">#{pull.number}</span>
          <span
            class={cn(
              'rounded-full px-2 py-0.5 text-xs font-medium',
              pull.state === 'merged'
                ? 'bg-foreground/10 text-foreground'
                : pull.draft
                  ? 'bg-secondary text-muted-foreground'
                  : 'bg-success/15 text-success',
            )}
          >
            {pull.state === 'merged' ? 'Merged' : pull.draft ? 'Draft' : 'Open'}
          </span>
        </div>
        <h3 class="text-base font-medium text-pretty">{pull.title}</h3>
      </div>
      {#if pull.state === 'open'}
        <ul class="flex flex-col gap-1.5 text-sm">
          <li class={CHECKS[pull.checks].class}>{CHECKS[pull.checks].label}</li>
          {#if pull.mergeable === 'no'}
            <li class="text-destructive">Has conflicts with the base branch</li>
          {:else if pull.mergeable === 'yes'}
            <li class="text-muted-foreground">
              No conflicts with the base branch
            </li>
          {/if}
        </ul>
      {/if}
      <div class="flex gap-2">
        <Button variant="secondary" size="sm" onclick={open}>
          View on GitHub
        </Button>
        {#if pull.state === 'open'}
          <Button
            size="sm"
            disabled={pull.draft || pull.mergeable === 'no'}
            loading={pullRequest.merging}
            onclick={() => void pullRequest.merge()}
          >
            Squash and merge
          </Button>
        {/if}
      </div>
    </div>
  {:else if loadError}
    <p class="text-sm text-destructive">{loadError}</p>
  {:else if !draft}
    <div
      class="grid flex-1 place-content-center"
      role="status"
      aria-label="Loading"
    >
      <div
        class="size-5 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground motion-reduce:animate-pulse"
      ></div>
    </div>
  {:else if draft.blocked}
    <p class="text-sm text-pretty text-muted-foreground">{draft.blocked}</p>
  {:else}
    <form class="flex flex-col gap-4" onsubmit={create}>
      <p
        class="flex items-center gap-2 font-mono text-xs text-muted-foreground"
      >
        <span class="truncate text-foreground">{draft.branch}</span>
        <span aria-label="into">→</span>
        <span class="truncate">{draft.base}</span>
      </p>
      <Input
        bind:value={title}
        aria-label="Title"
        placeholder="Title"
        disabled={creating}
      />
      <Textarea
        bind:value={body}
        aria-label="Description"
        placeholder="Description"
        rows={8}
        disabled={creating}
      />
      {#if draft.commits.length}
        <div class="flex flex-col gap-1.5">
          <h3 class="text-xs font-medium text-muted-foreground">
            {draft.commits.length}
            {draft.commits.length === 1 ? 'commit' : 'commits'}
          </h3>
          <ul class="flex flex-col gap-1 text-sm">
            {#each draft.commits as subject, index (index)}
              <li class="truncate" title={subject}>{subject}</li>
            {/each}
          </ul>
        </div>
      {/if}
      {#if draft.uncommitted}
        <label class="flex items-center gap-2 text-sm">
          <Checkbox bind:checked={commit} disabled={creating} />
          Commit {draft.uncommitted}
          {draft.uncommitted === 1 ? 'changed file' : 'changed files'} first
        </label>
      {/if}
      <Button
        type="submit"
        class="self-start"
        disabled={!title.trim() || nothingToOpen}
        loading={creating}
      >
        Create pull request
      </Button>
    </form>
  {/if}
</div>
