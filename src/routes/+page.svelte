<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import * as Card from '$lib/components/ui/card';
  import AppHeader from '$lib/components/app-header/app-header.svelte';
  import AssistantView from '$lib/components/assistant-view/assistant-view.svelte';
  import Icon from '$lib/components/icon/icon.svelte';
  import type { Pane, State } from '$shared/contracts';

  type PaneSize = 'full' | 'half' | 'third';

  let workspaceState = $state<State>({
    version: 1,
    projects: [],
    sessions: [],
    panes: [],
    settings: { fontSize: 13 },
  });
  let loaded = $state(false);
  let busy = $state(false);
  let error = $state('');
  let paneStrip = $state<HTMLDivElement>();
  let sizeOverrides = $state<Record<string, PaneSize>>({});

  const project = $derived(
    workspaceState.projects.find(
      (item) => item.id === workspaceState.lastProjectId,
    ),
  );
  const session = $derived(
    workspaceState.sessions.find(
      (item) => item.id === workspaceState.lastSessionId,
    ),
  );
  const panes = $derived.by(() => {
    if (!session) return [] as Pane[];
    return session.layout.paneIds
      .map((id) => workspaceState.panes.find((pane) => pane.id === id))
      .filter((pane): pane is Pane => !!pane && !pane.archived);
  });

  async function refresh() {
    workspaceState = await window.bonfire.state.get();
  }

  async function action(run: () => Promise<unknown>) {
    busy = true;
    error = '';
    try {
      await run();
      await refresh();
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      busy = false;
    }
  }

  function addProject() {
    void action(() => window.bonfire.projects.add());
  }

  function selectProject(id: string) {
    void action(() => window.bonfire.projects.select(id));
  }

  async function addPane(type: 'claude' | 'codex' = 'codex') {
    if (!session || busy) return;
    await action(() => window.bonfire.panes.add(session.id, type));
    await tick();
    paneStrip?.scrollTo({
      left: 0,
      behavior: reducedMotion() ? 'auto' : 'smooth',
    });
  }

  async function archivePane(id: string) {
    await action(() => window.bonfire.panes.archive(id));
  }

  function resizePane(id: string, size: PaneSize) {
    sizeOverrides = { ...sizeOverrides, [id]: size };
  }

  function paneBasis(pane: Pane) {
    const requested = sizeOverrides[pane.id];
    if (requested === 'full') return '100%';
    if (requested === 'half') return 'max(calc(50% - 4px), 420px)';
    if (requested === 'third') return 'max(calc(33.333% - 6px), 360px)';
    if (panes.length === 1) return '100%';
    if (panes.length === 2) return 'max(calc(50% - 4px), 420px)';
    return 'max(calc(33.333% - 6px), 360px)';
  }

  function scrollPane(direction: -1 | 1) {
    const strip = paneStrip;
    const first = strip?.querySelector<HTMLElement>('[data-pane-id]');
    if (!strip || !first) return;
    strip.scrollBy({
      left: direction * (first.offsetWidth + 8),
      behavior: reducedMotion() ? 'auto' : 'smooth',
    });
  }

  function reducedMotion() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  onMount(() => {
    if (!window.bonfire) {
      error = 'Launch Bonfire with npm start or npm run dev.';
      return;
    }
    void refresh()
      .then(async () => {
        if (workspaceState.lastProjectId && !workspaceState.lastSessionId) {
          await window.bonfire.projects.select(workspaceState.lastProjectId);
          await refresh();
        }
        loaded = true;
      })
      .catch((cause) => {
        error = cause instanceof Error ? cause.message : String(cause);
      });
  });
</script>

<svelte:head><title>Bonfire</title></svelte:head>

<div class="app-shell">
  <AppHeader
    projects={workspaceState.projects}
    active={project}
    onselect={selectProject}
    onaddProject={addProject}
    onaddPane={(type) => void addPane(type)}
    onprevious={() => scrollPane(-1)}
    onnext={() => scrollPane(1)}
    onhelp={() => void window.bonfire.navigation.help()}
  />

  {#if error}
    <div class="global-error" role="alert">
      <span>{error}</span>
      <button aria-label="Dismiss error" onclick={() => (error = '')}>×</button>
    </div>
  {/if}

  <main>
    {#if session && panes.length}
      <div
        class="pane-strip snap-x snap-mandatory overflow-x-auto"
        bind:this={paneStrip}
      >
        {#each panes as pane (pane.id)}
          <section
            class="pane-slot snap-start"
            data-pane-id={pane.id}
            style:flex-basis={paneBasis(pane)}
          >
            <AssistantView
              {pane}
              {session}
              onarchive={() => void archivePane(pane.id)}
              onresize={(size) => resizePane(pane.id, size)}
              onrefresh={() => void refresh()}
            />
          </section>
        {/each}
      </div>
    {:else}
      <Card.Root class="welcome-card">
        <Icon name="bot" />
        <h1 class="text-sm">
          {project ? 'Start a conversation' : 'Open a local project'}
        </h1>
        <p class="text-sm">
          {project
            ? 'Create a Claude or Codex pane to work in this repository.'
            : 'Choose a project from your computer to begin.'}
        </p>
        <Button
          disabled={!loaded || busy}
          onclick={project ? () => void addPane() : addProject}
        >
          {project ? 'New conversation' : 'Add project'}
        </Button>
      </Card.Root>
    {/if}
  </main>
</div>

<style>
  .app-shell {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    height: 100vh;
    overflow: hidden;
    background: var(--background);
  }
  main {
    min-width: 0;
    min-height: 0;
    padding: 0 8px 8px;
  }
  .pane-strip {
    display: flex;
    height: 100%;
    gap: 8px;
    overscroll-behavior-inline: contain;
    scrollbar-width: none;
  }
  .pane-strip::-webkit-scrollbar {
    display: none;
  }
  .pane-slot {
    flex: 0 0 auto;
    min-width: 0;
    height: 100%;
    transition: flex-basis 240ms cubic-bezier(0.645, 0.045, 0.355, 1);
  }
  :global(.welcome-card) {
    display: grid;
    height: 100%;
    place-content: center;
    justify-items: center;
    background: var(--panel);
    color: var(--foreground-subtle);
    text-align: center;
  }
  :global(.welcome-card svg) {
    width: 28px;
    height: 28px;
  }
  :global(.welcome-card h1) {
    margin: 24px 0 0;
    color: var(--foreground);
    font-weight: 500;
  }
  :global(.welcome-card p) {
    margin: 0 0 24px;
    color: var(--foreground-subtle);
  }
  .global-error {
    position: fixed;
    z-index: 40;
    top: 60px;
    left: 50%;
    display: flex;
    align-items: center;
    gap: 16px;
    max-width: min(560px, calc(100vw - 32px));
    padding: 10px 12px;
    border-radius: 8px;
    transform: translateX(-50%);
    background: var(--destructive-surface);
    color: var(--destructive);
  }
  .global-error button {
    border: 0;
    background: transparent;
    color: inherit;
  }
  @media (prefers-reduced-motion: reduce) {
    .pane-slot {
      transition-property: opacity;
    }
  }
</style>
