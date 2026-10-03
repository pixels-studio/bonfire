<script lang="ts">
  import { onMount } from 'svelte';
  import { Terminal } from '@xterm/xterm';
  import { FitAddon } from '@xterm/addon-fit';
  import '@xterm/xterm/css/xterm.css';
  import { Button } from '$lib/components/ui/button';
  import { errorMessage } from '$shared/domain';
  import type { TerminalEvent } from '$shared/contracts';

  let {
    sessionId,
    paneId,
    type = 'shell',
    tab,
  }: {
    sessionId: string;
    /** Unset for the workspace's own terminal. */
    paneId?: string;
    /** `setup` shows the output of the workspace's setup script instead of a shell. */
    type?: 'shell' | 'setup';
    /** Which of the workspace's shells to show. */
    tab?: number;
  } = $props();

  let host: HTMLDivElement;
  let error = $state('');
  let exited = $state(false);
  let starting = $state(false);

  let term: Terminal;
  let fit: FitAddon;
  let terminalId: string | undefined;
  let mounted = false;
  let ready = false;
  let pendingEvents: TerminalEvent[] = [];
  let lastSequence = 0;

  function reportError(cause: unknown) {
    error = errorMessage(cause);
  }

  function receive(event: TerminalEvent) {
    if (event.terminalId !== terminalId || event.sequence <= lastSequence)
      return;
    lastSequence = event.sequence;
    if (event.data) term.write(event.data);
    if (event.exitCode !== undefined) {
      exited = true;
      term.writeln(`\r\n[Process exited: ${event.exitCode}]`);
    }
  }

  async function launch() {
    starting = true;
    ready = false;
    lastSequence = 0;
    error = '';
    try {
      terminalId = await window.bonfire.terminal.create({
        sessionId,
        paneId,
        type,
        tab,
      });
      const snapshot = await window.bonfire.terminal.snapshot(terminalId);
      if (!mounted) return;
      term.write(snapshot.data);
      lastSequence = snapshot.sequence;
      exited = snapshot.exitCode !== undefined;
      ready = true;
      pendingEvents.forEach(receive);
      pendingEvents = [];
      resize();
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
    term.focus();
  }

  onMount(() => {
    mounted = true;
    term = new Terminal({
      fontSize: 13,
      fontFamily: '"SFMono-Regular", Menlo, monospace',
      theme: { background: '#1a1a1a', foreground: '#dedede' },
      cursorBlink: true,
      scrollback: 10_000,
    });
    fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);

    const unsubscribe = window.bonfire.terminal.onData((event) =>
      ready ? receive(event) : pendingEvents.push(event),
    );
    const input = term.onData((data) => {
      if (terminalId)
        window.bonfire.terminal.write(terminalId, data).catch(reportError);
    });
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    void launch();

    return () => {
      mounted = false;
      unsubscribe();
      input.dispose();
      observer.disconnect();
      term.dispose();
    };
  });
</script>

<div class="absolute inset-0 flex flex-col px-5 py-4">
  {#if error}<p class="pb-3 text-sm text-destructive">{error}</p>{/if}
  {#if type === 'shell' && (error || exited)}
    <div class="pb-3">
      <Button variant="secondary" disabled={starting} onclick={relaunch}>
        Relaunch terminal
      </Button>
    </div>
  {/if}
  <div class="min-h-0 flex-1" bind:this={host}></div>
</div>
