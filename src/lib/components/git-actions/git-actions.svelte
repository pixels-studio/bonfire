<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import Icon from '$lib/components/icon/icon.svelte';
  import { shortcutText } from '$lib/shortcuts';
  import { pullRequest } from '$lib/stores/pull-request.svelte';
  import { cn, isMac } from '$lib/utils';
  import { ACTION_LABELS } from '$shared/domain';
  import HeaderTip from './header-tip.svelte';

  // The git actions of the branch on screen: what to do next with its work, as one button.
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
    pullRequest.paneOpen = !pullRequest.paneOpen;
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

  const UTILITY_BUTTON_CLASS = 'text-muted-foreground hover:text-foreground';
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
  <HeaderTip
    text={'Have an agent commit the changes and push them to the remote'}
  >
    <Button
      size="sm"
      class={cn(ACTION_BUTTON_CLASS, PUSH_BUTTON_CLASS)}
      disabled={!!pullRequest.running}
      loading={pullRequest.running === 'push'}
      onclick={() => void pullRequest.run('push')}
    >
      <Icon name="push" />
      {ACTION_LABELS.push}
    </Button>
  </HeaderTip>
{/snippet}

{#if pull?.state === 'open'}
  <HeaderTip text={`Pull request ${pullRequestHint}`}>
    <Button
      variant={pullRequest.paneOpen ? 'default' : 'secondary'}
      size="sm"
      class={cn(
        ACTION_BUTTON_CLASS,
        !pullRequest.paneOpen && UTILITY_BUTTON_CLASS,
      )}
      aria-pressed={pullRequest.paneOpen}
      onclick={togglePullRequest}
    >
      #{pull.number}
    </Button>
  </HeaderTip>
  {#if pullRequest.pushable}
    {@render pushButton()}
  {:else if pull.mergeable === 'no'}
    <HeaderTip
      text={'Have an agent merge the target branch in and resolve the conflicts'}
    >
      <Button
        size="sm"
        class={cn(ACTION_BUTTON_CLASS, CONFLICTS_BUTTON_CLASS)}
        disabled={!!pullRequest.running}
        onclick={() => void pullRequest.run('resolveConflicts')}
      >
        {ACTION_LABELS.resolveConflicts}
      </Button>
    </HeaderTip>
  {:else if pull.checks === 'failing'}
    <HeaderTip text={'Have an agent fix the failing checks'}>
      <Button
        size="sm"
        class={cn(ACTION_BUTTON_CLASS, CHECKS_BUTTON_CLASS)}
        disabled={!!pullRequest.running}
        onclick={() => void pullRequest.run('fixChecks')}
      >
        {ACTION_LABELS.fixChecks}
      </Button>
    </HeaderTip>
  {:else}
    <HeaderTip text={mergeBlocked || 'Squash and merge the pull request'}>
      <Button
        size="sm"
        class={cn(ACTION_BUTTON_CLASS, MERGE_BUTTON_CLASS)}
        disabled={!!mergeBlocked || !!pullRequest.running}
        loading={pullRequest.merging}
        onclick={() => void pullRequest.merge()}
      >
        Merge
      </Button>
    </HeaderTip>
  {/if}
{:else if pullRequest.onBase}
  {#if pullRequest.pushable}
    {@render pushButton()}
  {/if}
{:else}
  <HeaderTip text={createBlocked || `Create pull request ${pullRequestHint}`}>
    <Button
      variant={pullRequest.paneOpen || createsPullRequest
        ? 'default'
        : 'secondary'}
      size="sm"
      class={cn(
        ACTION_BUTTON_CLASS,
        !pullRequest.paneOpen && !createsPullRequest && UTILITY_BUTTON_CLASS,
      )}
      aria-pressed={createsPullRequest ? undefined : pullRequest.paneOpen}
      disabled={pull === undefined || !!createBlocked}
      onclick={createsPullRequest
        ? () => void pullRequest.run('createPr')
        : togglePullRequest}
    >
      {#if createsPullRequest}
        <Icon name="pull-request" />
      {/if}
      {pull?.state === 'merged' ? 'Merged' : ACTION_LABELS.createPr}
    </Button>
  </HeaderTip>
{/if}
