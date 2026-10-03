<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import * as Card from '$lib/components/ui/card';
  import AppHeader from '$lib/components/app-header/app-header.svelte';
  import AppRail, {
    type AppPanel,
  } from '$lib/components/app-rail/app-rail.svelte';
  import BranchPicker from '$lib/components/workspace/branch-picker.svelte';
  import CreateProjectDialog from '$lib/components/workspace/create-project-dialog.svelte';
  import Icon from '$lib/components/icon/icon.svelte';
  import InsightsPane from '$lib/components/insights/insights-pane.svelte';
  import SettingsPane from '$lib/components/settings/settings-pane.svelte';
  import PaneView from '$lib/components/pane-view/pane-view.svelte';
  import PullRequestView from '$lib/components/pull-request/pull-request-view.svelte';
  import NewBranchDialog from '$lib/components/workspace/new-branch-dialog.svelte';
  import ProjectPicker from '$lib/components/workspace/project-picker.svelte';
  import ShortcutsPane from '$lib/components/shortcuts/shortcuts-pane.svelte';
  import Onboarding from '$lib/components/onboarding/onboarding.svelte';
  import {
    PANE_SIZES,
    defaultPaneSize,
    paneWidth,
    type PaneSize,
  } from '$lib/panes';
  import { digitOf, matchShortcut, type ShortcutId } from '$lib/shortcuts';
  import { PaneDrag } from '$lib/pane-drag.svelte';
  import { PaneStatuses } from '$lib/pane-status.svelte';
  import { playCompletionSound } from '$lib/sounds';
  import { branch } from '$lib/stores/branch.svelte';
  import { preferences } from '$lib/stores/preferences.svelte';
  import { pullRequest } from '$lib/stores/pull-request.svelte';
  import { toast } from '$lib/stores/toast.svelte';
  import { cn, isMac, scrollBehavior } from '$lib/utils';
  import type { HTMLButtonAttributes } from 'svelte/elements';
  import type {
    AssistantEvent,
    AssistantProvider,
    Project,
    ProviderAccount,
    Pane,
    PaneType,
    PanesClosedEvent,
    State,
  } from '$shared/contracts';
  import {
    MAX_PANES,
    emptyState,
    errorMessage,
    isAssistantPane,
    reorderLayout,
  } from '$shared/domain';

  let workspace = $state<State>(emptyState());
  let loaded = $state(false);
  let loading = $state(true);
  let busy = $state(false);
  let paneStrip = $state<HTMLDivElement>();
  const statuses = new PaneStatuses();
  let inView = $state<Record<string, boolean>>({});
  let panelsInView = $state<Partial<Record<AppPanel, boolean>>>({});
  let sizeOverrides = $state<Record<string, PaneSize>>({});
  let pullRequestSize = $state<PaneSize>();
  const drag = new PaneDrag(() => paneStrip, reorder);
  let pullRequestOpen = $state(false);
  /** The open panels, newest first, ahead of the panes. */
  let panels = $state<AppPanel[]>([]);
  let creatingBranch = $state(false);
  let creatingProject = $state(false);
  let projectMenuOpen = $state(false);
  let branchMenuOpen = $state(false);
  /** The tab the insights panel is on, which the usage shortcut switches. */
  let insightsTab = $state('tokens');
  /** The pane last clicked, focused or navigated to, which the pane shortcuts act on. */
  let currentPaneId = $state<string>();
  /** Whether setup is on screen instead of the workspace: no agent signed in, or no project. */
  let onboarding = $state(false);
  let accounts = $state<Partial<Record<AssistantProvider, ProviderAccount>>>(
    {},
  );
  let accountErrors = $state<Partial<Record<AssistantProvider, string>>>({});

  const project = $derived(
    workspace.projects.find(({ id }) => id === workspace.lastProjectId),
  );
  /** The open panes of the project on screen, agents and tools alike, in layout order. */
  const panes = $derived(
    workspace.layout.paneIds
      .map((id) => workspace.panes.find((pane) => pane.id === id))
      .filter(
        (pane): pane is Pane =>
          !!pane && !pane.archived && pane.projectId === project?.id,
      ),
  );
  const assistantPanes = $derived(panes.filter(isAssistantPane));
  /** The pane the pane shortcuts act on: the current one, else the first in sight. */
  const activePane = $derived(
    panes.find(({ id }) => id === currentPaneId) ??
      panes.find(({ id }) => inView[id]) ??
      panes[0],
  );
  /** Whether an agent is mid-turn, which keeps the branch where it is. */
  const agentsWorking = $derived(
    assistantPanes.some(({ id }) =>
      ['working', 'input'].includes(statuses.get(id)),
    ),
  );
  const isRepository = $derived(!!branch.head?.isGit);

  /** The pull request pane, shown after the panes. */
  const showPullRequest = $derived(!!project && pullRequestOpen);
  /** Everything in the strip: the panels, the panes (or the empty state), and the pull request. */
  const stripCount = $derived(
    panels.length + Math.max(panes.length, 1) + (showPullRequest ? 1 : 0),
  );

  const canAddPane = $derived(!!project && panes.length < MAX_PANES);

  const SECTION_CLASS =
    'h-full shrink-0 snap-start px-1 transition-[flex-basis,min-width] duration-200 ease-in-out motion-reduce:transition-none';

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

  function addProject() {
    creatingProject = true;
  }

  function removeProject(projectId: string) {
    void runAction(() => window.bonfire.projects.remove(projectId));
  }

  function openProject(projectId: string) {
    if (projectId === project?.id) return;
    void runAction(() => window.bonfire.projects.open(projectId));
  }

  function switchBranch(name: string) {
    void branch.switchTo(name).catch(showError);
  }

  function newBranch() {
    if (!project || !isRepository) return;
    if (agentsWorking) {
      toast('An agent is working. Switch branches once it finishes.');
      return;
    }
    creatingBranch = true;
  }

  /** Opens a pane at the front of the strip; an agent with the last-used provider by default. */
  async function addPane(type?: PaneType) {
    if (busy) return;
    if (!project) {
      addProject();
      return;
    }
    if (!canAddPane) {
      toast(`A project can have up to ${MAX_PANES} panes open.`);
      return;
    }
    const count = panes.length;
    await runAction(() => window.bonfire.panes.add(type));
    await tick();
    paneStrip?.scrollTo({ left: 0, behavior: scrollBehavior() });
    if (panes.length > count) void focusPane(panes[0].id);
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

  const HIGHLIGHT_MS = 1200;
  /** An inset overlay: the strip clips anything drawn outside the card. */
  const HIGHLIGHT_CLASS =
    'relative after:pointer-events-none after:absolute after:inset-x-1 after:inset-y-0 after:rounded-lg after:opacity-0 after:ring-2 after:ring-brand after:transition-opacity after:duration-500 after:ease-out after:ring-inset motion-reduce:after:transition-none';
  const HIGHLIGHTED_CLASS = 'after:opacity-100 after:duration-150';
  /** The pane or panel just scrolled to, outlined briefly so it's found at a glance. */
  let highlightedId = $state<string>();
  let highlightTimer: ReturnType<typeof setTimeout> | undefined;

  function highlight(id: string) {
    clearTimeout(highlightTimer);
    highlightedId = id;
    highlightTimer = setTimeout(
      () => (highlightedId = undefined),
      HIGHLIGHT_MS,
    );
  }

  /**
   * Scrolls only the strip. `scrollIntoView` would also scroll the page
   * itself, pushing the header off-screen.
   */
  function scrollToSection(selector: string, id: string) {
    const section = paneStrip?.querySelector<HTMLElement>(selector);
    if (!paneStrip || !section) return;
    highlight(id);
    const offset =
      section.getBoundingClientRect().left -
      paneStrip.getBoundingClientRect().left;
    paneStrip.scrollTo({
      left: paneStrip.scrollLeft + offset,
      behavior: scrollBehavior(),
    });
  }

  function scrollToPane(paneId: string) {
    currentPaneId = paneId;
    scrollToSection(`[data-pane-id="${CSS.escape(paneId)}"]`, paneId);
  }

  /** Scrolls to a pane and puts the cursor in it, in its message box, search or terminal. */
  async function focusPane(paneId: string) {
    scrollToPane(paneId);
    await tick();
    paneStrip
      ?.querySelector<HTMLElement>(
        `[data-pane-id="${CSS.escape(paneId)}"] :is(textarea, input[type="search"])`,
      )
      ?.focus({ preventScroll: true });
  }

  /** Remembers the pane that was clicked or focused. */
  function trackPane(event: Event) {
    const paneId = (event.target as Element).closest<HTMLElement>(
      '[data-pane-id]',
    )?.dataset.paneId;
    if (paneId) currentPaneId = paneId;
  }

  /** Panel names can't clash with pane ids, which are UUIDs. */
  function scrollToPanel(panel: AppPanel) {
    scrollToSection(`[data-panel="${panel}"]`, panel);
  }

  /** Closes an open panel, or opens it at the front of the strip. */
  function togglePanel(panel: AppPanel) {
    if (panels.includes(panel)) {
      panels = panels.filter((open) => open !== panel);
      return;
    }
    panels = [panel, ...panels];
    void revealEdge('start');
  }

  /** Applies a new visible pane order locally, then saves it. */
  function reorder(ids: string[]) {
    workspace.layout.paneIds = reorderLayout(workspace.layout.paneIds, ids);
    void runAction(() => window.bonfire.panes.reorder(ids));
  }

  /** Moves a pane along the strip, one place at a time, and keeps it in sight. */
  function movePane(paneId: string, step: number) {
    const ids = panes.map(({ id }) => id);
    const index = ids.indexOf(paneId);
    const target = index + step;
    if (index < 0 || target < 0 || target >= ids.length) return;
    ids.splice(index, 1);
    ids.splice(target, 0, paneId);
    reorder(ids);
    void tick().then(() => scrollToPane(paneId));
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
        movePane(pane.id, step);
      },
    };
  }

  // Pane status needs events for every agent, including ones scrolled out of view.
  $effect(() => {
    if (!loaded) return;
    for (const { id } of assistantPanes) void statuses.load(id);
  });

  $effect(() => {
    if (!project) pullRequestOpen = false;
  });

  $effect(() => {
    if (!loaded) return;
    const id = project?.id;
    return untrack(() => branch.watch(id));
  });

  // The header's pull request button follows the branch on screen.
  $effect(() => {
    if (!loaded) return;
    const id = branch.head?.branch ? project?.id : undefined;
    void branch.head;
    return untrack(() => pullRequest.watch(id));
  });

  /** Goes to the pane `step` places from the active one, wrapping around the ends. */
  function stepPane(step: number) {
    if (!panes.length) return;
    const index = panes.findIndex(({ id }) => id === activePane?.id);
    void focusPane(panes[(index + step + panes.length) % panes.length].id);
  }

  function cyclePaneSize() {
    if (!activePane) return;
    const sizes = PANE_SIZES.map(({ value }) => value);
    const current = sizeOverrides[activePane.id] ?? defaultPaneSize(stripCount);
    sizeOverrides[activePane.id] =
      sizes[(sizes.indexOf(current) + 1) % sizes.length];
    const { id } = activePane;
    void tick().then(() => scrollToPane(id));
  }

  function togglePullRequest() {
    if (!project || pullRequest.current === undefined) return;
    pullRequestOpen = !pullRequestOpen;
  }

  /** Opens insights on `tab`, or switches to it; pressed again on that tab, closes it. */
  function showInsights(tab: 'tokens' | 'usage') {
    const open = panels.includes('insights');
    if (open && insightsTab === tab) {
      togglePanel('insights');
      return;
    }
    insightsTab = tab;
    if (open) scrollToPanel('insights');
    else togglePanel('insights');
  }

  function runShortcut(id: ShortcutId, event: KeyboardEvent) {
    const digit = digitOf(event) ?? 0;
    switch (id) {
      case 'shortcuts':
      case 'settings':
        togglePanel(id);
        break;
      case 'insights':
        showInsights('tokens');
        break;
      case 'usage':
        showInsights('usage');
        break;
      case 'addProject':
        addProject();
        break;
      case 'switchProject':
        projectMenuOpen = true;
        break;
      case 'openProject': {
        const target = workspace.projects[digit - 1];
        if (target) openProject(target.id);
        break;
      }
      case 'switchBranch':
        if (project && isRepository) branchMenuOpen = true;
        break;
      case 'newBranch':
        newBranch();
        break;
      case 'pullRequest':
        togglePullRequest();
        break;
      case 'newConversation':
        void addPane();
        break;
      case 'newTerminal':
        void addPane('terminal');
        break;
      case 'newFiles':
        void addPane('files');
        break;
      case 'newDiff':
        void addPane('diff');
        break;
      case 'closePane': {
        const target = activePane;
        if (target)
          void runAction(() => window.bonfire.panes.archive(target.id));
        break;
      }
      case 'goToPane':
        if (panes[digit - 1]) void focusPane(panes[digit - 1].id);
        break;
      case 'previousPane':
        stepPane(-1);
        break;
      case 'nextPane':
        stepPane(1);
        break;
      case 'movePaneLeft':
      case 'movePaneRight':
        if (activePane) movePane(activePane.id, id === 'movePaneLeft' ? -1 : 1);
        break;
      case 'resizePane':
        cyclePaneSize();
        break;
      case 'focusComposer':
        if (activePane) void focusPane(activePane.id);
        break;
    }
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.isComposing || onboarding) return;
    const id = matchShortcut(event, isMac(), 'global');
    if (!id) return;
    // Elsewhere the shortcuts are Ctrl chords, which a terminal's programs use.
    if (!isMac() && (event.target as Element).closest?.('.xterm')) return;
    // An open dialog or menu owns the keyboard.
    if (document.querySelector('[role="dialog"], [role="menu"]')) return;
    event.preventDefault();
    event.stopPropagation();
    runShortcut(id, event);
  }

  // Tracks which panes and panels are in view so the rail can mark them.
  $effect(() => {
    // Re-observes as panes and panels come and go.
    void panes.length;
    void panels.length;
    if (!paneStrip) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const { target, isIntersecting } of entries) {
          const { dataset } = target as HTMLElement;
          if (dataset.paneId) inView[dataset.paneId] = isIntersecting;
          else if (dataset.panel)
            panelsInView[dataset.panel as AppPanel] = isIntersecting;
        }
      },
      { root: paneStrip, threshold: 0.5 },
    );
    for (const section of paneStrip.querySelectorAll(
      '[data-pane-id], [data-panel]',
    ))
      observer.observe(section);
    return () => observer.disconnect();
  });

  function handleAssistantEvent(event: AssistantEvent) {
    statuses.handle(event);
    // Agents commit and switch branches too.
    if (event.type === 'status' && event.status === 'idle')
      void branch.reload();
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
      window.bonfire.app.onNotificationsBlocked((appName) =>
        toast(notificationsBlockedMessage(appName), {
          variant: 'error',
          duration: 0,
        }),
      ),
    ];
    return () => {
      clearTimeout(highlightTimer);
      subscriptions.forEach((unsubscribe) => unsubscribe());
    };
  });

  const PROVIDERS: AssistantProvider[] = ['claude', 'codex'];

  /** Reads each provider's account; a check that fails is kept as its error. */
  async function loadAccounts() {
    await Promise.all(
      PROVIDERS.map(async (provider) => {
        try {
          accounts[provider] = await window.bonfire.providers.account(provider);
        } catch (cause) {
          accountErrors[provider] = errorMessage(cause);
        }
      }),
    );
  }

  /**
   * Setup is needed without a project, or when no agent is signed in. If no account
   * could be checked at all, whether one is signed in is unknown, so it isn't asked for.
   */
  function needsOnboarding() {
    if (!workspace.projects.length) return true;
    const checked = PROVIDERS.filter((provider) => accounts[provider]);
    return (
      checked.length > 0 &&
      !checked.some((provider) => accounts[provider]!.signedIn)
    );
  }

  /** Leaves setup for the workspace, starting a conversation with the agent signed in. */
  async function finishOnboarding(
    provider: AssistantProvider,
    created?: Project,
  ) {
    try {
      await refresh();
    } catch (cause) {
      showError(cause);
    }
    onboarding = false;
    if (!created || panes.length) return;
    await tick();
    await addPane(provider);
  }

  onMount(async () => {
    if (!window.bonfire) {
      showError('Launch Bonfire with npm start or npm run dev.');
      loading = false;
      return;
    }
    try {
      await Promise.all([refresh(), loadAccounts()]);
      onboarding = needsOnboarding();
      loaded = true;
    } catch (cause) {
      showError(cause);
    } finally {
      loading = false;
    }
  });
