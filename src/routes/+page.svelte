<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import * as Card from '$lib/components/ui/card';
  import ActivityPane from '$lib/components/activity/activity-pane.svelte';
  import AppHeader from '$lib/components/app-header/app-header.svelte';
  import AppRail, {
    type AppPanel,
  } from '$lib/components/app-rail/app-rail.svelte';
  import Logo from '$lib/components/logo/logo.svelte';
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
    Project,
    ProviderAccount,
    Pane,
    PaneType,
    PanesClosedEvent,
    State,
  } from '$shared/contracts';
  import {
    MAX_PANES,
    MAX_TERMINAL_PANES,
    emptyState,
    errorMessage,
    isAssistantPane,
    isViewPaneType,
    reorderLayout,
    startingProvider,
    type ViewPaneType,
  } from '$shared/domain';

  let workspace = $state<State>(emptyState());
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
  let pullRequestOpen = $state(false);
  /** The open panels, newest first; Activity is placed at the strip's end. */
  let panels = $state<AppPanel[]>([]);
  /**
   * The strip's order after panes or panels are arranged by hand. Unlisted items
   * then go in front, except view panes, which go at the end.
   */
  let stripOrder = $state<string[]>([]);
  let creatingBranch = $state(false);
  /**
   * Set while panes are added or closed by hand, so only those grow in or shrink
   * away; panes that come and go on load or a project switch do so at once.
   */
  let paneMotion = $state(false);
  /** Whether the pointer is over the empty state's flame, which lights it. */
  let stirred = $state(false);
  let creatingProject = $state(false);
  let projectMenuOpen = $state(false);
  let branchMenuOpen = $state(false);
  /** The tab the insights panel is on, which the usage shortcut switches. */
  let insightsTab = $state('tokens');
  /** The pane last clicked, focused or navigated to, which the pane shortcuts act on. */
  let currentPaneId = $state<string>();
  /** The latest file card navigation into the code diff pane. */
  let selectedDiff = $state<{
    projectId: string;
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
    workspace.projects.find(({ id }) => id === workspace.lastProjectId),
  );
  /**
   * Every refresh replaces the project object, so anything that should restart only when
   * another project opens follows this instead.
   */
  const projectId = $derived(project?.id);
  /** The open panes of the project on screen, agents and tools alike, in layout order. */
  const panes = $derived(
    workspace.layout.paneIds
      .map((id) => workspace.panes.find((pane) => pane.id === id))
      .filter(
        (pane): pane is Pane =>
          !!pane && !pane.archived && pane.projectId === project?.id,
      ),
  );
  /** How many closed conversations the rail lists to reopen. */
  const CLOSED_LISTED = 15;
  /**
   * The branch closed conversations are listed for: the one checked out, `null` in a folder
   * that isn't a repository, where every one is listed, or `undefined` while the head is
   * being looked up or is detached, where none are.
   */
  const closedBranch = $derived(
    !branch.head ? undefined : branch.head.isGit ? branch.head.branch : null,
  );
  /**
   * The closed agent panes of the project and branch on screen, latest first. Tool panes
   * are left out: a terminal's shell ended as it closed, and the others have nothing to
   * restore. A pane belongs to the branch checked out as it closed; one closed before that
   * was kept, to the branch its last turn ran on.
   */
  const closedPanes = $derived(
    workspace.panes
      .filter(
        (pane) =>
          pane.archived &&
          pane.projectId === project?.id &&
          isAssistantPane(pane) &&
          closedBranch !== undefined &&
          (closedBranch === null ||
            (pane.closedBranch ?? pane.workBranch?.name) === closedBranch),
      )
      // Panes closed before the time was kept go last, in the order they were made.
      .sort((a, b) => (b.archivedAt ?? 0) - (a.archivedAt ?? 0))
      .slice(0, CLOSED_LISTED)
      .map(({ id, title, type, archivedAt }) => ({
        id,
        title,
        type: type as AssistantProvider,
        archivedAt,
      })),
  );
  /** The open view panes, which the header's toggles show as pressed. */
  const views = $derived(panes.filter((pane) => isViewPaneType(pane.type)));
  const openViews = $derived(
    views.map(({ type }) => type).filter(isViewPaneType),
  );
  const PANELS: string[] = ['activity', 'insights', 'settings', 'shortcuts'];
  const PULL_REQUEST_ID = 'pull-request';
  const isPanel = (id: string): id is AppPanel => PANELS.includes(id);
  /** Every open panel and pane, in the order the strip shows them. */
  const stripIds = $derived.by(() => {
    const visible = [...panels, ...panes.map(({ id }) => id)];
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
  /** Terminals stop at the number that can draw with WebGL; the menu then leaves them out. */
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

  /** Opens a closed conversation again at the front of the strip and brings it into sight. */
  async function reopenPane(paneId: string) {
    if (busy) return;
    if (!canAddPane) {
      toast(`A project can have up to ${MAX_PANES} panes open.`);
      return;
    }
    await changePanes(() => window.bonfire.panes.reopen(paneId));
    if (!panes.some((pane) => pane.id === paneId)) return;
    paneStrip?.scrollTo({ left: 0, behavior: scrollBehavior() });
    void focusPane(paneId);
  }

  function addProject() {
    creatingProject = true;
  }

  function removeProject(projectId: string) {
    void runAction(() => window.bonfire.projects.remove(projectId));
  }

  function openProject(projectId: string) {
    if (projectId === project?.id) return;
    // Opening a project is looking at it, so its finished turns no longer need a reminder.
    for (const pane of workspace.panes)
      if (pane.projectId === projectId) statuses.markSeen(pane.id);
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
    const view = !!type && isViewPaneType(type);
    const open = view && panes.find((pane) => pane.type === type);
    if (open) {
      void focusPane(open.id);
      return;
    }
    if (!canAddPane) {
      toast(`A project can have up to ${MAX_PANES} panes open.`);
      return;
    }
    if (type === 'terminal' && !canAddTerminal) {
      toast(
        `A project can have up to ${MAX_TERMINAL_PANES} terminal panes open.`,
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
    if (projectId)
      selectedDiff = {
        projectId,
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
      !panes.length,
      showPullRequest && (pullRequestSize ?? autoSize),
    ]),
  );

  $effect.pre(() => {
    void stripLayout;
    untrack(() => motion.measure());
  });

  $effect(() => {
    void stripLayout;
    untrack(() =>
      motion.play((id) => paneMotion || isPanel(id) || id === PULL_REQUEST_ID),
    );
  });

  /** Brings an opened panel or view into sight at its end of the strip. */
  async function revealEdge(edge: 'start' | 'end') {
    await tick();
    paneStrip?.scrollTo({
      left: edge === 'start' ? 0 : paneStrip.scrollWidth,
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
  async function scrollToSection(selector: string, id: string) {
    // A section still growing in is narrower than it will be, so the strip can't
    // scroll to it yet; measure once the layout has settled.
    await Promise.allSettled(
      (
        paneStrip?.querySelectorAll<HTMLElement>(':scope > [data-strip-id]') ??
        []
      )
        .values()
        .flatMap((node) => node.getAnimations().map((a) => a.finished)),
    );
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
    statuses.markSeen(paneId);
    return scrollToSection(`[data-pane-id="${CSS.escape(paneId)}"]`, paneId);
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

  /** Panel names can't clash with pane ids, which are UUIDs. */
  function scrollToPanel(panel: AppPanel) {
    return scrollToSection(`[data-panel="${panel}"]`, panel);
  }

  /** Closes a panel, or opens Activity at the end and global panels at the front. */
  function togglePanel(panel: AppPanel) {
    if (panel === 'activity' && !project) return;
    if (panels.includes(panel)) {
      panels = panels.filter((open) => open !== panel);
      return;
    }
    if (panel === 'activity')
      stripOrder = [...stripIds.filter((id) => id !== panel), panel];
    panels = [panel, ...panels];
    if (panel === 'activity') void tick().then(() => scrollToPanel(panel));
    else void revealEdge('start');
  }

  /** Applies a new visible pane order locally, then saves it. */
  function reorder(ids: string[]) {
    workspace.layout.paneIds = reorderLayout(workspace.layout.paneIds, ids);
    void runAction(() => window.bonfire.panes.reorder(ids));
  }

  /** Moves a pane or panel along the strip, one place at a time, and keeps it in sight. */
  function moveItem(id: string, step: number) {
    const ids = [...stripIds];
    const index = ids.indexOf(id);
    const target = index + step;
    if (index < 0 || target < 0 || target >= ids.length) return;
    ids.splice(index, 1);
    ids.splice(target, 0, id);
    reorderStrip(ids);
    void tick().then(() =>
      isPanel(id) ? scrollToPanel(id) : scrollToPane(id),
    );
  }

  /** The grip of a pane or panel: drags it, or moves it with the arrow keys. */
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

  function panelProps(panel: AppPanel) {
    return {
      dragHandle: gripOf(panel),
      size: paneSize(panel),
      onclose: () => togglePanel(panel),
      onresize: (size: PaneSize) => (sizeOverrides[panel] = size),
    };
  }

  /** Applies a new strip order, panels and panes alike; the panes' part is saved. */
  function reorderStrip(ids: string[]) {
    stripOrder = ids;
    const paneIds = ids.filter((id) => !isPanel(id));
    if (paneIds.length > 1) reorder(paneIds);
  }

  // Pane status needs events for every agent, including ones scrolled out of view and
  // ones in other projects, whose state the project picker flags.
  $effect(() => {
    if (!loaded) return;
    for (const pane of workspace.panes)
      if (!pane.archived && isAssistantPane(pane)) void statuses.load(pane.id);
  });

  /** What needs the user in each project other than the open one: the most urgent state wins. */
  const projectAttention = $derived.by(() => {
    const attention: Record<string, ProjectAttention> = {};
    for (const pane of workspace.panes) {
      if (pane.archived || !isAssistantPane(pane)) continue;
      const owner = pane.projectId;
      if (!owner || owner === projectId) continue;
      const status = paneBadge(statuses.get(pane.id));
      if (!status) continue;
      const current = attention[owner];
      if (!current || ATTENTION_RANK[status] > ATTENTION_RANK[current])
        attention[owner] = status;
    }
    return attention;
  });

  $effect(() => {
    if (!project) pullRequestOpen = false;
  });

  // The pull request opens at the end of the strip, which is brought into sight.
  $effect(() => {
    if (showPullRequest) untrack(() => void revealEdge('end'));
  });

  $effect(() => {
    if (!loaded) return;
    const id = projectId;
    return untrack(() => branch.watch(id));
  });

  // The header's pull request button follows the branch on screen.
  $effect(() => {
    if (!loaded) return;
    const id = branch.head?.branch ? projectId : undefined;
    void branch.head;
    return untrack(() => pullRequest.watch(id));
  });

  $effect(() => {
    if (!loaded) return;
    const id = projectId;
    return untrack(() => scripts.watch(id));
  });

  // A script runs in its own terminal pane at the end of the strip, brought on screen.
  $effect(() => {
    scripts.onPane = async (paneId) => {
      const opened = !panes.some((pane) => pane.id === paneId);
      await refresh();
      if (opened)
        stripOrder = [...stripIds.filter((id) => id !== paneId), paneId];
      await tick();
      scrollToPane(paneId);
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
      stripOrder = [...stripIds.filter((id) => id !== paneId), paneId];
      await tick();
      void focusPane(paneId);
    };
    return () => (pullRequest.onAgentPane = undefined);
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
    const current = sizeOverrides[activePane.id] ?? defaultPaneSize(stripCount);
    sizeOverrides[activePane.id] =
      sizes[(sizes.indexOf(current) + 1) % sizes.length];
    const { id } = activePane;
    void tick().then(() => scrollToPane(id));
  }

  function togglePullRequest() {
    if (!project || pullRequest.current === undefined) return;
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
      case 'activity':
        togglePanel(id);
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
      case 'closePane': {
        const target = activePane;
        if (target) void closePane(target.id);
        break;
      }
      case 'reopenPane':
        if (closedPanes[0]) void reopenPane(closedPanes[0].id);
        break;
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
    const titles = workspace.panes
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

  /** Leaves setup for the workspace, where the starting panes open on their own. */
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

  /** The agent that starts a project: Claude when connected, else whichever provider is. */
  function startingAgents(): AssistantProvider[] {
    const ready = PROVIDERS.filter(
      (provider) =>
        accounts[provider]?.signedIn &&
        workspace.preferences?.providers?.[provider] !== false,
    );
    if (!ready.length) return [];
    return [ready.includes('claude') ? 'claude' : ready[0]];
  }

  /** Whether starting panes are being opened; a failed attempt isn't retried until the project changes. */
  let seeding = false;
  let seedFailedFor: string | undefined;
  /** Projects that have had their starting panes, so closing them all leaves the empty state. */
  const seeded = new Set<string>();

  async function openStartingPanes() {
    const agents = startingAgents();
    if (!agents.length || seeding || seedFailedFor === projectId) return;
    seeding = true;
    try {
      // New panes go to the front, so the last one added ends up first.
      for (const agent of agents.toReversed()) {
        await runAction(() => window.bonfire.panes.add(agent));
      }
      await tick();
      seedFailedFor = panes.length ? undefined : projectId;
      paneStrip?.scrollTo({ left: 0, behavior: scrollBehavior() });
    } finally {
      seeding = false;
    }
  }

  $effect(() => {
    if (!loaded || onboarding || !projectId || busy) return;
    if (panes.length) {
      seeded.add(projectId);
      return;
    }
    if (seeded.has(projectId)) return;
    seeded.add(projectId);
    void openStartingPanes();
  });

  // The open project's machine runs its own agent CLIs, so they're checked as projects change.
  $effect(() => {
    if (!loaded) return;
    void projectId;
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
</script>

<svelte:head><title>Bonfire</title></svelte:head>
<!-- The CLIs update themselves in the background; the backend's cached answer keeps focus cheap. -->
<svelte:window
  onkeydowncapture={handleKeydown}
  onfocus={() => loaded && void cliVersions.refresh()}
/>

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
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        onpointerenter={() => (stirred = true)}
        onpointerleave={() => (stirred = false)}
      >
        <Logo active={stirred} idle={!stirred} warm class="size-10" />
      </div>
      <h1 class="mt-6 font-medium text-foreground">Start a conversation</h1>
      <p class="max-w-90 text-pretty">
        {#if branch.head?.branch}
          Conversations work on {branch.head.branch}.
        {:else}
          Conversations work in {project?.name}.
        {/if}
      </p>
    </Card.Root>
  {/if}
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
      hasProjects={workspace.projects.length > 0}
      onfinish={() => void finishOnboarding()}
    />
  {:else}
    <div class="flex h-screen">
      <AppRail
        {panels}
        ontogglePanel={togglePanel}
        {trafficLightInset}
        onaddPane={addPane}
        startingProvider={startingProvider(
          preferences.current,
          workspace.settings.lastProvider,
        )}
        panes={panes.map(({ id, title }) => ({
          id,
          title,
          status: scripts.runOfPane(id)?.running ? 'working' : statuses.get(id),
        }))}
        {canAddPane}
        {canAddTerminal}
        onselectPane={scrollToPane}
        onselectPanel={scrollToPanel}
        {closedPanes}
        closedBranch={closedBranch ?? undefined}
        onreopenPane={reopenPane}
      />
      <div class="flex min-w-0 flex-1 flex-col">
        <AppHeader
          {trafficLightInset}
          bind:pullRequestOpen
          disabled={!project}
          activityOpen={panels.includes('activity')}
          ontoggleActivity={() => togglePanel('activity')}
          {openViews}
          ontoggleView={toggleView}
          paneCount={panes.length + panels.length}
          onclosePanes={() =>
            void changePanes(async () => {
              panels = [];
              for (const { id } of panes)
                await window.bonfire.panes.archive(id);
            })}
        >
          {#snippet location()}
            <ProjectPicker
              projects={workspace.projects}
              active={project}
              attention={projectAttention}
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
                  '-mx-1 flex h-full snap-x snap-mandatory overflow-x-auto overflow-y-hidden overscroll-x-contain scrollbar-none',
                  drag.active && 'select-none',
                  (drag.active || motion.active) && 'snap-none',
                )}
              >
                {#each stripIds as id (id)}
                  {@const pane = isPanel(id)
                    ? undefined
                    : panes.find((pane) => pane.id === id)}
                  {#if !panes.length && id === 'activity'}
                    <section
                      data-strip-id="placeholder"
                      class={cn(SECTION_CLASS, autoSizeClass)}
                      out:leave={{ animate: paneMotion }}
                    >
                      {@render placeholder()}
                    </section>
                  {/if}
                  <!-- One section for panels and panes alike: an `out:` only plays when its own
                     block goes, so the section has to sit right in the `#each`. -->
                  <section
                    data-panel={pane ? undefined : id}
                    data-pane-id={pane?.id}
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
                    out:leave={{ animate: !pane || paneMotion }}
                  >
                    {#if pane}
                      <PaneView
                        {pane}
                        projectId={project!.id}
                        badge={paneBadge(statuses.get(pane.id))}
                        onviewChanges={viewChanges}
                        selectedDiff={selectedDiff?.projectId === project!.id
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
                    {:else if id === 'settings'}
                      <SettingsPane {...panelProps(id)} />
                    {:else if id === 'shortcuts'}
                      <ShortcutsPane {...panelProps(id)} />
                    {:else if id === 'activity'}
                      <ActivityPane {projectId} {...panelProps(id)} />
                    {:else if id === 'insights'}
                      <InsightsPane
                        bind:tab={insightsTab}
                        {...panelProps(id)}
                      />
                    {/if}
                  </section>
                {/each}
                {#if !panes.length && !panels.includes('activity')}
                  <section
                    data-strip-id="placeholder"
                    class={cn(SECTION_CLASS, autoSizeClass)}
                    out:leave={{ animate: paneMotion }}
                  >
                    {@render placeholder()}
                  </section>
                {/if}
                {#if project && showPullRequest}
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
                      projectId={project.id}
                      size={pullRequestSize ?? autoSize}
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
</Bloom>

{#if project}
  <NewBranchDialog bind:open={creatingBranch} projectId={project.id} />
{/if}
<CreateProjectDialog
  bind:open={creatingProject}
  oncreated={() => void refresh().catch(showError)}
/>
