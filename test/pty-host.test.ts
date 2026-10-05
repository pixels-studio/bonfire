import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TerminalEvent } from '../shared/contracts';
import type { TerminalCommand } from '../electron/main/machines';
import { PtyHost, type Pty } from '../electron/main/pty-host';
import { HIGH_WATER_CHARS } from '../electron/main/terminal-flow';
import { sleep } from './helpers';

class FakePty implements Pty {
  written: string[] = [];
  paused = false;
  killed = false;
  size = '';
  private data?: (data: string) => void;
  private exit?: (event: { exitCode: number }) => void;
  constructor(
    readonly command: TerminalCommand,
    /** Whether Ctrl-C ends it, as a well-behaved server's does. */
    private readonly endsOnInterrupt = true,
  ) {}
  onData(listener: (data: string) => void) {
    this.data = listener;
  }
  onExit(listener: (event: { exitCode: number }) => void) {
    this.exit = listener;
  }
  write(data: string) {
    this.written.push(data);
    if (data === '\x03' && this.endsOnInterrupt) this.end(130);
  }
  resize(cols: number, rows: number) {
    this.size = `${cols}×${rows}`;
  }
  pause() {
    this.paused = true;
  }
  resume() {
    this.paused = false;
  }
  kill() {
    this.killed = true;
    this.end(1);
  }
  output(data: string) {
    this.data?.(data);
  }
  end(exitCode: number) {
    this.exit?.({ exitCode });
  }
}

function setUp(endsOnInterrupt = true) {
  const spawned: FakePty[] = [];
  const events: TerminalEvent[] = [];
  const host = new PtyHost(
    (command) => {
      const pty = new FakePty(command, endsOnInterrupt);
      spawned.push(pty);
      return pty;
    },
    (event) => events.push(event),
    20,
  );
  return { host, spawned, events };
}

const shell: TerminalCommand = { file: 'zsh', args: [], cwd: '/tmp', env: {} };
const owner = { projectId: 'project', paneId: 'pane', type: 'shell' as const };

test("a pane's running shell is reused, and one that exited is replaced and forgotten", () => {
  const { host, spawned } = setUp();
  const first = host.create(owner, shell);
  assert.equal(host.create(owner, shell), first);
  assert.equal(spawned.length, 1);
  spawned[0].end(0);
  const second = host.create(owner, shell);
  assert.notEqual(second, first);
  assert.throws(() => host.snapshot(first), /Terminal not found/);
});

test('output is batched to the window, kept as scrollback, and ends with an exit', async () => {
  const { host, spawned, events } = setUp();
  const id = host.create(owner, shell);
  spawned[0].output('one ');
  spawned[0].output('two');
  await sleep(20);
  assert.deepEqual(events, [{ terminalId: id, sequence: 1, data: 'one two' }]);
  spawned[0].output('!');
  spawned[0].end(0);
  assert.deepEqual(events.slice(1), [
    { terminalId: id, sequence: 2, data: '!' },
    { terminalId: id, sequence: 3, exitCode: 0 },
  ]);
  assert.deepEqual(host.snapshot(id), {
    data: 'one two!',
    sequence: 3,
    exitCode: 0,
  });
  // A terminal that ended takes no more typing or resizing.
  host.write(id, 'ls\r');
  host.resize(id, 100, 30);
  assert.deepEqual(spawned[0].written, []);
  assert.equal(spawned[0].size, '');
});

test('a program the window falls behind on is paused until it catches up', async () => {
  const { host, spawned } = setUp();
  const id = host.create(owner, shell);
  host.ack(id, 0);
  spawned[0].output('x'.repeat(HIGH_WATER_CHARS + 1));
  await sleep(20);
  assert.equal(spawned[0].paused, true);
  host.ack(id, HIGH_WATER_CHARS + 1);
  assert.equal(spawned[0].paused, false);
});

test('a script run stops what the pane ran before, hanging up on one that ignores Ctrl-C', async () => {
  const { host, spawned } = setUp(false);
  const script = { ...owner, type: 'script' as const };
  const first = await host.run(script, shell);
  const second = await host.run(script, { ...shell, file: 'npm' });
  assert.notEqual(second, first);
  assert.deepEqual(spawned[0].written, ['\x03']);
  assert.equal(spawned[0].killed, true);
  assert.throws(() => host.snapshot(first), /Terminal not found/);
  assert.equal(spawned[1].command.file, 'npm');
});

test('closing a pane or project ends and forgets their terminals', () => {
  const { host, spawned } = setUp();
  const kept = host.create({ ...owner, paneId: 'other' }, shell);
  const closed = host.create(owner, shell);
  host.closePane('pane');
  assert.equal(spawned[1].killed, true);
  assert.throws(() => host.snapshot(closed), /Terminal not found/);
  assert.equal(host.snapshot(kept).exitCode, undefined);
  host.closeProject('project');
  assert.equal(spawned[0].killed, true);
  assert.throws(() => host.snapshot(kept), /Terminal not found/);
});

test('a program that cannot start says which', () => {
  const host = new PtyHost(
    () => {
      throw Error('ENOENT');
    },
    () => {},
  );
  assert.throws(() => host.create(owner, shell), /Could not launch zsh/);
});