</script>

<svelte:head><title>Bonfire</title></svelte:head>
<svelte:window onkeydowncapture={handleKeydown} />

{#snippet placeholder()}
  {#if !workspace.projects.length}
    <Card.Root
      class="grid h-full place-content-center justify-items-center text-center text-muted-foreground"
    >
      <Icon name="project" class="size-7" />
      <h1 class="mt-6 font-medium text-foreground">Add a project</h1>
      <p class="mb-6">
        Choose a repository on this computer, or on another over SSH, for Claude
        and Codex to work in.
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
      <h1 class="mt-6 font-medium text-foreground">Start a conversation</h1>
      <p class="mb-6 max-w-90 text-pretty">
        {#if branch.head?.branch}
          Conversations work on {branch.head.branch}.
        {:else}
          Conversations work in {project?.name}.
        {/if}
      </p>
      <Button disabled={!loaded || busy} onclick={() => addPane()}>
        New conversation
      </Button>
    </Card.Root>
  {/if}
{/snippet}

{#if loading}
  <div class="flex h-screen flex-col">
    <div class="h-13 shrink-0 app-drag"></div>
    <div
      class="grid flex-1 place-content-center"
      role="status"
      aria-label="Loading"
    >
      <div
        class="size-5 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground motion-reduce:animate-pulse"
      ></div>
    </div>
  </div>
{:else if onboarding}
  <Onboarding
    bind:accounts
    bind:accountErrors
    hasProjects={workspace.projects.length > 0}
    onfinish={(provider, created) => void finishOnboarding(provider, created)}
  />
{:else}
  <div class="flex h-screen">
    <AppRail
      {panels}
      ontogglePanel={togglePanel}
      {trafficLightInset}
      onhelp={() => window.bonfire.navigation.help()}
      onaddPane={addPane}
      panes={panes.map(({ id }) => ({
        id,
        status: statuses.get(id),
        inView: !!inView[id],
      }))}
      {canAddPane}
      onselectPane={scrollToPane}
      {panelsInView}
      onselectPanel={scrollToPanel}
    />
    <div class="flex min-w-0 flex-1 flex-col">
      <AppHeader {trafficLightInset} bind:pullRequestOpen disabled={!project}>
        {#snippet location()}
          <ProjectPicker
            projects={workspace.projects}
            active={project}
            bind:open={projectMenuOpen}
            onselect={openProject}
            onadd={addProject}
            onremove={removeProject}
          />
          {#if project}
            <BranchPicker
              projectId={project.id}
              head={branch.head}
              locked={agentsWorking}
              bind:open={branchMenuOpen}
              onswitch={switchBranch}
              onnew={newBranch}
            />
          {/if}
        {/snippet}
      </AppHeader>

      <div class="flex min-h-0 flex-1">
        <main class="flex min-h-0 min-w-0 flex-1 pr-2 pb-2">
          <div class="min-w-0 flex-1">
            <div
              bind:this={paneStrip}
              onfocusin={trackPane}
              onpointerdowncapture={trackPane}
              class={cn(
                '-mx-1 flex h-full snap-x snap-mandatory overflow-x-auto overscroll-x-contain scrollbar-none',
                drag.active && 'snap-none select-none',
              )}
            >
              {#each panels as panel (panel)}
                <section
                  data-panel={panel}
                  class={cn(
                    SECTION_CLASS,
                    autoSizeClass,
                    HIGHLIGHT_CLASS,
                    highlightedId === panel && HIGHLIGHTED_CLASS,
                  )}
                  in:paneWidth
                  out:paneWidth
                >
                  {#if panel === 'settings'}
                    <SettingsPane />
                  {:else if panel === 'shortcuts'}
                    <ShortcutsPane />
                  {:else}
                    <InsightsPane bind:tab={insightsTab} />
                  {/if}
                </section>
              {/each}
              {#each panes as pane (pane.id)}
                <section
                  data-pane-id={pane.id}
                  class={cn(
                    SECTION_CLASS,
                    paneSizeClass(pane),
                    HIGHLIGHT_CLASS,
                    highlightedId === pane.id && HIGHLIGHTED_CLASS,
                    drag.isDragging(pane.id) &&
                      '*:shadow-2xl *:shadow-black/50',
                  )}
                  style={drag.style(pane.id)}
                >
                  <PaneView
                    {pane}
                    projectId={project!.id}
                    dragHandle={dragHandle(pane)}
                    onclose={() =>
                      runAction(() => window.bonfire.panes.archive(pane.id))}
                    onresize={(size) => (sizeOverrides[pane.id] = size)}
                  />
                </section>
              {:else}
                <section class={cn(SECTION_CLASS, autoSizeClass)}>
                  {@render placeholder()}
                </section>
              {/each}
              {#if project && showPullRequest}
                <section
                  class={cn(
                    SECTION_CLASS,
                    pullRequestSize
                      ? sizeClass(pullRequestSize)
                      : autoSizeClass,
                  )}
                  in:paneWidth
                  out:paneWidth
                  onintroend={() => void revealEdge('end')}
                >
                  <PullRequestView
                    projectId={project.id}
                    onresize={(size) => (pullRequestSize = size)}
                    onclose={() => (pullRequestOpen = false)}
                  />
                </section>
              {/if}
            </div>
          </div>
        </main>
      </div>
    </div>
  </div>
{/if}

{#if project}
  <NewBranchDialog bind:open={creatingBranch} projectId={project.id} />
{/if}
<CreateProjectDialog
  bind:open={creatingProject}
  oncreated={() => void refresh().catch(showError)}
/>
