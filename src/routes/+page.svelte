<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import * as Card from '$lib/components/ui/card';
  import AppHeader from '$lib/components/app-header/app-header.svelte';
  import AssistantView from '$lib/components/assistant-view/assistant-view.svelte';
  import Icon from '$lib/components/icon/icon.svelte';
  import { PANE_SIZES, defaultPaneSize, type PaneSize } from '$lib/panes';
  import { toast } from '$lib/stores/toast.svelte';
  import { cn, scrollBehavior } from '$lib/utils';
  import type { AssistantProvider, Pane, State } from '$shared/contracts';
  import { emptyState, errorMessage } from '$shared/domain';

  let workspace = $state<State>(emptyState());
  let loaded = $state(false);
  let busy = $state(false);
  let paneStrip = $state<HTMLDivElement>();
  let sizeOverrides = $state<Record<string, PaneSize>>({});

  const panes = $derived(
    workspace.layout.paneIds
      .map((id) => workspace.panes.find((pane) => pane.id === id))
      .filter(
        (pane): pane is Pane =>
          !!pane && !pane.archived && pane.type !== 'terminal',
      ),
  );

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
    await runAction(() => window.bonfire.panes.add(provider, model));
    await tick();
    paneStrip?.scrollTo({ left: 0, behavior: scrollBehavior() });
  }

  function paneSizeClass(pane: Pane) {
    const size = sizeOverrides[pane.id] ?? defaultPaneSize(panes.length);
    return PANE_SIZES.find(({ value }) => value === size)?.class;
  }

  function scrollPanes(direction: -1 | 1) {
    const firstPane = paneStrip?.querySelector<HTMLElement>('[data-pane-id]');
    if (!firstPane) return;
    paneStrip?.scrollBy({
      left: direction * firstPane.offsetWidth,
      behavior: scrollBehavior(),
    });
  }

  onMount(async () => {
    if (!window.bonfire) {
      showError('Launch Bonfire with npm start or npm run dev.');
      return;
    }
    try {
      await refresh();
      loaded = true;
    } catch (cause) {
      showError(cause);
    }
  });
</script>

<svelte:head><title>Bonfire</title></svelte:head>

<div class="flex h-screen flex-col">
  <AppHeader
    onaddPane={() => addPane()}
    onprevious={() => scrollPanes(-1)}
    onnext={() => scrollPanes(1)}
    onhelp={() => window.bonfire.navigation.help()}
  />

  <main class="min-h-0 flex-1 px-2 pb-2">
    {#if panes.length}
      <div
        bind:this={paneStrip}
        class="-mx-1 flex h-full snap-x snap-mandatory overflow-x-auto overscroll-x-contain scrollbar-none"
      >
        {#each panes as pane (`${pane.id}:${pane.type}`)}
          <section
            data-pane-id={pane.id}
            class={cn(
              'h-full shrink-0 snap-start px-1 transition-all duration-200 ease-in-out motion-reduce:transition-none',
              paneSizeClass(pane),
            )}
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
