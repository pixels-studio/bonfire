/**
 * The terminal host: a utility process that runs every terminal's PTY. Output goes from here
 * straight to the window over a port of its own, and typing, resizes and what the window has
 * drawn come straight back, so terminal traffic never passes through the main process. Main
 * still starts and ends terminals, as it knows the projects and panes they belong to.
 */
import type { MessagePortMain } from 'electron';
import * as pty from 'node-pty';
import {
  terminalHostRequests,
  type TerminalEvent,
} from '../../shared/contracts';
import { parentEndpoint } from './host-endpoint';
import { PtyHost } from './pty-host';
import { Rpc, forwardConsole } from './rpc';

type WindowChannel = keyof typeof terminalHostRequests;

// On Windows, node-pty ends a shell with the help of a script it forks, and fork runs the
// app's binary. As in main, that binary must run the script as Node, not start another app.
// Shells don't inherit this: main gives each terminal its environment.
if (process.platform === 'win32') process.env.ELECTRON_RUN_AS_NODE = '1';

let window: MessagePortMain | undefined;

const ptys = new PtyHost(
  (command) =>
    pty.spawn(command.file, command.args, {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: command.cwd,
      env: command.env,
    }),
  (event: TerminalEvent) => {
    window?.postMessage(event);
    // Main follows exits, as run scripts end with them.
    if (event.exitCode !== undefined) main.emit('exit', event);
  },
);

const main = new Rpc(parentEndpoint(attachWindow), {
  create: (owner, command) => ptys.create(owner, command),
  run: (owner, command) => ptys.run(owner, command),
  stop: (id) => ptys.stop(id),
  snapshot: (id) => ptys.snapshot(id),
  ack: (id, chars) => ptys.ack(id, chars),
  write: (id, data) => ptys.write(id, data),
  resize: (id, cols, rows) => ptys.resize(id, cols, rows),
  closePane: (paneId) => ptys.closePane(paneId),
  closeProject: (projectId) => ptys.closeProject(projectId),
  close: () => ptys.close(),
});
forwardConsole(main);

/** Takes the window's port, which replaces the one of a page since reloaded. */
function attachWindow(_message: unknown, port: MessagePortMain) {
  window?.close();
  window = port;
  port.on('message', ({ data }) => receive(data));
  port.on('close', () => {
    if (window === port) window = undefined;
  });
  port.start();
}

function receive(message: unknown) {
  const { channel, args } = (message ?? {}) as {
    channel?: string;
    args?: unknown;
  };
  // Checked as main checks its requests: the window is trusted no further here.
  if (!channel || !Object.hasOwn(terminalHostRequests, channel)) return;
  const parsed = terminalHostRequests[channel as WindowChannel].safeParse(args);
  if (!parsed.success) return;
  try {
    const [id, ...rest] = parsed.data;
    if (channel === 'terminal.write') ptys.write(id, rest[0] as string);
    else if (channel === 'terminal.resize')
      ptys.resize(id, rest[0] as number, rest[1] as number);
    else ptys.ack(id, rest[0] as number);
  } catch {
    // The terminal ended meanwhile; there is nothing to type into.
  }
}
