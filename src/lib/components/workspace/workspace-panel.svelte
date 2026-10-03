<script lang="ts" module>
  export type WorkspaceView = 'files' | 'terminal' | 'diff' | 'pull-request';

  export const WORKSPACE_VIEWS: {
    view: WorkspaceView;
    icon: string;
    label: string;
    title: string;
  }[] = [
    { view: 'files', icon: 'folder', label: 'Files', title: 'Files' },
    {
      view: 'terminal',
      icon: 'terminal',
      label: 'Terminal',
      title: 'Terminal',
    },
    { view: 'diff', icon: 'code', label: 'Code diff', title: 'Changes' },
  ];

  /** Opened from the header's pull request button rather than the icon buttons. */
  export const PULL_REQUEST_VIEW = {
    view: 'pull-request',
    icon: 'git',
    label: 'Pull request',
    title: 'Pull request',
  } as const;

  /** Each workspace's open shell tabs and the one in front, kept while the panel is closed. */
  const terminals = $state<
    Record<string, { tabs: number[]; active: 'setup' | number }>
  >({});
</script>

<script lang="ts">
  import { untrack } from 'svelte';
  import * as Card from '$lib/components/ui/card';
  import Icon from '$lib/components/icon/icon.svelte';
  import Inspector from '../inspector/inspector.svelte';
  import FileViewer from '../file-tree/file-viewer.svelte';
  import PullRequestPane from '../pull-request/pull-request-pane.svelte';
  import { Button } from '$lib/components/ui/button';
  import PaneMenu from '$lib/components/pane-menu/pane-menu.svelte';
  import type { PaneSize } from '$lib/panes';
  import { cn } from '$lib/utils';
  import {
    MAX_SHELL_TABS,
    type Session,
    type SetupStatus,
  } from '$shared/contracts';

  let {
    session,
    view,
    setup,
    onresize,
    onclose,
  }: {
    session: Session;
    view: WorkspaceView;
    /** How the workspace's setup script went, if one ran. */
    setup?: SetupStatus;
    onresize: (size: PaneSize) => void;
    onclose: () => void;
  } = $props();

  const FIRST = { tabs: [0], active: 0 } as const;

  function open(id: string) {
    // A setup that is running or failed is what the user wants to see first.
    return (terminals[id] ??= {
      tabs: [0],
      active: setup && setup !== 'succeeded' ? 'setup' : 0,
    });
  }

  untrack(() => open(session.id));
  $effect.pre(() => {
    const id = session.id;
    untrack(() => open(id));
  });

  let openFile = $state('');
  $effect.pre(() => {
    void [session.id, view];
    openFile = '';
  });

  const shells = $derived(terminals[session.id] ?? FIRST);
  const item = $derived(
    [...WORKSPACE_VIEWS, PULL_REQUEST_VIEW].find((item) => item.view === view),
  );

  // A setup that starts while the panel is open comes to the front; finishing leaves it there.
  $effect(() => {
    if (setup === 'running') shells.active = 'setup';
  });

  function addTab() {
    const free = Array.from({ length: MAX_SHELL_TABS }, (_, tab) => tab).find(
      (tab) => !shells.tabs.includes(tab),
    );
    if (free === undefined) return;
    shells.tabs = [...shells.tabs, free];
    shells.active = free;
  }

  function closeTab(tab: number) {
    const index = shells.tabs.indexOf(tab);
    shells.tabs = shells.tabs.filter((open) => open !== tab);
    if (shells.active === tab)
      shells.active = shells.tabs[Math.max(index - 1, 0)] ?? 0;
    window.bonfire.terminal.close(session.id, tab).catch(() => {});
  }
</script>

<Card.Root class="relative h-full min-w-0 gap-0">
  <header
    class="flex min-h-13.5 shrink-0 items-center justify-between gap-3 py-3 pr-2 pl-4"
  >
    {#if view === 'terminal'}
      <div class="flex min-w-0 items-center gap-2">
        <Icon
          name={item?.icon ?? 'terminal'}
          class="shrink-0 text-muted-foreground"
        />
        <div
          role="tablist"
          aria-label="Terminal"
          class="flex min-w-0 items-center gap-4 overflow-x-auto text-sm font-semibold [scrollbar-width:none]"
        >
          {#if setup}
            {@render tab('setup', 'Setup')}
          {/if}
          {#each shells.tabs as shell, index (shell)}
            {@render tab(shell, index ? `Terminal ${index + 1}` : 'Terminal')}
          {/each}
        </div>
      </div>
      <div class="flex shrink-0 items-center gap-2">
        <Button
          variant="secondary"
          size="icon"
          class="shrink-0 rounded-full"
          aria-label="New terminal"
          title={shells.tabs.length >= MAX_SHELL_TABS
            ? `Up to ${MAX_SHELL_TABS} terminals`
            : 'New terminal'}
          disabled={shells.tabs.length >= MAX_SHELL_TABS}
          onclick={addTab}
        >
          <Icon name="plus" />
        </Button>
        {@render menu()}
      </div>
    {:else}
      <h2 class="flex items-center gap-2 text-sm font-semibold">
        {#if item}<Icon name={item.icon} class="text-muted-foreground" />{/if}
        {item?.title}
      </h2>
      {@render menu()}
    {/if}
  </header>
  <div class="relative min-h-0 flex-1">
    {#if view === 'terminal'}
      {#await import('../terminal-pane/terminal-pane.svelte') then { default: TerminalPane }}
        {#key `${session.id}:${shells.active}`}
          <TerminalPane
            sessionId={session.id}
            type={shells.active === 'setup' ? 'setup' : 'shell'}
            tab={shells.active === 'setup' ? undefined : shells.active}
          />
        {/key}
      {/await}
    {:else if view === 'pull-request'}
      {#key session.id}
        <PullRequestPane sessionId={session.id} />
      {/key}
    {:else}
      {#key `${session.id}:${view}`}
        <Inspector
          {session}
          initialMode={view}
          {openFile}
          onopenfile={(path) => (openFile = path)}
        />
      {/key}
    {/if}
  </div>
  {#if openFile}
    <FileViewer
      sessionId={session.id}
      path={openFile}
      onclose={() => (openFile = '')}
      {onresize}
      onclosepanel={onclose}
    />
  {/if}
</Card.Root>

{#snippet menu()}
  <PaneMenu label={`${item?.title ?? 'Panel'} options`} {onresize} {onclose} />
{/snippet}

{#snippet tab(value: 'setup' | number, label: string)}
  <div
    class={cn(
      'flex shrink-0 items-center gap-1.5 text-muted-foreground transition-colors duration-150',
      shells.active === value && 'text-foreground',
    )}
  >
    <button
      type="button"
      role="tab"
      aria-selected={shells.active === value}
      class="rounded-sm whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
      onclick={() => (shells.active = value)}
    >
      {label}
    </button>
    {#if value !== 'setup' && shells.tabs.length > 1}
      <button
        type="button"
        aria-label={`Close ${label}`}
        class="flex size-4 items-center justify-center rounded-full outline-none hover:bg-foreground/10 focus-visible:ring-2 focus-visible:ring-ring/60"
        onclick={() => closeTab(value)}
      >
        <Icon name="close" class="size-2.5" />
      </button>
    {/if}
  </div>
{/snippet}
