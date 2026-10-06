<script lang="ts">
  import type { Snippet } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import Icon from '$lib/components/icon/icon.svelte';
  import { shortcutText } from '$lib/shortcuts';
  import { pullRequest } from '$lib/stores/pull-request.svelte';
  import { TOOL_PANES } from '$lib/panes';
  import { cn, isMac } from '$lib/utils';
  import {
    ACTION_LABELS,
    VIEW_PANE_TYPES,
    type ViewPaneType,
  } from '$shared/domain';
  import RunButton from './run-button.svelte';

  let {
    pullRequestOpen = $bindable(false),
    disabled,
    location,
    trafficLightInset = false,
    paneCount = 0,
    onclosePanes,
    openViews = [],
    ontoggleView,
  }: {
    /** The view panes open in the strip, whose toggles show as pressed. */
    openViews?: ViewPaneType[];
    /** Opens a view pane at the end of the strip, or closes it. */
    ontoggleView?: (type: ViewPaneType) => void;
    /** How many panes are open, which the close button acts on. */
    paneCount?: number;
    /** Closes every open pane. */
    onclosePanes?: () => void;
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

  /** Why a pull request can't be created now, such as a branch with nothing beyond its base. */
  const createBlocked = $derived(
    createsPullRequest ? pullRequest.draft?.blocked : undefined,
  );

  const pullRequestHint = `(${shortcutText('pullRequest', isMac())})`;

  const VIEW_SHORTCUTS = {
    files: 'newFiles',
    diff: 'newDiff',
    browser: 'newBrowser',
  } as const;
  const viewToggles = VIEW_PANE_TYPES.map((type) => ({
    ...TOOL_PANES.find((pane) => pane.type === type)!,
    type,
    shortcut: shortcutText(VIEW_SHORTCUTS[type], isMac()),
  }));
  const UTILITY_BUTTON_CLASS = 'text-muted-foreground hover:text-foreground';
  const CLOSE_BUTTON_CLASS =
    'bg-amber-500/10 text-amber-500 hover:bg-amber-500/20';
  const ACTION_BUTTON_CLASS = 'h-auto px-2 py-1';
  /** Each action has its own color, so what a button does shows before it is read. */
  const PUSH_BUTTON_CLASS = 'bg-green-700 text-white hover:bg-green-700/85';
  const CONFLICTS_BUTTON_CLASS =
    'bg-amber-500 text-black hover:bg-amber-500/85';
  const CHECKS_BUTTON_CLASS =
    'bg-destructive text-black hover:bg-destructive/85';
  const MERGE_BUTTON_CLASS = 'bg-brand text-white hover:bg-brand/85';
</script>

{#snippet pushButton()}
  <Button
    size="sm"
    class={cn(ACTION_BUTTON_CLASS, PUSH_BUTTON_CLASS)}
    disabled={disabled || !!pullRequest.running}
    loading={pullRequest.running === 'push'}
    title="Have an agent commit the changes and push them to the remote"
    onclick={() => void pullRequest.run('push')}
  >
    <Icon name="push" />
    {ACTION_LABELS.push}
  </Button>
{/snippet}

<header
  class={cn(
    'sticky top-0 z-20 flex min-h-13 shrink-0 items-center justify-between bg-background py-2 window-controls-inset app-drag',
    trafficLightInset && 'pl-11',
  )}
>
  <div class="flex min-w-0 items-center gap-2 app-no-drag">
    {@render location()}
  </div>
  <div class="flex items-center gap-3 app-no-drag">
    {#if !disabled}
      {#each viewToggles as view (view.type)}
        {@const open = openViews.includes(view.type)}
        <Button
          variant={open ? 'default' : 'secondary'}
          size="icon-sm"
          class={cn(!open && UTILITY_BUTTON_CLASS)}
          aria-label={view.label}
          aria-pressed={open}
          title={`${open ? 'Close' : 'Open'} ${view.label.toLowerCase()} (${view.shortcut})`}
          onclick={() => ontoggleView?.(view.type)}
        >
          <Icon name={view.icon} />
        </Button>
      {/each}
      <RunButton />
    {/if}
    {#if pull?.state === 'open'}
      <Button
        variant={pullRequestOpen ? 'default' : 'secondary'}
        size="sm"
        class={cn(
          ACTION_BUTTON_CLASS,
          !pullRequestOpen && UTILITY_BUTTON_CLASS,
        )}
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
          class={cn(ACTION_BUTTON_CLASS, CONFLICTS_BUTTON_CLASS)}
          disabled={disabled || !!pullRequest.running}
          title="Have an agent merge the target branch in and resolve the conflicts"
          onclick={() => void pullRequest.run('resolveConflicts')}
        >
          {ACTION_LABELS.resolveConflicts}
        </Button>
      {:else if pull.checks === 'failing'}
        <Button
          size="sm"
          class={cn(ACTION_BUTTON_CLASS, CHECKS_BUTTON_CLASS)}
          disabled={disabled || !!pullRequest.running}
          title="Have an agent fix the failing checks"
          onclick={() => void pullRequest.run('fixChecks')}
        >
          {ACTION_LABELS.fixChecks}
        </Button>
      {:else}
        <Button
          size="sm"
          class={cn(ACTION_BUTTON_CLASS, MERGE_BUTTON_CLASS)}
          title={mergeBlocked || 'Squash and merge the pull request'}
          disabled={!!mergeBlocked || !!pullRequest.running}
          loading={pullRequest.merging}
          onclick={() => void pullRequest.merge()}
        >
          Merge
        </Button>
      {/if}
    {:else if pullRequest.onBase}
      {#if pullRequest.pushable}
        {@render pushButton()}
      {:else if paneCount > 0 && pullRequest.draft}
        <Button
          size="sm"
          variant="secondary"
          class={cn(ACTION_BUTTON_CLASS, CLOSE_BUTTON_CLASS)}
          title={paneCount === 1
            ? 'Everything is pushed; close the pane'
            : 'Everything is pushed; close all panes'}
          disabled={!!pullRequest.running}
          onclick={onclosePanes}
        >
          <Icon name="close-panes" />
          {paneCount === 1 ? 'Close Pane' : 'Close Panes'}
        </Button>
      {/if}
    {:else}
      <Button
        variant={pullRequestOpen || createsPullRequest
          ? 'default'
          : 'secondary'}
        size="sm"
        class={cn(
          ACTION_BUTTON_CLASS,
          !pullRequestOpen && !createsPullRequest && UTILITY_BUTTON_CLASS,
        )}
        aria-pressed={createsPullRequest ? undefined : pullRequestOpen}
        disabled={disabled || pull === undefined || !!createBlocked}
        title={createBlocked || `Create pull request ${pullRequestHint}`}
        onclick={createsPullRequest
          ? () => void pullRequest.run('createPr')
          : togglePullRequest}
      >
        {#if createsPullRequest}
          <Icon name="pull-request" />
        {/if}
        {pull?.state === 'merged' ? 'Merged' : ACTION_LABELS.createPr}
      </Button>
    {/if}
  </div>
</header>
