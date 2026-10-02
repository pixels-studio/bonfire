import { contextBridge, ipcRenderer } from 'electron';
import type { API } from '../../shared/contracts';
const groups: Record<string, string[]> = {
  state: ['get'],
  projects: ['list', 'add', 'remove', 'select', 'favicon'],
  sessions: ['create', 'select', 'remove'],
  panes: ['add', 'select', 'remove', 'archive'],
  assistant: ['send', 'cancel', 'pickAttachment'],
  navigation: ['help'],
  app: ['isFullscreen'],
  terminal: ['create', 'write', 'resize', 'kill', 'snapshot'],
  git: ['status', 'branches', 'diff', 'checkout'],
  filesystem: ['list', 'readFile', 'stat', 'watch', 'unwatch'],
  settings: ['update'],
};
const api: Record<string, Record<string, unknown>> = {};
for (const [group, methods] of Object.entries(groups)) {
  api[group] = {};
  for (const method of methods)
    api[group][method] = (...args: unknown[]) =>
      ipcRenderer.invoke(group + '.' + method, ...args);
}
function subscribe(channel: string, fn: (data: unknown) => void) {
  const listener = (_event: Electron.IpcRendererEvent, data: unknown) =>
    fn(data);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}
api.terminal.onData = (fn: (data: unknown) => void) =>
  subscribe('terminal:data', fn);
api.assistant.onEvent = (fn: (data: unknown) => void) =>
  subscribe('assistant:event', fn);
api.filesystem.onChange = (fn: (data: unknown) => void) =>
  subscribe('filesystem:change', fn);
api.app.onFullscreenChange = (fn: (data: unknown) => void) =>
  subscribe('window:fullscreen', fn);
contextBridge.exposeInMainWorld('bonfire', api as unknown as API);
