<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import * as Card from '$lib/components/ui/card';
  import AppHeader from '$lib/components/app-header/app-header.svelte';
  import AssistantView from '$lib/components/assistant-view/assistant-view.svelte';
  import Icon from '$lib/components/icon/icon.svelte';
  import { PANE_SIZES, defaultPaneSize, type PaneSize } from '$lib/panes';
  import { PaneDrag } from '$lib/pane-drag.svelte';
  import { PaneStatuses } from '$lib/pane-status.svelte';
  import { playCompletionSound } from '$lib/sounds';
  import { preferences } from '$lib/stores/preferences.svelte';
  import { toast } from '$lib/stores/toast.svelte';
  import { cn, scrollBehavior } from '$lib/utils';
  import type { HTMLButtonAttributes } from 'svelte/elements';
  import type {
    AssistantEvent,
    AssistantProvider,
    Pane,
    PanesClosedEvent,
    State,
  } from '$shared/contracts';
  import {
    MAX_PANES,
    emptyState,
    errorMessage,
    reorderLayout,
  } from '$shared/domain';

  let workspace = $state<State>(emptyState());
  let loaded = $state(false);
  let loading = $state(true);
  let busy = $state(false);
  let paneStrip = $state<HTMLDivElement>();
  const statuses = new PaneStatuses();
  let inView = $state<Record<string, boolean>>({});
  let sizeOverrides = $state<Record<string, PaneSize>>({});
  const drag = new PaneDrag(() => paneStrip, reorder);

  const panes = $derived(
    workspace.layout.paneIds
      .map((id) => workspace.panes.find((pane) => pane.id === id))
      .filter(
        (pane): pane is Pane =>
          !!pane && !pane.archived && pane.type !== 'terminal',
      ),
  );

  const canAddPane = $derived(panes.length < MAX_PANES);

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

  function sessionFor(pane: Pane) {
    return workspace.sessions.find(({ id }) => id === pane.sessionId);
  }

  function projectFor(pane: Pane) {
    const session = sessionFor(pane);
    return workspace.projects.find(({ id }) => id === session?.projectId);
  }

  function addProject(paneId: string) {
    void runAction(async () => {
      const project = await window.bonfire.projects.add();
      if (project) await window.bonfire.panes.setProject(paneId, project.id);
    });
  }

  async function addPane(provider?: AssistantProvider, model?: string) {
    if (busy) return;
    if (!canAddPane) {
      toast(`You can have up to ${MAX_PANES} panes open.`);
      return;
    }
    await runAction(() => window.bonfire.panes.add(provider, model));
    await tick();
    paneStrip?.scrollTo({ left: 0, behavior: scrollBehavior() });
  }

  function paneSizeClass(pane: Pane) {
    const size = sizeOverrides[pane.id] ?? defaultPaneSize(panes.length);
    return PANE_SIZES.find(({ value }) => value === size)?.class;
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

  // Pane status needs events for every pane, including ones scrolled out of view.
  $effect(() => {
    if (!loaded) return;
    for (const { id } of panes) void statuses.load(id);
  });

  // Tracks which panes are in view so the header can mark them.
  $effect(() => {
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

  onMount(() => {
    if (!window.bonfire) return;
    const subscriptions = [
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
      loaded = true;
    } catch (cause) {
      showError(cause);
    } finally {
      loading = false;
    }
  });
</script>

<svelte:head><title>Bonfire</title></svelte:head>

<div class="flex h-screen flex-col">
  <AppHeader
    onaddPane={() => addPane()}
    panes={panes.map(({ id }) => ({
      id,
      status: statuses.get(id),
      inView: !!inView[id],
    }))}
    {canAddPane}
    onselectPane={scrollToPane}
    onhelp={() => window.bonfire.navigation.help()}
  />

  <main class="min-h-0 flex-1 px-2 pb-2">
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
    {:else if panes.length}
      <div
        bind:this={paneStrip}
        class={cn(
          '-mx-1 flex h-full snap-x snap-mandatory overflow-x-auto overscroll-x-contain scrollbar-none',
          drag.active && 'snap-none select-none',
        )}
      >
        {#each panes as pane (`${pane.id}:${pane.type}`)}
          <section
            data-pane-id={pane.id}
            class={cn(
              'h-full shrink-0 snap-start px-1 transition-[flex-basis,min-width] duration-200 ease-in-out motion-reduce:transition-none',
              paneSizeClass(pane),
              drag.isDragging(pane.id) && '*:shadow-2xl *:shadow-black/50',
            )}
            style={drag.style(pane.id)}
          >
            <AssistantView
              {pane}
              session={sessionFor(pane)}
              projects={workspace.projects}
              project={projectFor(pane)}
              onselectproject={(projectId) =>
                runAction(() =>
                  window.bonfire.panes.setProject(pane.id, projectId),
                )}
              onaddproject={() => addProject(pane.id)}
              onremoveproject={(projectId) =>
                runAction(() => window.bonfire.projects.remove(projectId))}
              dragHandle={dragHandle(pane)}
              onarchive={() =>
                runAction(() => window.bonfire.panes.archive(pane.id))}
              onresize={(size) => (sizeOverrides[pane.id] = size)}
              onrefresh={refresh}
              onswitchprovider={addPane}
              onretype={(provider, model) =>
                runAction(() =>
                  window.bonfire.panes.retype(pane.id, provider, model),
                )}
            />
          </section>
        {/each}
      </div>
    {:else}
      <Card.Root
        class="grid h-full place-content-center justify-items-center text-center text-muted-foreground"
      >
        <Icon name="bot" class="size-7" />
        <h1 class="mt-6 font-medium text-foreground">Start a conversation</h1>
        <p class="mb-6">
          Create a Claude or Codex pane, then choose a project to work in.
        </p>
        <Button disabled={!loaded || busy} onclick={() => addPane()}>
          New conversation
        </Button>
      </Card.Root>
    {/if}
  </main>
</div>
