import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
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

api.terminal.onData = subscribe(events.terminalData);
api.assistant.onEvent = subscribe(events.assistantEvent);
api.filesystem.onChange = subscribe(events.fileChange);
api.app.onFullscreenChange = subscribe(events.fullscreen);
api.app.onFocusPane = subscribe(events.focusPane);
api.app.onNotificationsBlocked = subscribe(events.notificationsBlocked);
api.panes.onClosed = subscribe(events.panesClosed);
api.workspaces.onSetup = subscribe(events.workspaceSetup);
api.workspaces.onChanged = subscribe(events.workspacesChanged);
api.github.onSignInEnd = subscribe(events.githubSignInEnd);

contextBridge.exposeInMainWorld('bonfire', api as unknown as API);
