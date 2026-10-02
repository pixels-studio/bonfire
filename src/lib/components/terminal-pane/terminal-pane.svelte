<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { Terminal } from '@xterm/xterm';
  import { FitAddon } from '@xterm/addon-fit';
  import '@xterm/xterm/css/xterm.css';
  import type { Pane, TerminalEvent } from '$shared/contracts';
  let {
    pane,
    active,
    fontSize = 13,
    onstatus,
  }: {
    pane: Pane;
    active: boolean;
    fontSize?: number;
    onstatus: (id: string, running: boolean) => void;
  } = $props();
  let host: HTMLDivElement;
  let term: Terminal;
  let fit: FitAddon;
  let terminalId: string | undefined;
  let error = $state('');
  let exited = $state(false);
  let starting = $state(false);
  let mounted = false;
  let observer: ResizeObserver;
  let queue: TerminalEvent[] = [];
  let ready = false;
  let lastSequence = 0;
  const receive = (e: TerminalEvent) => {
    if (e.terminalId !== terminalId || e.sequence <= lastSequence) return;
    lastSequence = e.sequence;
    if (e.data) term.write(e.data);
    if (e.exitCode !== undefined) {
      exited = true;
      onstatus(pane.id, false);
      term.writeln(`\r\n[Process exited: ${e.exitCode}]`);
    }
  };
  async function launch() {
    starting = true;
    ready = false;
    lastSequence = 0;
    error = '';
    try {
      terminalId = await window.bonfire.terminal.create({
        sessionId: pane.sessionId,
        paneId: pane.id,
        type:
          pane.type === 'terminal'
            ? 'shell'
            : (pane.type as 'claude' | 'codex'),
      });
      const snapshot = await window.bonfire.terminal.snapshot(terminalId);
      if (!mounted) return;
      term.write(snapshot.data);
      lastSequence = snapshot.sequence;
      exited = snapshot.exitCode !== undefined;
      onstatus(pane.id, !exited);
      ready = true;
      for (const event of queue) receive(event);
      queue = [];
      await tick();
      resize();
    } catch (e) {
      error = String(e);
      onstatus(pane.id, false);
    } finally {
      starting = false;
    }
  }
  function resize() {
    if (!mounted || !active || !fit || !terminalId) return;
    fit.fit();
    void window.bonfire.terminal
      .resize(terminalId, term.cols, term.rows)
      .catch((e) => (error = String(e)));
    term.focus();
  }
  $effect(() => {
    if (active && mounted) {
      void tick().then(resize);
    }
    if (term) term.options.fontSize = fontSize;
  });
  onMount(() => {
    mounted = true;
    term = new Terminal({
      fontSize,
      fontFamily: '"SFMono-Regular",Menlo,monospace',
      theme: { background: '#1a1a1a', foreground: '#dedede' },
      cursorBlink: true,
      scrollback: 10000,
    });
    fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    const off = window.bonfire.terminal.onData((e) =>
      ready ? receive(e) : queue.push(e),
    );
    void launch();
    const input = term.onData((data) => {
      if (terminalId)
        void window.bonfire.terminal
          .write(terminalId, data)
          .catch((e) => (error = String(e)));
    });
    observer = new ResizeObserver(resize);
    observer.observe(host);
    return () => {
      mounted = false;
      off();
      input.dispose();
      observer.disconnect();
      term.dispose();
    };
  });
</script>

<div class="terminal-pane" class:invisible={!active}>
  {#if error}<div class="error">{error}</div>{/if}
  {#if error || exited}<div class="relaunch">
      <button
        disabled={starting}
        onclick={() => {
          term.clear();
          void launch();
        }}>Relaunch {pane.title}</button
      >
    </div>{/if}
  <div class="terminal-host" bind:this={host}></div>
</div>

<style>
  .terminal-pane {
    position: absolute;
    inset: 0;
    padding: 16px 20px;
    display: flex;
    flex-direction: column;
  }
  .invisible {
    visibility: hidden;
    pointer-events: none;
  }
  .terminal-host {
    flex: 1;
    min-height: 0;
  }
  .relaunch {
    padding-bottom: 12px;
  }
</style>
