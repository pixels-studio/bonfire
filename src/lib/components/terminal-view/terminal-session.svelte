<script lang="ts">
  import { onMount } from 'svelte';
  import { Terminal } from '@xterm/xterm';
  import { FitAddon } from '@xterm/addon-fit';
  import { WebglAddon } from '@xterm/addon-webgl';
  import '@xterm/xterm/css/xterm.css';
  import { Button } from '$lib/components/ui/button';
  import TerminalScrollbar from './terminal-scrollbar.svelte';
  import { terminalEvents } from '$lib/main-events';
  import { OutputActivity, webglPool, type WebglClaim } from '$lib/webgl-pool';
  import { scripts } from '$lib/stores/scripts.svelte';
  import { errorMessage } from '$shared/domain';
  import type { TerminalEvent } from '$shared/contracts';

  let {
    workspaceId,
    paneId,
    scriptId,
  }: {
    workspaceId: string;
    paneId: string;
    /** Shows the run script's terminal instead of starting a shell. */
    scriptId?: string;
  } = $props();

  let host: HTMLDivElement;
  let error = $state('');
  let exited = $state(false);
  let starting = $state(false);
  /** Whether xterm is set up, which attaching to a script's run waits for. */
  let opened = $state(false);

  let term: Terminal;
  /** The terminal once it is open, for the scroller. */
  let openTerm = $state.raw<Terminal>();
  let surface = $state<HTMLDivElement>();
  let fit: FitAddon;
  /** Draws on the GPU while the terminal is busy, in view, and the pool has a context to spare. */
  let webgl: WebglAddon | undefined;
  let inView = false;
  /** Which renderer draws the terminal, for anyone checking. */
  let renderer = $state<'webgl' | 'dom'>('dom');
  let terminalId: string | undefined;
  let mounted = false;
  let ready = false;
  let pendingEvents: TerminalEvent[] = [];
  let lastSequence = 0;
  /** Stops following the attached terminal's output. */
  let stopEvents: (() => void) | undefined;
  /** Output drawn since main was last told of it. */
  let shownChars = 0;
  /** How much output is drawn before main is told, so a flood isn't one message per chunk. */
  const ACK_STEP = 64 * 1024;
  let resizeTimer: ReturnType<typeof setTimeout> | undefined;
  /** The grid the PTY was last told of, as `cols×rows`. */
  let sentSize = '';

  /**
   * How long a size is let settle before the terminal is fitted to it. The pane strip
   * animates widths, so every pane's terminal would otherwise be fitted each frame, and on
   * Windows every PTY resize has the console repaint its whole screen.
   */
  const RESIZE_SETTLE_MS = 60;

  /** The script's current process, which the pane follows across restarts. */
  const runTerminalId = $derived(
    scriptId ? scripts.runOfPane(paneId)?.terminalId : undefined,
  );

  function reportError(cause: unknown) {
    error = errorMessage(cause);
  }

  function exitLine(code: number) {
    term.writeln(`\r\n[Process exited: ${code}]`);
  }

  /** Tells main what has been drawn, so it pauses a program only while the view is behind. */
  function shown(id: string, chars: number) {
    if (id !== terminalId) return;
    shownChars += chars;
    if (shownChars < ACK_STEP) return;
    const acked = shownChars;
    shownChars = 0;
    window.bonfire.terminal.ack(id, acked).catch(() => {});
  }

  function receive(event: TerminalEvent) {
    if (event.terminalId !== terminalId) return;
    if (!event.hostStopped) {
      if (event.sequence <= lastSequence) return;
      lastSequence = event.sequence;
    }
    if (event.data) {
      const { terminalId: id, data } = event;
      activity.output(data.length);
      // A hidden window draws in slow motion; the program shouldn't wait on it.
      if (document.hidden) {
        term.write(data);
        shown(id, data.length);
      } else term.write(data, () => shown(id, data.length));
    }
    if (event.exitCode !== undefined) {
      exited = true;
      exitLine(event.exitCode);
    }
  }

  /** Shows a terminal's output so far, then follows it. */
  async function attach(id: string, focus: boolean) {
    terminalId = id;
    ready = false;
    lastSequence = 0;
    exited = false;
    error = '';
    pendingEvents = [];
    shownChars = 0;
    // Until the snapshot is in, this terminal's output waits.
    stopEvents?.();
    stopEvents = terminalEvents.on(id, (event) => {
      if (ready) receive(event);
      else pendingEvents.push(event);
    });
    term.reset();
    const snapshot = await window.bonfire.terminal.snapshot(id);
    if (!mounted || terminalId !== id) return;
    term.write(snapshot.data);
    activity.output(snapshot.data.length);
    lastSequence = snapshot.sequence;
    exited = snapshot.exitCode !== undefined;
    if (snapshot.exitCode !== undefined) exitLine(snapshot.exitCode);
    ready = true;
    pendingEvents.forEach(receive);
    pendingEvents = [];
    sentSize = '';
    fitNow();
    if (focus) term.focus();
  }

  async function launch() {
    starting = true;
    error = '';
    try {
      const id = await window.bonfire.terminal.create({
        workspaceId,
        paneId,
        type: 'shell',
      });
      await attach(id, true);
    } catch (cause) {
      reportError(cause);
    } finally {
      starting = false;
    }
  }

  function relaunch() {
    term.clear();
    void launch();
  }

  function resize() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(fitNow, RESIZE_SETTLE_MS);
  }

  function fitNow() {
    clearTimeout(resizeTimer);
    if (!mounted || !terminalId) return;
    fit.fit();
    const size = `${term.cols}×${term.rows}`;
    if (size === sentSize) return;
    sentSize = size;
    window.bonfire.terminal
      .resize(terminalId, term.cols, term.rows)
      .catch(reportError);
  }

  function dropWebgl() {
    webgl?.dispose();
    webgl = undefined;
    renderer = 'dom';
  }

  /** Taken while in view; xterm goes back to its DOM renderer once the addon is let go. */
  const webglClaim: WebglClaim = {
    grant: () => {
      if (!mounted || webgl) return;
      try {
        const addon = new WebglAddon();
        // A lost context, as when the GPU resets, leaves the DOM renderer to carry on.
        addon.onContextLoss(() => {
          dropWebgl();
          webglPool.lost(webglClaim);
        });
        term.loadAddon(addon);
        webgl = addon;
        renderer = 'webgl';
      } catch (cause) {
        console.warn(
          `WebGL is unavailable; terminals draw without it: ${errorMessage(cause)}`,
        );
        webglPool.disable();
      }
    },
    revoke: dropWebgl,
  };

  /** A busy terminal in view asks for WebGL; one gone quiet gives it back. */
  const activity = new OutputActivity((busy) => {
    if (busy && inView) webglPool.want(webglClaim);
    else if (!busy) webglPool.release(webglClaim);
  });

  // A script pane shows whichever process its script last started.
  $effect(() => {
    const id = runTerminalId;
    if (!opened || !id || id === terminalId) return;
    attach(id, false).catch(reportError);
  });

  onMount(() => {
    mounted = true;
    term = new Terminal({
      fontSize: 13,
      fontFamily: '"SFMono-Regular", Menlo, monospace',
      // Transparent, so the pane's own (accent-tinted) background shows through.
      allowTransparency: true,
      theme: { background: '#00000000', foreground: '#dedede' },
      cursorBlink: true,
      scrollback: 10_000,
    });
    fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    openTerm = term;

    const input = term.onData((data) => {
      if (terminalId && !exited)
        window.bonfire.terminal.write(terminalId, data).catch(reportError);
    });
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    // Only busy terminals in view hold one of the page's few WebGL contexts.
    const visibility = new IntersectionObserver(([entry]) => {
      inView = entry.isIntersecting;
      if (!inView) webglPool.release(webglClaim);
      else if (activity.isBusy) webglPool.want(webglClaim);
    });
    visibility.observe(host);
    opened = true;
    if (!scriptId) void launch();

    return () => {
      mounted = false;
      clearTimeout(resizeTimer);
      stopEvents?.();
      input.dispose();
      observer.disconnect();
      visibility.disconnect();
      activity.close();
      webglPool.release(webglClaim);
      term.dispose();
    };
  });
</script>

<div class="absolute inset-0 flex flex-col px-5 py-4" bind:this={surface}>
  {#if error}<p class="pb-3 text-sm text-destructive">{error}</p>{/if}
  {#if scriptId}
    {#if !runTerminalId}
      <p class="pb-3 text-sm text-muted-foreground">
        Not running. Start it with Run above.
      </p>
    {/if}
  {:else if error || exited}
    <div class="pb-3">
      <Button variant="secondary" disabled={starting} onclick={relaunch}>
        Relaunch terminal
      </Button>
    </div>
  {/if}
  <!-- xterm keeps a gutter for its scroller (hidden below); it takes the padding's place. -->
  <div
    class="-mr-3.5 min-h-0 flex-1"
    data-renderer={renderer}
    bind:this={host}
  ></div>
  <TerminalScrollbar term={openTerm} {surface} />
</div>

<style>
  /* xterm paints its viewport black; let the pane's background show through instead. */
  :global(.xterm .xterm-viewport) {
    background-color: transparent !important;
  }
  /* Its always-there scroller gives way to the macOS-style overlay at the pane's edge. */
  :global(.xterm .xterm-scrollable-element > .scrollbar) {
    display: none !important;
  }
</style>
