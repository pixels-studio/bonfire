<script lang="ts">
  import { onMount } from 'svelte';
  import { Terminal } from '@xterm/xterm';
  import { FitAddon } from '@xterm/addon-fit';
  import '@xterm/xterm/css/xterm.css';
  import { Button } from '$lib/components/ui/button';
  import TerminalScrollbar from './terminal-scrollbar.svelte';
  import { scripts } from '$lib/stores/scripts.svelte';
  import { errorMessage } from '$shared/domain';
  import type { TerminalEvent } from '$shared/contracts';

  let {
    projectId,
    paneId,
    scriptId,
  }: {
    projectId: string;
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
  let terminalId: string | undefined;
  let mounted = false;
  let ready = false;
  let pendingEvents: TerminalEvent[] = [];
  let lastSequence = 0;

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

  function receive(event: TerminalEvent) {
    if (event.terminalId !== terminalId || event.sequence <= lastSequence)
      return;
    lastSequence = event.sequence;
    if (event.data) term.write(event.data);
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
    term.reset();
    const snapshot = await window.bonfire.terminal.snapshot(id);
    if (!mounted || terminalId !== id) return;
    term.write(snapshot.data);
    lastSequence = snapshot.sequence;
    exited = snapshot.exitCode !== undefined;
    if (snapshot.exitCode !== undefined) exitLine(snapshot.exitCode);
    ready = true;
    pendingEvents.forEach(receive);
    pendingEvents = [];
    resize();
    if (focus) term.focus();
  }

  async function launch() {
    starting = true;
    error = '';
    try {
      const id = await window.bonfire.terminal.create({
        projectId,
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
    if (!mounted || !terminalId) return;
    fit.fit();
    window.bonfire.terminal
      .resize(terminalId, term.cols, term.rows)
      .catch(reportError);
  }

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

    // Until the snapshot is in, this terminal's output waits. Others' is no concern of this
    // pane, and holding it would grow without end while a script isn't running.
    const unsubscribe = window.bonfire.terminal.onData((event) => {
      if (ready) receive(event);
      else if (terminalId && event.terminalId === terminalId)
        pendingEvents.push(event);
    });
    const input = term.onData((data) => {
      if (terminalId && !exited)
        window.bonfire.terminal.write(terminalId, data).catch(reportError);
    });
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    opened = true;
    if (!scriptId) void launch();

    return () => {
      mounted = false;
      unsubscribe();
      input.dispose();
      observer.disconnect();
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
  <div class="-mr-3.5 min-h-0 flex-1" bind:this={host}></div>
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
