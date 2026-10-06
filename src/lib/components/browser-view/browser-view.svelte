<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import * as Card from '$lib/components/ui/card';
  import EmptyState from '$lib/components/empty-state/empty-state.svelte';
  import Icon from '$lib/components/icon/icon.svelte';
  import PaneHeader from '$lib/components/pane-header/pane-header.svelte';
  import { toolPaneIcon, type PaneProps } from '$lib/panes';
  import { cn } from '$lib/utils';
  import { toBrowserUrl } from './browser-url';

  /** The parts of Electron's <webview> element this pane uses. */
  type WebviewElement = HTMLElement & {
    loadURL(url: string): Promise<void>;
    reload(): void;
    stop(): void;
    getURL(): string;
  };

  let {
    title,
    url: savedUrl,
    onnavigate,
    dragHandle,
    size,
    onresize,
    onclose,
  }: PaneProps & {
    title: string;
    /** The page the pane last showed, which it reopens. */
    url?: string;
    /** The pane moved to another page, to be remembered. */
    onnavigate: (url: string) => void;
  } = $props();

  // Seeded once: after that the pane, not the saved state, knows where it is.
  // The webview first loads `initialSrc`; later pages are loaded through it.
  // svelte-ignore state_referenced_locally
  let initialSrc = $state(savedUrl ?? '');
  // svelte-ignore state_referenced_locally
  let current = $state(savedUrl ?? '');
  // svelte-ignore state_referenced_locally
  let address = $state(savedUrl ?? '');
  let favicon = $state<string>();
  let loading = $state(false);
  let error = $state('');
  let editing = $state(false);
  let ready = false;
  let webview = $state<WebviewElement>();
  let input = $state<HTMLInputElement>();

  function open(value: string) {
    const next = toBrowserUrl(value);
    if (!next) {
      error = 'Only web pages can be opened.';
      return;
    }
    error = '';
    address = next;
    input?.blur();
    if (!initialSrc) initialSrc = next;
    else if (webview && ready) void webview.loadURL(next).catch(() => {});
    else initialSrc = next;
  }

  function reload() {
    if (!webview || !ready) return;
    error = '';
    webview.reload();
  }

  /** Follows the page as it navigates, so the URL bar, icon and saved URL keep up. */
  function track(node: HTMLElement) {
    const view = node as WebviewElement;
    webview = view;
    const arrived = (url: string) => {
      if (!/^https?:\/\//i.test(url)) return;
      if (url !== current) favicon = undefined;
      current = url;
      if (!editing) address = url;
      onnavigate(url);
    };
    const listeners: Record<string, (event: any) => void> = {
      'dom-ready': () => (ready = true),
      'did-start-loading': () => {
        loading = true;
        error = '';
      },
      'did-stop-loading': () => (loading = false),
      'did-navigate': (event) => arrived(event.url),
      'did-navigate-in-page': (event) => {
        if (event.isMainFrame) arrived(event.url);
      },
      'page-favicon-updated': (event) => (favicon = event.favicons?.[0]),
      'did-fail-load': (event) => {
        // -3 is a load cut short by another, which is no failure.
        if (!event.isMainFrame || event.errorCode === -3) return;
        error = `Couldn’t load ${event.validatedURL || 'the page'}: ${event.errorDescription || 'unknown error'}.`;
      },
    };
    for (const [name, listener] of Object.entries(listeners))
      view.addEventListener(name, listener);
    return () => {
      for (const [name, listener] of Object.entries(listeners))
        view.removeEventListener(name, listener);
      ready = false;
      webview = undefined;
    };
  }

  $effect(() => {
    if (!initialSrc) input?.focus();
  });
</script>

<Card.Root class="relative h-full min-w-0">
  <PaneHeader
    {title}
    icon={toolPaneIcon('browser')}
    iconSrc={favicon}
    menuLabel="Browser options"
    {dragHandle}
    {size}
    {onresize}
    {onclose}
  >
    {#snippet heading()}
      <form
        class="min-w-0 flex-1"
        onsubmit={(event) => {
          event.preventDefault();
          open(address);
        }}
      >
        <input
          bind:this={input}
          bind:value={address}
          class="h-7 w-full min-w-0 rounded-full bg-composer px-3.5 text-sm font-normal text-foreground transition-shadow outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/60"
          type="text"
          inputmode="url"
          placeholder="Enter a URL, such as localhost:3000"
          aria-label="Page address"
          spellcheck="false"
          autocomplete="off"
          autocapitalize="off"
          onfocus={(event) => {
            editing = true;
            event.currentTarget.select();
          }}
          onblur={() => {
            editing = false;
            if (current) address = current;
          }}
          onkeydown={(event) => {
            if (event.key !== 'Escape') return;
            event.stopPropagation();
            address = current;
            event.currentTarget.blur();
          }}
        />
      </form>
    {/snippet}
    {#snippet actions()}
      <Button
        variant="secondary"
        size="icon"
        class="shrink-0 text-muted-foreground hover:text-foreground"
        aria-label="Reload page"
        title="Reload page"
        disabled={!initialSrc}
        onclick={reload}
      >
        <Icon name="refresh" class={cn(loading && 'animate-spin')} />
      </Button>
    {/snippet}
  </PaneHeader>
  <section class="relative min-h-0 flex-1 overflow-hidden px-2 pb-2">
    {#if initialSrc}
      <webview
        {@attach track}
        src={initialSrc}
        partition="persist:browser"
        allowpopups
        class="size-full overflow-hidden rounded-lg bg-white"
      ></webview>
    {:else}
      <EmptyState
        class="h-full"
        icon={toolPaneIcon('browser')}
        title="No page open"
        description="Enter a URL above to open a page."
      />
    {/if}
    {#if error}
      <p
        class="absolute inset-x-4 bottom-4 rounded-lg bg-card/95 px-3 py-2 text-sm text-destructive shadow-lg"
        role="alert"
      >
        {error}
      </p>
    {/if}
  </section>
</Card.Root>
