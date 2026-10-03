<script lang="ts">
  import type { Snippet } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import { shortcutText } from '$lib/shortcuts';
  import { pullRequest } from '$lib/stores/pull-request.svelte';
  import { cn, isMac } from '$lib/utils';
  import { ACTION_LABELS } from '$shared/domain';

  let {
    pullRequestOpen = $bindable(false),
    disabled,
    location,
    trafficLightInset = false,
  }: {
    /** Whether the pull request pane is open after the panes. */
    pullRequestOpen?: boolean;
    /** No project is open, so there is no pull request to show. */
    disabled: boolean;
    /** The project and workspace pickers. */
    location: Snippet;
    /** Keeps the pickers clear of the native window controls. */
    trafficLightInset?: boolean;
  } = $props();

  const pull = $derived(pullRequest.current);
  const mergeBlocked = $derived(
    pull?.state === 'open' &&
      (pull.draft
        ? 'Mark the pull request ready for review first'
        : pull.mergeable === 'no'
          ? 'The pull request has conflicts'
          : ''),
  );

  function togglePullRequest() {
    pullRequestOpen = !pullRequestOpen;
  }

  /** A branch with no open or merged pull request gets one written and opened for it. */
  const createsPullRequest = $derived(
    pull === null || pull?.state === 'closed',
  );

  const pullRequestHint = `(${shortcutText('pullRequest', isMac())})`;
  const UTILITY_BUTTON_CLASS = 'text-muted-foreground hover:text-foreground';
  const PILL_BUTTON_CLASS = 'min-w-36 rounded-full px-3';
  /** Each action has its own color, so what a button does shows before it is read. */
  const PUSH_BUTTON_CLASS = 'bg-success text-white hover:bg-success/85';
  const CONFLICTS_BUTTON_CLASS =
    'bg-amber-500 text-black hover:bg-amber-500/85';
  const CHECKS_BUTTON_CLASS =
    'bg-destructive text-black hover:bg-destructive/85';
  const MERGE_BUTTON_CLASS = 'bg-brand text-white hover:bg-brand/85';
</script>

{#snippet pushButton()}
  <Button
    size="sm"
    class={cn(PILL_BUTTON_CLASS, PUSH_BUTTON_CLASS)}
    {disabled}
    title="Have an agent commit the changes and push them to the remote"
    loading={pullRequest.running === 'push'}
    onclick={() => void pullRequest.run('push')}
  >
    {ACTION_LABELS.push}
  </Button>
{/snippet}

<header
  class={cn(
    'sticky top-0 z-20 flex min-h-13 shrink-0 items-center justify-between bg-background py-2 pr-4 app-drag',
    trafficLightInset && 'pl-11',
  )}
>
  <div class="flex min-w-0 items-center gap-2 app-no-drag">
    {@render location()}
  </div>
  <div class="flex items-center gap-3 app-no-drag">
    {#if pull?.state === 'open'}
      <Button
        variant={pullRequestOpen ? 'default' : 'secondary'}
        size="sm"
        class={cn(PILL_BUTTON_CLASS, !pullRequestOpen && UTILITY_BUTTON_CLASS)}
        aria-pressed={pullRequestOpen}
        title={`Pull request ${pullRequestHint}`}
        onclick={togglePullRequest}
      >
        #{pull.number}
      </Button>
      {#if pullRequest.pushable}
        {@render pushButton()}
      {:else if pull.mergeable === 'no'}
        <Button
          size="sm"
          class={cn(PILL_BUTTON_CLASS, CONFLICTS_BUTTON_CLASS)}
          {disabled}
          title="Have an agent merge the target branch in and resolve the conflicts"
          loading={pullRequest.running === 'resolveConflicts'}
          onclick={() => void pullRequest.run('resolveConflicts')}
        >
          {ACTION_LABELS.resolveConflicts}
        </Button>
      {:else if pull.checks === 'failing'}
        <Button
          size="sm"
          class={cn(PILL_BUTTON_CLASS, CHECKS_BUTTON_CLASS)}
          {disabled}
          title="Have an agent fix the failing checks"
          loading={pullRequest.running === 'fixChecks'}
          onclick={() => void pullRequest.run('fixChecks')}
        >
          {ACTION_LABELS.fixChecks}
        </Button>
      {:else}
        <Button
          size="sm"
          class={cn(PILL_BUTTON_CLASS, MERGE_BUTTON_CLASS)}
          title={mergeBlocked || 'Squash and merge the pull request'}
          disabled={!!mergeBlocked}
          loading={pullRequest.merging}
          onclick={() => void pullRequest.merge()}
        >
          Merge
        </Button>
      {/if}
    {:else if pullRequest.onBase}
      {#if pullRequest.pushable}
        {@render pushButton()}
      {/if}
    {:else}
      <Button
        variant={pullRequestOpen || createsPullRequest
          ? 'default'
          : 'secondary'}
        size="sm"
        class={cn(
          PILL_BUTTON_CLASS,
          !pullRequestOpen && !createsPullRequest && UTILITY_BUTTON_CLASS,
        )}
        aria-pressed={createsPullRequest ? undefined : pullRequestOpen}
        disabled={disabled || pull === undefined}
        title={`Create pull request ${pullRequestHint}`}
        loading={pullRequest.running === 'createPr'}
        onclick={createsPullRequest
          ? () => void pullRequest.run('createPr')
          : togglePullRequest}
      >
        {pull?.state === 'merged' ? 'Merged' : ACTION_LABELS.createPr}
      </Button>
    {/if}
  </div>
</header>
