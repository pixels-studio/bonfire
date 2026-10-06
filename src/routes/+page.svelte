<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import * as Card from '$lib/components/ui/card';
  import CreateProjectDialog from '$lib/components/workspace/create-project-dialog.svelte';
  import Icon from '$lib/components/icon/icon.svelte';
  import InsightsPane from '$lib/components/insights/insights-pane.svelte';
  import LauncherPane from '$lib/components/launcher/launcher-pane.svelte';
  import Overlay from '$lib/components/overlay/overlay.svelte';
  import ProjectSettings from '$lib/components/project-settings/project-settings.svelte';
  import SettingsPane from '$lib/components/settings/settings-pane.svelte';
  import PaneView from '$lib/components/pane-view/pane-view.svelte';
  import PullRequestView from '$lib/components/pull-request/pull-request-view.svelte';
  import ShortcutsPane from '$lib/components/shortcuts/shortcuts-pane.svelte';
  import WorkspaceList, {
    type RailPanel,
  } from '$lib/components/workspace-list/workspace-list.svelte';
  import Onboarding from '$lib/components/onboarding/onboarding.svelte';
  import Bloom from '$lib/components/onboarding/bloom.svelte';
  import { PANE_SIZES, defaultPaneSize, type PaneSize } from '$lib/panes';
  import { digitOf, matchShortcut, type ShortcutId } from '$lib/shortcuts';
  import { assistantEvents } from '$lib/main-events';
  import { PaneDrag } from '$lib/pane-drag.svelte';
  import { StripMotion, leave } from '$lib/strip-motion.svelte';
  import {
    ATTENTION_RANK,
    PaneStatuses,
    paneBadge,
    type PaneStatus,
    type ProjectAttention,
  } from '$lib/pane-status.svelte';
  import { playCompletionSound } from '$lib/sounds';
  import { branch } from '$lib/stores/branch.svelte';
  import { cliVersions } from '$lib/stores/cli-versions.svelte';
  import { fork } from '$lib/stores/fork.svelte';
  import { preferences } from '$lib/stores/preferences.svelte';
  import { pullRequest } from '$lib/stores/pull-request.svelte';
  import { scripts } from '$lib/stores/scripts.svelte';
  import { toast } from '$lib/stores/toast.svelte';
  import { cn, isMac, scrollBehavior } from '$lib/utils';
  import type { HTMLButtonAttributes } from 'svelte/elements';
  import type {
    AssistantEvent,
    AssistantProvider,
    ProviderAccount,
    Pane,
    PaneType,
    PanesClosedEvent,
    State,
  } from '$shared/contracts';
  import {
    MAX_PANES,
    MAX_TERMINAL_PANES,
    currentWorkspaceOf,
    emptyState,
    errorMessage,
    isAssistantPane,
    isReopenable,
    isViewPaneType,
    reorderLayout,
    startingProvider,
    workspaceLabel,
    type ViewPaneType,
  } from '$shared/domain';

  /** What opens over the workspace: a rail panel, or the project's settings. */
  type OverlayPanel = RailPanel | 'project';

  let appState = $state<State>(emptyState());
  let loaded = $state(false);
  let loading = $state(true);
  let busy = $state(false);
  let paneStrip = $state<HTMLDivElement>();
  const statuses = new PaneStatuses();
  let inView = $state<Record<string, boolean>>({});
  let sizeOverrides = $state<Record<string, PaneSize>>({});
  let pullRequestSize = $state<PaneSize>();
  const drag = new PaneDrag(
    () => paneStrip,
    (ids) => reorderStrip(ids),
  );
  const motion = new StripMotion(() => paneStrip);
  /** Whether the pull request pane is open, which the diff pane's git actions toggle. */
  const pullRequestOpen = $derived(pullRequest.paneOpen);
  let overlay = $state<OverlayPanel>();
  /**
   * The strip's order after panes are arranged by hand, or one is put at the end. Unlisted
   * panes then go in front, except view panes, which go at the end.
   */
  let stripOrder = $state<string[]>([]);
  /**
   * Set while panes are added or closed by hand, so only those grow in or shrink
   * away; panes that come and go on load or a workspace switch do so at once.
   */
  let paneMotion = $state(false);
  let creatingProject = $state(false);
  let creatingWorkspace = $state(false);
  let projectMenuOpen = $state(false);
  /** The tab the insights panel is on, which the usage shortcut switches. */
  let insightsTab = $state('tokens');
  /** The pane last clicked, focused or navigated to, which the pane shortcuts act on. */
  let currentPaneId = $state<string>();
  /** The latest file card navigation into the code diff pane. */
  let selectedDiff = $state<{
    workspaceId: string;
    path: string;
    request: number;
  }>();
  let diffRequest = 0;
  /** Whether setup is on screen instead of the workspace: no agent signed in, or no project. */
  let onboarding = $state(false);
  /** Carries the app in from setup on a bloom of light. */
  let bloom = $state<Bloom>();
  let accounts = $state<Partial<Record<AssistantProvider, ProviderAccount>>>(
    {},
  );
  let accountErrors = $state<Partial<Record<AssistantProvider, string>>>({});

  const project = $derived(
    appState.projects.find(({ id }) => id === appState.lastProjectId),
  );
  const projectWorkspaces = $derived(
    appState.workspaces.filter(({ projectId }) => projectId === project?.id),
  );
  /** The workspace on screen. */
  const current = $derived(
    project ? currentWorkspaceOf(appState, project) : undefined,
  );
  /**
   * Every refresh replaces the state's objects, so anything that should restart only when
   * another workspace opens follows its id instead.
   */
  const workspaceId = $derived(current?.id);
  /** An archived workspace has no folder to work in until it is unarchived. */
  const archived = $derived(current?.status === 'archived');
  /** A workspace that can be worked in: its folder is there. */
  const activeId = $derived(archived ? undefined : workspaceId);

  /** The open panes of the workspace on screen, agents and tools alike, in layout order. */
  const panes = $derived(
    appState.layout.paneIds
      .map((id) => appState.panes.find((pane) => pane.id === id))
      .filter(
        (pane): pane is Pane =>
          !!pane && !pane.archived && pane.workspaceId === activeId,
      ),
  );
  /** The open view panes, which the header's toggles show as pressed. */
  const views = $derived(panes.filter((pane) => isViewPaneType(pane.type)));
  const openViews = $derived(
    views.map(({ type }) => type).filter(isViewPaneType),
  );
  const PULL_REQUEST_ID = 'pull-request';
  /** Every open pane, in the order the strip shows them. */
  const stripIds = $derived.by(() => {
    const visible = panes.map(({ id }) => id);
    if (!stripOrder.length) return visible;
    const shown = new Set(visible);
    const listed = new Set(stripOrder);
    const unlisted = visible.filter((id) => !listed.has(id));
    const isView = (id: string) => views.some((pane) => pane.id === id);
    return [
      ...unlisted.filter((id) => !isView(id)),
      ...stripOrder.filter((id) => shown.has(id)),
      ...unlisted.filter(isView),
    ];
  });
  /** How many closed panes the history lists. */
  const HISTORY_LIMIT = 30;
  /** The workspace's closed panes, most recently closed first; those from before closing was timed last. */
  const closedPanes = $derived(
    appState.panes
      .filter((pane) => pane.workspaceId === activeId && isReopenable(pane))
      .sort((a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0))
      .slice(0, HISTORY_LIMIT),
  );
  /** The pane the pane shortcuts act on: the current one, else the first in sight. */
  const activePane = $derived(
    panes.find(({ id }) => id === currentPaneId) ??
      panes.find(({ id }) => inView[id]) ??
      panes[0],
  );

  /** The pull request pane, shown after the panes. */
  const showPullRequest = $derived(!!activeId && pullRequestOpen);
  /** What shares the strip with the launcher: the panes and the pull request. */
  const stripCount = $derived(panes.length + (showPullRequest ? 1 : 0));

  const canAddPane = $derived(!!activeId && panes.length < MAX_PANES);
  /** Terminals stop at the number that can draw with WebGL; the launcher then leaves them out. */
  const canAddTerminal = $derived(
    canAddPane &&
      panes.filter((pane) => pane.type === 'terminal').length <
        MAX_TERMINAL_PANES,
  );

  const SECTION_CLASS = 'h-full shrink-0 snap-start px-1';

  function showError(cause: unknown) {
    toast(errorMessage(cause), { variant: 'error', duration: 0 });
  }

  async function refresh() {
    appState = await window.bonfire.state.get();
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

  /** Runs a change to the panes made by hand, so the panes it opens or closes animate. */
  async function changePanes(task: () => Promise<unknown>) {
    paneMotion = true;
    try {
      await runAction(task);
      await tick();
    } finally {
      paneMotion = false;
    }
  }

  function closePane(paneId: string) {
    if (panes.some((pane) => pane.id === paneId && pane.type === 'diff'))
      selectedDiff = undefined;
    return changePanes(() => window.bonfire.panes.archive(paneId));
  }

  /** Reopens a closed pane where a new one of its kind would open, and goes to it. */
  async function restorePane(paneId: string) {
    const closed = appState.panes.find(({ id }) => id === paneId);
    if (busy || !closed) return;
    const view = isViewPaneType(closed.type);
    await changePanes(() => window.bonfire.panes.restore(paneId));
    // A view pane of a kind already open isn't reopened; the open one is gone to instead.
    const shown = panes.find(
      (pane) => pane.id === paneId || (view && pane.type === closed.type),
    );
    if (!shown) return;
    if (!view) paneStrip?.scrollTo({ left: 0, behavior: scrollBehavior() });
    void focusPane(shown.id);
  }

  function addProject() {
    creatingProject = true;
  }

  function removeProject(projectId: string) {
    void runAction(() => window.bonfire.projects.remove(projectId));
  }

  /** Looking at panes is seeing what their agents finished. */
  function markSeen(matches: (pane: Pane) => boolean) {
    for (const pane of appState.panes)
      if (matches(pane)) statuses.markSeen(pane.id);
  }

  function openProject(projectId: string) {
    if (projectId === project?.id) return;
    const next = appState.projects.find(({ id }) => id === projectId);
    const shown = next && currentWorkspaceOf(appState, next)?.id;
    markSeen((pane) => pane.workspaceId === shown);
    void runAction(() => window.bonfire.projects.open(projectId));
  }

  function openWorkspace(id: string) {
    overlay = undefined;
    if (id === workspaceId) return;
    markSeen((pane) => pane.workspaceId === id);
    return runAction(() => window.bonfire.workspaces.open(id));
  }

  /** Makes a workspace and starts a conversation in it, as that is what one is for. */
  async function createWorkspace() {
    if (!project || creatingWorkspace) return;
    creatingWorkspace = true;
    overlay = undefined;
    try {
      await window.bonfire.workspaces.create(project.id);
      await refresh();
      await addPane();
    } catch (cause) {
      showError(cause);
      // A setup script that failed to start leaves the workspace made all the same.
      await refresh().catch(() => {});
    } finally {
      creatingWorkspace = false;
    }
  }

  /**
   * Opens a pane at the front of the strip; an agent with the last-used provider by
   * default. A view pane opens at the end instead, or, if it is open, is brought into sight.
   */
  async function addPane(type?: PaneType, other = false) {
    if (busy) return;
    if (!project) {
      addProject();
      return;
    }
    if (!activeId) return;
    const view = !!type && isViewPaneType(type);
    const open = view && panes.find((pane) => pane.type === type);
    if (open) {
      void focusPane(open.id);
      return;
    }
    if (!canAddPane) {
      toast(`A workspace can have up to ${MAX_PANES} panes open.`);
      return;
    }
    if (type === 'terminal' && !canAddTerminal) {
      toast(
        `A workspace can have up to ${MAX_TERMINAL_PANES} terminal panes open.`,
      );
      return;
    }
    const count = panes.length;
    await changePanes(() => window.bonfire.panes.add(type, other));
    const added = view ? panes.find((pane) => pane.type === type) : panes[0];
    if (!view) paneStrip?.scrollTo({ left: 0, behavior: scrollBehavior() });
    if (panes.length > count && added) void focusPane(added.id);
  }

  /** Opens a view pane at the end of the strip, or closes it if it is open. */
  function toggleView(type: ViewPaneType) {
    const open = panes.find((pane) => pane.type === type);
    if (open) void closePane(open.id);
    else void addPane(type);
  }

  /** Opens the diff pane and asks it to show a file, or the list for a summary click. */
  function viewChanges(path?: string) {
    if (activeId)
      selectedDiff = {
        workspaceId: activeId,
        path: path ?? '',
        request: ++diffRequest,
      };
    void addPane('diff');
  }

  function sizeClass(size: PaneSize) {
    return PANE_SIZES.find(({ value }) => value === size)?.class;
  }

  /** The size of anything in the strip that hasn't been resized. */
  const autoSize = $derived(defaultPaneSize(stripCount));
  const autoSizeClass = $derived(sizeClass(autoSize));

  function paneSize(id: string): PaneSize {
    return sizeOverrides[id] ?? autoSize;
  }

  /** Everything that sets the strip's layout; a change to it is animated. */
  const stripLayout = $derived(
    JSON.stringify([
      stripIds.map((id) => [id, sizeOverrides[id] ?? autoSize]),
      showPullRequest && (pullRequestSize ?? autoSize),
    ]),
  );

  $effect.pre(() => {
    void stripLayout;
    untrack(() => motion.measure());
  });

  $effect(() => {
    void stripLayout;
    untrack(() => motion.play((id) => paneMotion || id === PULL_REQUEST_ID));
  });

  /** Brings the end of the strip into sight, where an opened view or pull request goes. */
  async function revealEnd() {
    await tick();
    paneStrip?.scrollTo({
      left: paneStrip.scrollWidth,
      behavior: scrollBehavior(),
    });
  }

  const HIGHLIGHT_MS = 1200;
  /**
   * An inset overlay: the strip clips anything drawn outside the card. It sits
   * above sticky content, like the file search, which would otherwise cover it.
   */
  const HIGHLIGHT_CLASS =
    'relative after:pointer-events-none after:absolute after:z-20 after:inset-x-1 after:inset-y-0 after:rounded-lg after:opacity-0 after:ring-2 after:ring-brand after:transition-opacity after:duration-500 after:ease-out after:ring-inset motion-reduce:after:transition-none';
  const HIGHLIGHTED_CLASS = 'after:opacity-100 after:duration-150';
  /** The pane just scrolled to, outlined briefly so it's found at a glance. */
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
  async function scrollToPane(paneId: string) {
    currentPaneId = paneId;
    statuses.markSeen(paneId);
    // A pane still growing in is narrower than it will be, so the strip can't
    // scroll to it yet; measure once the layout has settled.
    await Promise.allSettled(
      (
        paneStrip?.querySelectorAll<HTMLElement>(':scope > [data-strip-id]') ??
        []
      )
        .values()
        .flatMap((node) => node.getAnimations().map((a) => a.finished)),
    );
    const section = paneStrip?.querySelector<HTMLElement>(
      `[data-pane-id="${CSS.escape(paneId)}"]`,
    );
    if (!paneStrip || !section) return;
    highlight(paneId);
    const offset =
      section.getBoundingClientRect().left -
      paneStrip.getBoundingClientRect().left;
    paneStrip.scrollTo({
      left: paneStrip.scrollLeft + offset,
      behavior: scrollBehavior(),
    });
  }

  /** Scrolls to a pane and puts the cursor in it, in its message box, search or terminal. */
  async function focusPane(paneId: string) {
    await scrollToPane(paneId);
    paneStrip
      ?.querySelector<HTMLElement>(
        `[data-pane-id="${CSS.escape(paneId)}"] :is(textarea, input[type="search"], [contenteditable="true"])`,
      )
      ?.focus({ preventScroll: true });
  }

  /** Goes to a pane wherever it is, opening its workspace first, such as from a notification. */
  async function goToPane(paneId: string) {
    const pane = appState.panes.find(({ id }) => id === paneId);
    if (pane?.workspaceId && pane.workspaceId !== workspaceId) {
      await openWorkspace(pane.workspaceId);
      await tick();
    }
    overlay = undefined;
    void scrollToPane(paneId);
  }

  /** Remembers the pane that was clicked or focused. */
  function trackPane(event: Event) {
    const paneId = (event.target as Element).closest<HTMLElement>(
      '[data-pane-id]',
    )?.dataset.paneId;
    if (!paneId) return;
    currentPaneId = paneId;
    statuses.markSeen(paneId);
  }

  /** Whether the user is in a pane right now: the window has focus and so does something in it. */
  function isPaneFocused(paneId: string) {
    return (
      document.hasFocus() &&
      document.activeElement?.closest<HTMLElement>('[data-pane-id]')?.dataset
        .paneId === paneId
    );
  }

  function toggleOverlay(panel: OverlayPanel) {
    overlay = overlay === panel ? undefined : panel;
  }

  /** Applies a new visible pane order locally, then saves it. */
  function reorder(ids: string[]) {
    appState.layout.paneIds = reorderLayout(appState.layout.paneIds, ids);
    void runAction(() => window.bonfire.panes.reorder(ids));
  }

  /** Moves a pane along the strip, one place at a time, and keeps it in sight. */
  function moveItem(id: string, step: number) {
    const ids = [...stripIds];
    const index = ids.indexOf(id);
    const target = index + step;
    if (index < 0 || target < 0 || target >= ids.length) return;
    ids.splice(index, 1);
    ids.splice(target, 0, id);
    reorderStrip(ids);
    void tick().then(() => scrollToPane(id));
  }

  /** The grip of a pane: drags it, or moves it with the arrow keys. */
  function gripOf(id: string): HTMLButtonAttributes {
    return {
      onpointerdown: (event) => drag.start(event, id, stripIds),
      onkeydown(event) {
        const step = { ArrowLeft: -1, ArrowRight: 1 }[event.key];
        if (!step || drag.active) return;
        event.preventDefault();
        moveItem(id, step);
      },
    };
  }

  /** Applies a new strip order, which is saved. */
  function reorderStrip(ids: string[]) {
    stripOrder = ids;
    if (ids.length > 1) reorder(ids);
  }

  /** Puts a pane last in the strip, as panes opened by the header's actions go. */
  function placeLast(paneId: string) {
    stripOrder = [...stripIds.filter((id) => id !== paneId), paneId];
  }

  // Pane status needs events for every agent, including ones scrolled out of view and
  // ones in other workspaces, which the workspace list and project picker flag.
  $effect(() => {
    if (!loaded) return;
    for (const pane of appState.panes)
      if (!pane.archived && isAssistantPane(pane)) void statuses.load(pane.id);
  });

  /** How much each status asks of the user; a workspace shows its agents' most pressing. */
  const ACTIVITY_RANK: Record<PaneStatus, number> = {
    idle: 0,
    done: 1,
    working: 2,
    error: 3,
    input: 4,
  };

  /** What each of the project's workspaces' agents are doing, most pressing first. */
  const workspaceActivity = $derived.by(() => {
    const activity: Record<string, PaneStatus> = {};
    for (const pane of appState.panes) {
      if (pane.archived || !isAssistantPane(pane) || !pane.workspaceId)
        continue;
      if (pane.projectId !== project?.id) continue;
      const status = statuses.get(pane.id);
      const known = activity[pane.workspaceId] ?? 'idle';
      if (ACTIVITY_RANK[status] > ACTIVITY_RANK[known])
        activity[pane.workspaceId] = status;
    }
    return activity;
  });

  /** What needs the user in each project other than the open one: the most urgent state wins. */
  const projectAttention = $derived.by(() => {
    const attention: Record<string, ProjectAttention> = {};
    for (const pane of appState.panes) {
      if (pane.archived || !isAssistantPane(pane)) continue;
      const owner = pane.projectId;
      if (!owner || owner === project?.id) continue;
      const status = paneBadge(statuses.get(pane.id));
      if (!status) continue;
      const known = attention[owner];
      if (!known || ATTENTION_RANK[status] > ATTENTION_RANK[known])
        attention[owner] = status;
    }
    return attention;
  });

  // A workspace's strip arrangement and pull request are its own.
  $effect(() => {
    void workspaceId;
    untrack(() => {
      pullRequest.paneOpen = false;
      stripOrder = [];
    });
  });

  // The pull request opens at the end of the strip, which is brought into sight.
  $effect(() => {
    if (showPullRequest) untrack(() => void revealEnd());
  });

  $effect(() => {
    if (!loaded) return;
    const id = activeId;
    return untrack(() => branch.watch(id));
  });

  // The header's pull request button follows the branch on screen.
  $effect(() => {
    if (!loaded) return;
    const id = branch.head?.branch ? activeId : undefined;
    void branch.head;
    return untrack(() => pullRequest.watch(id));
  });

  $effect(() => {
    if (!loaded) return;
    const id = activeId;
    const projectId = project?.id;
    return untrack(() =>
      scripts.watch(id && projectId ? { id, projectId } : undefined),
    );
  });

  // A script runs in its own terminal pane at the end of the strip, brought on screen.
  $effect(() => {
    scripts.onPane = async (paneId) => {
      const opened = !panes.some((pane) => pane.id === paneId);
      await refresh();
      if (opened) placeLast(paneId);
      await tick();
      void scrollToPane(paneId);
    };
    scripts.onPanesChanged = refresh;
    return () => {
      scripts.onPane = undefined;
      scripts.onPanesChanged = undefined;
    };
  });

  // A header action runs in an agent pane at the end of the strip.
  $effect(() => {
    pullRequest.onAgentPane = async (paneId) => {
      await refresh();
      placeLast(paneId);
      await tick();
      void focusPane(paneId);
    };
    pullRequest.onMerged = refresh;
    return () => {
      pullRequest.onAgentPane = undefined;
      pullRequest.onMerged = undefined;
    };
  });

  // A fork opens its summary in a new pane, which is brought on screen.
  $effect(() => {
    fork.onForked = async (paneId) => {
      await refresh();
      await tick();
      paneStrip?.scrollTo({ left: 0, behavior: scrollBehavior() });
      void focusPane(paneId);
    };
    return () => (fork.onForked = undefined);
  });

  // Closing the agent's pane ends the action it was carrying out.
  // `agentPaneId` is set before the pane list has refreshed, so only a pane seen and then
  // gone counts as closed; otherwise the action would end the moment it began.
  let agentPaneSeen = false;
  $effect(() => {
    const id = pullRequest.agentPaneId;
    if (!id) {
      agentPaneSeen = false;
      return;
    }
    if (panes.some((pane) => pane.id === id)) agentPaneSeen = true;
    else if (agentPaneSeen) pullRequest.settle(id);
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
    const size = paneSize(activePane.id);
    sizeOverrides[activePane.id] =
      sizes[(sizes.indexOf(size) + 1) % sizes.length];
    const { id } = activePane;
    void tick().then(() => scrollToPane(id));
  }

  function togglePullRequest() {
    if (!activeId || pullRequest.current === undefined) return;
    if (pullRequest.pushable) {
      void pullRequest.run('push');
      return;
    }
    if (
      pullRequest.current === null ||
      pullRequest.current.state === 'closed'
    ) {
      void pullRequest.run('createPr');
      return;
    }
    pullRequest.paneOpen = !pullRequest.paneOpen;
  }

  /** Opens insights on `tab`, or switches to it; pressed again on that tab, closes it. */
  function showInsights(tab: 'tokens' | 'usage') {
    if (overlay === 'insights' && insightsTab === tab) {
      overlay = undefined;
      return;
    }
    insightsTab = tab;
    overlay = 'insights';
  }

  function runShortcut(id: ShortcutId, event: KeyboardEvent) {
    const digit = digitOf(event) ?? 0;
    switch (id) {
      case 'shortcuts':
      case 'settings':
        toggleOverlay(id);
        break;
      case 'insights':
        showInsights('tokens');
        break;
      case 'addProject':
        addProject();
        break;
      case 'switchProject':
        projectMenuOpen = true;
        break;
      case 'newWorkspace':
        void createWorkspace();
        break;
      case 'pullRequest':
        togglePullRequest();
        break;
      case 'newConversation':
        void addPane();
        break;
      case 'newOtherAgent':
        void addPane(undefined, true);
        break;
      case 'newTerminal':
        void addPane('terminal');
        break;
      case 'newFiles':
        toggleView('files');
        break;
      case 'newDiff':
        toggleView('diff');
        break;
      case 'newBrowser':
        toggleView('browser');
        break;
      case 'reopenPane':
        if (closedPanes[0]) void restorePane(closedPanes[0].id);
        break;
      case 'closePane': {
        const target = activePane;
        if (target) void closePane(target.id);
        break;
      }
      case 'goToPane':
        if (panes[digit - 1]) void focusPane(panes[digit - 1].id);
        break;
      case 'goToFarPane':
        // Panes 10 to 18 sit on the same digits, with ⇧ held.
        if (panes[digit + 8]) void focusPane(panes[digit + 8].id);
        break;
      case 'run':
        scripts.toggle();
        break;
      case 'previousPane':
        stepPane(-1);
        break;
      case 'nextPane':
        stepPane(1);
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

  // Tracks which panes are in view, so the pane shortcuts act on one in sight.
  $effect(() => {
    // Re-observes as panes come and go.
    void panes.length;
    if (!paneStrip) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const { target, isIntersecting } of entries) {
          const { dataset } = target as HTMLElement;
          if (dataset.paneId) inView[dataset.paneId] = isIntersecting;
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
    // A turn that finishes in the pane the user is in needs no reminder.
    if (
      event.type === 'status' &&
      event.status === 'completed' &&
      isPaneFocused(event.paneId)
    )
      statuses.markSeen(event.paneId);
    // The header's action stays busy until its agent has finished.
    if (
      event.type === 'status' &&
      ['idle', 'completed', 'failed'].includes(event.status)
    )
      pullRequest.settle(event.paneId);
    // Agents commit, push, open pull requests, and switch branches too; in a remote folder
    // the end of a turn is the only word of it.
    if (event.type === 'status' && event.status === 'idle') {
      void branch.reload();
      void pullRequest.reload();
    }
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
    const titles = appState.panes
      .filter(({ id }) => paneIds.includes(id))
      .map(({ title }) => `“${title}”`);
    await refresh();
    const why = 'pull request was merged';
    toast(
      titles.length === 1
        ? `Closed ${titles[0]}: its ${why}.`
        : `Closed ${titles.length} panes after the ${why}.`,
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
      assistantEvents.onAll(handleAssistantEvent),
      // A clicked notification brings its pane into view.
      window.bonfire.app.onFocusPane((paneId) => void goToPane(paneId)),
      window.bonfire.panes.onClosed((event) => void handlePanesClosed(event)),
      window.bonfire.workspaces.onChange(() => void refresh().catch(showError)),
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
    if (!appState.projects.length) return true;
    const checked = PROVIDERS.filter((provider) => accounts[provider]);
    return (
      checked.length > 0 &&
      !checked.some((provider) => accounts[provider]!.signedIn)
    );
  }

  /** Leaves setup for the workspace. */
  async function finishOnboarding() {
    const ready = (async () => {
      try {
        await refresh();
      } catch (cause) {
        showError(cause);
      }
      // Setup may have just signed an agent in.
      await loadAccounts();
    })();
    // The workspace swaps in behind the light at its peak, then emerges as it clears.
    await Promise.all([ready, bloom?.out()]);
    onboarding = false;
    await tick();
    await bloom?.reveal();
  }

  // The open project's machine runs its own agent CLIs, so they're checked as projects change.
  $effect(() => {
    if (!loaded) return;
    void project?.id;
    void preferences.current.providers.claude;
    void preferences.current.providers.codex;
    void cliVersions.refresh();
  });

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

  const launcherSubtitle = $derived.by(() => {
    if (!current) return '';
    return `Agents and terminals work on ${current.branch}, apart from your other workspaces.`;
  });
</script>

<svelte:head><title>Bonfire</title></svelte:head>
<!-- The CLIs update themselves in the background; the backend's cached answer keeps focus cheap. -->
<svelte:window
  onkeydowncapture={handleKeydown}
  onfocus={() => loaded && void cliVersions.refresh()}
/>

{#snippet launcher()}
  <section
    data-strip-id="launcher"
    class={cn(SECTION_CLASS, stripCount ? 'basis-1/3 min-w-90' : 'basis-full')}
  >
    {#if !project}
      <Card.Root
        class="grid h-full place-content-center justify-items-center text-center text-muted-foreground"
      >
        <Icon name="project" class="size-7" />
        <h1 class="mt-6 font-medium text-foreground">Add a project</h1>
        <p class="mb-6">
          Choose a repository on this computer, or on another over SSH, for
          Claude and Codex to work in.
        </p>
        <Button disabled={!loaded || busy} onclick={addProject}>
          Add project
        </Button>
      </Card.Root>
    {:else if !current}
      <Card.Root
        class="grid h-full place-content-center justify-items-center px-6 text-center text-muted-foreground"
      >
        <h1 class="font-medium text-foreground">No workspace yet</h1>
        <p class="mt-1 mb-6 max-w-80 text-sm text-pretty">
          Each workspace is its own branch and folder, so agents work apart from
          each other.
        </p>
        <Button
          disabled={busy || creatingWorkspace}
          loading={creatingWorkspace}
          onclick={() => void createWorkspace()}
        >
          New workspace
        </Button>
      </Card.Root>
    {:else if archived && current}
      <Card.Root
        class="grid h-full place-content-center justify-items-center px-6 text-center text-muted-foreground"
      >
        <h1 class="font-medium text-foreground">
          {workspaceLabel(current)} is archived
        </h1>
        <p class="mt-1 mb-6 max-w-80 text-sm text-pretty">
          Its folder is gone, but its branch {current.branch} and its uncommitted
          work are kept.
        </p>
        <Button
          disabled={busy}
          onclick={() =>
            void runAction(() =>
              window.bonfire.workspaces.unarchive(current.id),
            )}
        >
          Unarchive
        </Button>
      </Card.Root>
    {:else}
      <LauncherPane
        title="Start something new"
        subtitle={launcherSubtitle}
        providers={preferences.enabledProviders}
        startingProvider={startingProvider(
          preferences.current,
          appState.settings.lastProvider,
        )}
        {canAddTerminal}
        disabled={!canAddPane || busy}
        {openViews}
        {closedPanes}
        onadd={(type) => void addPane(type)}
        onrestore={(id) => void restorePane(id)}
      />
    {/if}
  </section>
{/snippet}

<Bloom bind:this={bloom}>
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
      hasProjects={appState.projects.length > 0}
      onfinish={() => void finishOnboarding()}
    />
  {:else}
    <div class="flex h-screen">
      <div class="relative flex min-w-0 flex-1">
        <div class="flex min-w-0 flex-1" inert={!!overlay}>
          <WorkspaceList
            projects={appState.projects}
            {project}
            attention={projectAttention}
            bind:projectMenuOpen
            workspaces={projectWorkspaces}
            currentId={workspaceId}
            activity={workspaceActivity}
            creating={creatingWorkspace}
            settingsOpen={overlay === 'project'}
            {trafficLightInset}
            panel={overlay === 'project' ? undefined : overlay}
            onpanel={toggleOverlay}
            onhelp={() => window.bonfire.navigation.help()}
            onselectProject={openProject}
            onaddProject={addProject}
            onremoveProject={removeProject}
            onsettings={() => toggleOverlay('project')}
            oncreate={() => void createWorkspace()}
            onopen={(id) => void openWorkspace(id)}
            onrename={(id, title) =>
              void runAction(() => window.bonfire.workspaces.rename(id, title))}
            onarchive={(id) =>
              void runAction(() => window.bonfire.workspaces.archive(id))}
            onunarchive={(id) =>
              void runAction(() => window.bonfire.workspaces.unarchive(id))}
            ondelete={(id) =>
              void runAction(() => window.bonfire.workspaces.remove(id))}
          />
          <div class="flex min-w-0 flex-1 flex-col">
            <main class="flex min-h-0 min-w-0 flex-1 py-2 pr-2">
              <div class="min-w-0 flex-1">
                <div
                  bind:this={paneStrip}
                  onfocusin={trackPane}
                  onpointerdowncapture={trackPane}
                  class={cn(
                    '-mx-1 flex h-full snap-x snap-mandatory overflow-x-auto overflow-y-hidden overscroll-x-contain scrollbar-none',
                    drag.active && 'select-none',
                    (drag.active || motion.active) && 'snap-none',
                  )}
                >
                  {#each stripIds as id (id)}
                    {@const pane = panes.find((pane) => pane.id === id)!}
                    <!-- The section sits right in the `#each`: an `out:` only plays when its own block goes. -->
                    <section
                      data-pane-id={pane.id}
                      data-strip-id={id}
                      class={cn(
                        SECTION_CLASS,
                        sizeOverrides[id]
                          ? sizeClass(sizeOverrides[id])
                          : autoSizeClass,
                        HIGHLIGHT_CLASS,
                        highlightedId === id && HIGHLIGHTED_CLASS,
                        drag.isDragging(id) && '*:shadow-2xl *:shadow-black/50',
                      )}
                      style={drag.style(id)}
                      out:leave={{ animate: paneMotion }}
                    >
                      <PaneView
                        {pane}
                        workspaceId={pane.workspaceId!}
                        badge={paneBadge(statuses.get(pane.id))}
                        onviewChanges={viewChanges}
                        selectedDiff={selectedDiff?.workspaceId ===
                        pane.workspaceId
                          ? selectedDiff
                          : undefined}
                        dragHandle={gripOf(pane.id)}
                        size={paneSize(pane.id)}
                        onclose={() => closePane(pane.id)}
                        onresize={(size) => (sizeOverrides[pane.id] = size)}
                        onrename={(title) => {
                          pane.title = title;
                          void runAction(() =>
                            window.bonfire.panes.rename(pane.id, title),
                          );
                        }}
                        onnavigate={(url) => {
                          if (pane.url === url) return;
                          pane.url = url;
                          window.bonfire.panes
                            .navigate(pane.id, url)
                            .catch(showError);
                        }}
                      />
                    </section>
                  {/each}
                  {#if activeId && showPullRequest}
                    <section
                      data-strip-id={PULL_REQUEST_ID}
                      class={cn(
                        SECTION_CLASS,
                        pullRequestSize
                          ? sizeClass(pullRequestSize)
                          : autoSizeClass,
                      )}
                      out:leave
                    >
                      <PullRequestView
                        workspaceId={activeId}
                        size={pullRequestSize ?? autoSize}
                        onresize={(size) => (pullRequestSize = size)}
                        onclose={() => (pullRequest.paneOpen = false)}
                      />
                    </section>
                  {/if}
                  {@render launcher()}
                </div>
              </div>
            </main>
          </div>
        </div>

        {#if overlay === 'settings'}
          <Overlay label="Settings" onclose={() => (overlay = undefined)}>
            <SettingsPane onclose={() => (overlay = undefined)} />
          </Overlay>
        {:else if overlay === 'shortcuts'}
          <Overlay
            label="Keyboard shortcuts"
            onclose={() => (overlay = undefined)}
          >
            <ShortcutsPane onclose={() => (overlay = undefined)} />
          </Overlay>
        {:else if overlay === 'insights'}
          <Overlay label="Insights" onclose={() => (overlay = undefined)}>
            <InsightsPane
              bind:tab={insightsTab}
              onclose={() => (overlay = undefined)}
            />
          </Overlay>
        {:else if overlay === 'project' && project}
          <Overlay
            label={`${project.name} settings`}
            onclose={() => (overlay = undefined)}
          >
            <ProjectSettings
              {project}
              onsaved={() => void refresh().catch(showError)}
              onclose={() => (overlay = undefined)}
            />
          </Overlay>
        {/if}
      </div>
    </div>
  {/if}
</Bloom>

<CreateProjectDialog
  bind:open={creatingProject}
  oncreated={() => void refresh().catch(showError)}
/>
