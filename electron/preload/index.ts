import {
  contextBridge,
  ipcRenderer,
  webUtils,
  type IpcRendererEvent,
} from 'electron';
import { events, requests, type API } from '../../shared/contracts';

const api: Record<string, Record<string, unknown>> = {};

for (const channel of Object.keys(requests)) {
  const [group, method] = channel.split('.');
  (api[group] ??= {})[method] = (...args: unknown[]) =>
    ipcRenderer.invoke(channel, ...args);
}

function subscribe(channel: string) {
  return (listener: (data: unknown) => void) => {
    const handler = (_event: IpcRendererEvent, data: unknown) => listener(data);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  };
}

/**
 * The page's own channel to the terminal host, asked for as the page loads. Terminal output
 * arrives on it, and typing, resizes and what has been drawn go back on it, without passing
 * through main. Main still says when a terminal ends because the host stopped.
 */
let terminalPort: MessagePort | undefined;
const terminalListeners = new Set<(data: unknown) => void>();
/** Typing and the like sent before the channel opened, sent as it does. */
let unsent: unknown[] = [];
ipcRenderer.on(events.terminalPort, ({ ports: [port] }) => {
  terminalPort?.close();
  terminalPort = port;
  port.onmessage = ({ data }) => {
    for (const listener of terminalListeners) listener(data);
  };
  for (const message of unsent) port.postMessage(message);
  unsent = [];
});
ipcRenderer.send(events.terminalPort);

/** Sends to the terminal host over the page's channel; there is no other way to it. */
function toTerminalHost(channel: string) {
  return (...args: unknown[]) => {
    const message = { channel, args };
    if (terminalPort) terminalPort.postMessage(message);
    else unsent.push(message);
    return Promise.resolve();
  };
}

api.app.pathForFile = (file: File) => webUtils.getPathForFile(file);
api.terminal.onData = (listener: (data: unknown) => void) => {
  const fromHost = (data: unknown) => listener(data);
  terminalListeners.add(fromHost);
  const stopFromMain = subscribe(events.terminalData)(listener);
  return () => {
    terminalListeners.delete(fromHost);
    stopFromMain();
  };
};
api.terminal.write = toTerminalHost('terminal.write');
api.terminal.resize = toTerminalHost('terminal.resize');
api.terminal.ack = toTerminalHost('terminal.ack');
api.assistant.onEvent = subscribe(events.assistantEvent);
api.filesystem.onChange = subscribe(events.fileChange);
api.app.onFullscreenChange = subscribe(events.fullscreen);
api.app.onFocusPane = subscribe(events.focusPane);
api.app.onNotificationsBlocked = subscribe(events.notificationsBlocked);
api.panes.onClosed = subscribe(events.panesClosed);
api.workspaces.onChange = subscribe(events.workspacesChanged);
api.github.onSignInEnd = subscribe(events.githubSignInEnd);
api.scripts.onRun = subscribe(events.scriptRun);
api.dictation.onEvent = subscribe(events.dictationEvent);

contextBridge.exposeInMainWorld('bonfire', api as unknown as API);
contextBridge.exposeInMainWorld(
  'bonfireDemoStatuses',
  ipcRenderer.sendSync('demo-statuses'),
);
