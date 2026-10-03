<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import * as Card from '$lib/components/ui/card';
  import AppHeader from '$lib/components/app-header/app-header.svelte';
  import AppRail, {
    type AppPanel,
  } from '$lib/components/app-rail/app-rail.svelte';
  import AssistantView from '$lib/components/assistant-view/assistant-view.svelte';
  import Icon from '$lib/components/icon/icon.svelte';
  import InsightsPane from '$lib/components/insights/insights-pane.svelte';
  import SettingsPane from '$lib/components/settings/settings-pane.svelte';
  import NewWorkspaceDialog from '$lib/components/workspace/new-workspace-dialog.svelte';
  import ProjectPicker from '$lib/components/workspace/project-picker.svelte';
  import ProjectSettingsDialog from '$lib/components/workspace/project-settings-dialog.svelte';
  import WorkspacePanel, {
    type WorkspaceView,
  } from '$lib/components/workspace/workspace-panel.svelte';
  import WorkspacePicker from '$lib/components/workspace/workspace-picker.svelte';
  import {
    PANE_SIZES,
    defaultPaneSize,
    paneWidth,
    type PaneSize,
  } from '$lib/panes';
  import { PaneDrag } from '$lib/pane-drag.svelte';
  import { PaneStatuses, type PaneStatus } from '$lib/pane-status.svelte';
  import { playCompletionSound } from '$lib/sounds';
  import { preferences } from '$lib/stores/preferences.svelte';
  import { pullRequest } from '$lib/stores/pull-request.svelte';
  import { toast } from '$lib/stores/toast.svelte';
  import { cn, isMac, scrollBehavior } from '$lib/utils';
  import type { HTMLButtonAttributes } from 'svelte/elements';
  import type {
    AssistantEvent,
    AssistantProvider,
    Pane,
    PanesClosedEvent,
    SetupStatus,
    State,
  } from '$shared/contracts';
  import {
    MAX_PANES,
    emptyState,
    errorMessage,
    isWorktree,
    reorderLayout,
    workspaceLabel,
  } from '$shared/domain';

  let workspace = $state<State>(emptyState());
  let loaded = $state(false);
  let loading = $state(true);
  let busy = $state(false);
  let paneStrip = $state<HTMLDivElement>();
  const statuses = new PaneStatuses();
  let inView = $state<Record<string, boolean>>({});
  let sizeOverrides = $state<Record<string, PaneSize>>({});
  let viewSizes = $state<Partial<Record<WorkspaceView, PaneSize>>>({});
  const drag = new PaneDrag(() => paneStrip, reorder);
  let view = $state<WorkspaceView>();
  let panel = $state<AppPanel>();
  let creatingWorkspace = $state(false);
  let settingsProjectId = $state<string>();
  let setupStatuses = $state<Record<string, SetupStatus>>({});

  const session = $derived(
    workspace.sessions.find(({ id }) => id === workspace.currentSessionId),
  );
  const project = $derived(
    workspace.projects.find(({ id }) => id === session?.projectId),
  );
  const projectSessions = $derived(
    workspace.sessions.filter(({ projectId }) => projectId === project?.id),
  );
  /** Open conversation panes, in layout order, across every workspace. */
  const openPanes = $derived(
    workspace.layout.paneIds
      .map((id) => workspace.panes.find((pane) => pane.id === id))
      .filter(
        (pane): pane is Pane =>
          !!pane && !pane.archived && pane.type !== 'terminal',
      ),
  );
  /** The panes of the workspace on screen. */
  const panes = $derived(
    openPanes.filter(({ sessionId }) => sessionId === session?.id),
  );

  /** The workspace view, shown after the panes. */
  const trailingView = $derived(session ? view : undefined);
  /** Everything in the strip: the panel, the panes (or the empty state), and the view. */
  const stripCount = $derived(
    (panel ? 1 : 0) + Math.max(panes.length, 1) + (trailingView ? 1 : 0),
  );

  /** Conversations belong in worktrees; the project folder only hosts ones it already had. */
  const canAddPane = $derived(
    !!session && isWorktree(session) && panes.length < MAX_PANES,
  );
  /** The model new workspaces start with: the chosen default, else the last used. */
  const startingModel = $derived.by(() => {
    const { defaultModel, providers } = preferences.current;
    if (defaultModel && providers[defaultModel.provider])
      return defaultModel.model;
    const { lastProvider, lastModels } = workspace.settings;
    return lastProvider && providers[lastProvider]
      ? (lastModels?.[lastProvider] ?? '')
      : '';
  });

  const SECTION_CLASS =
    'h-full shrink-0 snap-start px-1 transition-[flex-basis,min-width] duration-200 ease-in-out motion-reduce:transition-none';

  const STATUS_PRIORITY: PaneStatus[] = ['input', 'working', 'error'];

  /** The most pressing status among a workspace's panes. */
  function workspaceStatus(sessionId: string): PaneStatus {
    const statusesHere = openPanes
      .filter((pane) => pane.sessionId === sessionId)
      .map(({ id }) => statuses.get(id));
    return (
      STATUS_PRIORITY.find((status) => statusesHere.includes(status)) ?? 'idle'
    );
  }

  function showError(cause: unknown) {
    toast(errorMessage(cause), { variant: 'error', duration: 0 });
  }

  async function refresh() {
    workspace = await window.bonfire.state.get();
  }

  async function runAction(task: () => Promise<unknown>) {
    busy = true;
    try {
      await task();
      await refresh();
    } catch (cause) {
      showError(cause);
    } finally {
      busy = false;
    }
  }

  /** A project starts with a worktree of its own, never in its folder. */
  function askForWorkspace(projectId: string) {
    const hasWorktree = workspace.sessions.some(
      (item) =>
        item.projectId === projectId && !item.archived && isWorktree(item),
    );
    if (!hasWorktree) creatingWorkspace = true;
  }

  async function addProject() {
    let added: string | undefined;
    await runAction(async () => {
      added = (await window.bonfire.projects.add())?.id;
    });
    if (added) askForWorkspace(added);
  }

  function removeProject(projectId: string) {
    void runAction(() => window.bonfire.projects.remove(projectId));
  }

  async function openProject(projectId: string) {
    if (projectId === project?.id) return;
    await runAction(() => window.bonfire.workspaces.openProject(projectId));
    askForWorkspace(projectId);
  }

  function openWorkspace(id: string) {
    if (id === session?.id) return;
    void runAction(() => window.bonfire.workspaces.open(id));
  }

  function newWorkspace() {
    if (!workspace.projects.length) {
      addProject();
      return;
    }
    creatingWorkspace = true;
  }

  function archiveWorkspace(id: string) {
    const target = workspace.sessions.find((item) => item.id === id);
    void runAction(async () => {
      const result = await window.bonfire.workspaces.archive(id);
      const name = target ? `“${workspaceLabel(target)}”` : 'The workspace';
      if (result.scriptError)
        toast(`The archive script failed: ${result.scriptError}`, {
          variant: 'error',
          duration: 0,
        });
      toast(
        result.keptFolder
          ? `Archived ${name}. Its folder has uncommitted changes, so it was kept.`
          : `Archived ${name}.`,
      );
    });
  }

  function restoreWorkspace(id: string) {
    void runAction(() => window.bonfire.workspaces.restore(id));
  }

  async function addPane(provider?: AssistantProvider, model?: string) {
    if (busy) return;
    if (!session) {
      addProject();
      return;
    }
    if (!isWorktree(session)) {
      toast('Create a workspace to start a conversation.');
      return;
    }
    if (!canAddPane) {
      toast(`A workspace can have up to ${MAX_PANES} panes open.`);
      return;
    }
    await runAction(() => window.bonfire.panes.add(provider, model));
    await tick();
    paneStrip?.scrollTo({ left: 0, behavior: scrollBehavior() });
  }

  function sizeClass(size: PaneSize) {
    return PANE_SIZES.find(({ value }) => value === size)?.class;
  }

  /** The size of anything in the strip that hasn't been resized. */
  const autoSizeClass = $derived(sizeClass(defaultPaneSize(stripCount)));

  function paneSizeClass(pane: Pane) {
    return sizeOverrides[pane.id]
      ? sizeClass(sizeOverrides[pane.id])
      : autoSizeClass;
  }

  /** Brings an opened panel or view into sight at its end of the strip. */
  async function revealEdge(edge: 'start' | 'end') {
    await tick();
    paneStrip?.scrollTo({
      left: edge === 'start' ? 0 : paneStrip.scrollWidth,
      behavior: scrollBehavior(),
    });
  }

  /**
   * Scrolls only the strip. `scrollIntoView` would also scroll the page
   * itself, pushing the header off-screen.
   */
  function scrollToPane(paneId: string) {
    const pane = paneStrip?.querySelector<HTMLElement>(
      `[data-pane-id="${CSS.escape(paneId)}"]`,
    );
    if (!paneStrip || !pane) return;
    const offset =
      pane.getBoundingClientRect().left -
      paneStrip.getBoundingClientRect().left;
    paneStrip.scrollTo({
      left: paneStrip.scrollLeft + offset,
      behavior: scrollBehavior(),
    });
  }

  /** Applies a new visible pane order locally, then saves it. */
  function reorder(ids: string[]) {
    workspace.layout.paneIds = reorderLayout(workspace.layout.paneIds, ids);
    void runAction(() => window.bonfire.panes.reorder(ids));
  }

  function dragHandle(pane: Pane): HTMLButtonAttributes {
    return {
      onpointerdown: (event) =>
        drag.start(
          event,
          pane.id,
          panes.map(({ id }) => id),
        ),
      onkeydown(event) {
        const step = { ArrowLeft: -1, ArrowRight: 1 }[event.key];
        if (!step || drag.active) return;
        event.preventDefault();
        const index = panes.findIndex(({ id }) => id === pane.id) + step;
        if (index < 0 || index >= panes.length) return;
        const ids = panes.map(({ id }) => id).filter((id) => id !== pane.id);
        ids.splice(index, 0, pane.id);
        reorder(ids);
        void tick().then(() => scrollToPane(pane.id));
      },
    };
  }

  // Pane status needs events for every pane, including ones scrolled out of view or in
  // other workspaces, whose status shows in the workspace picker.
  $effect(() => {
    if (!loaded) return;
    for (const { id } of openPanes) void statuses.load(id);
  });

  // A view of a workspace that's no longer on screen would show the wrong folder.
  $effect(() => {
    if (!session) view = undefined;
  });

  // The header's pull request button follows the workspace on screen.
  $effect(() => {
    if (!loaded) return;
    const id = session?.id;
    return untrack(() => pullRequest.watch(id));
  });

  $effect(() => {
    if (panel) void revealEdge('start');
  });

  function handleKeydown(event: KeyboardEvent) {
    const modifier = isMac() ? event.metaKey : event.ctrlKey;
    if (modifier && event.shiftKey && event.key.toLowerCase() === 'n') {
      event.preventDefault();
      newWorkspace();
    }
  }

  // Tracks which panes are in view so the header can mark them.
  $effect(() => {
    // Re-observes as panes come and go.
    void panes.length;
    if (!paneStrip) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const { target, isIntersecting } of entries) {
          const id = (target as HTMLElement).dataset.paneId;
          if (id) inView[id] = isIntersecting;
        }
      },
      { root: paneStrip, threshold: 0.5 },
    );
    for (const section of paneStrip.querySelectorAll('[data-pane-id]'))
      observer.observe(section);
    return () => observer.disconnect();
  });

  function handleAssistantEvent(event: AssistantEvent) {
    statuses.handle(event);
    if (
      event.type === 'status' &&
      event.status === 'completed' &&
      preferences.current.completionSound
    )
      playCompletionSound();
  }

  /** Development runs as the unsigned Electron app, which macOS never allows to notify. */
  function notificationsBlockedMessage(appName: string) {
    if (appName === 'Electron')
      return 'macOS doesn’t allow notifications from unsigned development builds. They work in a signed Bonfire build.';
    return `Notifications are turned off for ${appName}. Allow them in System Settings › Notifications › ${appName}.`;
  }

  async function handlePanesClosed({ paneIds }: PanesClosedEvent) {
    const titles = workspace.panes
      .filter(({ id }) => paneIds.includes(id))
      .map(({ title }) => `“${title}”`);
    await refresh();
    toast(
      titles.length === 1
        ? `Closed ${titles[0]}: its pull request was merged.`
        : `Closed ${titles.length} panes whose pull requests were merged.`,
    );
  }

  // The native traffic lights sit in the top-left except in full screen.
  let fullscreen = $state(false);
  const trafficLightInset = $derived(isMac() && !fullscreen);

  onMount(() => {
    if (!window.bonfire) return;
    window.bonfire.app.isFullscreen().then((value) => (fullscreen = value));
    const subscriptions = [
      window.bonfire.app.onFullscreenChange((value) => (fullscreen = value)),
      window.bonfire.assistant.onEvent(handleAssistantEvent),
      // A clicked notification brings its pane into view.
      window.bonfire.app.onFocusPane(scrollToPane),
      window.bonfire.panes.onClosed((event) => void handlePanesClosed(event)),
      window.bonfire.workspaces.onChanged(() => void refresh()),
      window.bonfire.workspaces.onSetup(({ sessionId, status }) => {
        setupStatuses[sessionId] = status;
        if (status === 'failed')
          toast(
            'The setup script failed. Its output is in the workspace terminal.',
            { variant: 'error' },
          );
      }),
      window.bonfire.app.onNotificationsBlocked((appName) =>
        toast(notificationsBlockedMessage(appName), {
          variant: 'error',
          duration: 0,
        }),
      ),
    ];
    return () => subscriptions.forEach((unsubscribe) => unsubscribe());
  });

  onMount(async () => {
    if (!window.bonfire) {
      showError('Launch Bonfire with npm start or npm run dev.');
      loading = false;
      return;
    }
    try {
      await refresh();
      setupStatuses = await window.bonfire.workspaces.setupStatus();
      loaded = true;
    } catch (cause) {
      showError(cause);
    } finally {
      loading = false;
    }
  });
