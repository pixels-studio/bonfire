<script lang="ts">
  import type { Snippet } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import Icon from '$lib/components/icon/icon.svelte';
  import { shortcutText } from '$lib/shortcuts';
  import { pullRequest } from '$lib/stores/pull-request.svelte';
  import { cn, isMac } from '$lib/utils';

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

  const pullRequestHint = `(${shortcutText('pullRequest', isMac())})`;
  const UTILITY_BUTTON_CLASS = 'text-muted-foreground hover:text-foreground';
  const PILL_BUTTON_CLASS = 'rounded-full px-3';
</script>

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
        <Icon name="git" />
        #{pull.number}
      </Button>
      <Button
        size="sm"
        class={PILL_BUTTON_CLASS}
        title={mergeBlocked || 'Squash and merge the pull request'}
        disabled={!!mergeBlocked}
        loading={pullRequest.merging}
        onclick={() => void pullRequest.merge()}
      >
        Merge
      </Button>
    {:else}
      <Button
        variant={pullRequestOpen ? 'default' : 'secondary'}
        size="sm"
        class={cn(PILL_BUTTON_CLASS, !pullRequestOpen && UTILITY_BUTTON_CLASS)}
        aria-pressed={pullRequestOpen}
        disabled={disabled || pull === undefined}
        title={`Create pull request ${pullRequestHint}`}
        onclick={togglePullRequest}
      >
        <Icon name={pull?.state === 'merged' ? 'check' : 'git'} />
        {pull?.state === 'merged' ? 'Merged' : 'Create PR'}
      </Button>
    {/if}
  </div>
</header>