</script>

<svelte:head><title>Bonfire</title></svelte:head>
<svelte:window onkeydown={handleKeydown} />

{#snippet placeholder()}
  {#if !workspace.projects.length}
    <Card.Root
      class="grid h-full place-content-center justify-items-center text-center text-muted-foreground"
    >
      <Icon name="project" class="size-7" />
      <h1 class="mt-6 font-medium text-foreground">Add a project</h1>
      <p class="mb-6">
        Choose a local repository for Claude and Codex to work in.
      </p>
      <Button disabled={!loaded || busy} onclick={addProject}>
        Add project
      </Button>
    </Card.Root>
  {:else}
    <Card.Root
      class="grid h-full place-content-center justify-items-center text-center text-muted-foreground"
    >
      <Icon name="bot" class="size-7" />
      {#if session && isWorktree(session)}
        <h1 class="mt-6 font-medium text-foreground">Start a conversation</h1>
        <p class="mb-6 max-w-90 text-pretty">
          Add a pane to work in “{workspaceLabel(session)}”, or start a new
          workspace for a separate task.
        </p>
        <div class="flex gap-2.5">
          <Button
            variant="secondary"
            disabled={!loaded || busy}
            onclick={newWorkspace}
          >
            New workspace
          </Button>
          <Button disabled={!loaded || busy} onclick={() => addPane()}>
            New conversation
          </Button>
        </div>
      {:else}
        <h1 class="mt-6 font-medium text-foreground">Create a workspace</h1>
        <p class="mb-6 max-w-90 text-pretty">
          Each task gets its own workspace: a separate branch and folder, so its
          changes can become a pull request.
        </p>
        <Button disabled={!loaded || busy} onclick={newWorkspace}>
          New workspace
        </Button>
      {/if}
    </Card.Root>
  {/if}
{/snippet}

<div class="flex h-screen">
  <AppRail
    bind:panel
    {trafficLightInset}
    onhelp={() => window.bonfire.navigation.help()}
  />
  <div class="flex min-w-0 flex-1 flex-col">
    <AppHeader
      {trafficLightInset}
      onaddPane={() => addPane()}
      panes={panes.map(({ id }) => ({
        id,
        status: statuses.get(id),
        inView: !!inView[id],
      }))}
      {canAddPane}
      onselectPane={scrollToPane}
      bind:view
      viewsDisabled={!session}
    >
      {#snippet location()}
        <ProjectPicker
          projects={workspace.projects}
          active={project}
          onselect={openProject}
          onadd={addProject}
          onsettings={(id) => (settingsProjectId = id)}
          onremove={removeProject}
        />
        {#if project}
          <WorkspacePicker
            sessions={projectSessions}
            current={session}
            statusOf={workspaceStatus}
            setupOf={(id) => setupStatuses[id]}
            onopen={openWorkspace}
            onnew={newWorkspace}
            onarchive={archiveWorkspace}
            onrestore={restoreWorkspace}
          />
        {/if}
      {/snippet}
    </AppHeader>

    <div class="flex min-h-0 flex-1">
      <main class="flex min-h-0 min-w-0 flex-1 pr-2 pb-2">
        <div class="min-w-0 flex-1">
          {#if loading}
            <div
              class="grid h-full place-content-center"
              role="status"
              aria-label="Loading"
            >
              <div
                class="size-5 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground motion-reduce:animate-pulse"
              ></div>
            </div>
          {:else}
            <div
              bind:this={paneStrip}
              class={cn(
                '-mx-1 flex h-full snap-x snap-mandatory overflow-x-auto overscroll-x-contain scrollbar-none',
                drag.active && 'snap-none select-none',
              )}
            >
              {#if panel}
                <section
                  class={cn(SECTION_CLASS, autoSizeClass)}
                  in:paneWidth
                  out:paneWidth
                >
                  {#if panel === 'settings'}
                    <SettingsPane />
                  {:else}
                    <InsightsPane />
                  {/if}
                </section>
              {/if}
              {#each panes as pane (`${pane.id}:${pane.type}`)}
                <section
                  data-pane-id={pane.id}
                  class={cn(
                    SECTION_CLASS,
                    paneSizeClass(pane),
                    drag.isDragging(pane.id) &&
                      '*:shadow-2xl *:shadow-black/50',
                  )}
                  style={drag.style(pane.id)}
                >
                  <AssistantView
                    {pane}
                    dragHandle={dragHandle(pane)}
                    onclose={() =>
                      runAction(() => window.bonfire.panes.archive(pane.id))}
                    onresize={(size) => (sizeOverrides[pane.id] = size)}
                    onswitchprovider={addPane}
                    onretype={(provider, model) =>
                      runAction(() =>
                        window.bonfire.panes.retype(pane.id, provider, model),
                      )}
                  />
                </section>
              {:else}
                <section class={cn(SECTION_CLASS, autoSizeClass)}>
                  {@render placeholder()}
                </section>
              {/each}
              {#if session && trailingView}
                <section
                  class={cn(
                    SECTION_CLASS,
                    viewSizes[trailingView]
                      ? sizeClass(viewSizes[trailingView])
                      : autoSizeClass,
                  )}
                  in:paneWidth
                  out:paneWidth
                  onintroend={() => void revealEdge('end')}
                >
                  <WorkspacePanel
                    {session}
                    view={trailingView}
                    setup={setupStatuses[session.id]}
                    onresize={(size) => (viewSizes[trailingView] = size)}
                    onclose={() => (view = undefined)}
                  />
                </section>
              {/if}
            </div>
          {/if}
        </div>
      </main>
    </div>
  </div>
</div>

<NewWorkspaceDialog
  bind:open={creatingWorkspace}
  projects={workspace.projects}
  projectId={project?.id}
  model={startingModel}
  onaddproject={addProject}
  oncreated={() => void refresh()}
/>
<ProjectSettingsDialog
  bind:open={
    () => !!settingsProjectId,
    (next) => !next && (settingsProjectId = undefined)
  }
  project={workspace.projects.find(({ id }) => id === settingsProjectId)}
  onsaved={() => void refresh()}
/>
