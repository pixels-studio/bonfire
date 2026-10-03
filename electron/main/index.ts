import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Notification,
  powerSaveBlocker,
  protocol,
  net,
  shell,
} from 'electron';
import { basename, join, resolve, relative, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { homedir } from 'node:os';
import { events, requests } from '../../shared/contracts';
import { dischargingLevel } from './keep-awake';
import type { Notice } from './notifier';
import { services } from './services';
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'bonfire',
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
]);
app.setName('Bonfire');
if (process.env.BONFIRE_USER_DATA)
  app.setPath('userData', process.env.BONFIRE_USER_DATA);
process.env.PATH = [
  process.env.PATH,
  join(homedir(), '.local/bin'),
  join(homedir(), '.npm-global/bin'),
  '/opt/homebrew/bin',
  '/usr/local/bin',
]
  .filter(Boolean)
  .join(process.platform === 'win32' ? ';' : ':');
const DEV_URL = process.env.BONFIRE_DEV_URL;
const HELP_URL = 'https://artifacts.studio/helm';
const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif'];

let mainWindow: BrowserWindow;
let backend: ReturnType<typeof services>;
/** Notifications are held until dismissed, as macOS drops click handlers of collected ones. */
const shownNotices = new Set<Notification>();
/** Whether the user has been told the OS is refusing notifications, which is said once. */
let reportedBlocked = false;

/**
 * The name the OS lists the app under in its notification settings: the app bundle's,
 * which during development is Electron's rather than Bonfire's.
 */
function bundleName() {
  return /([^/]+)\.app\//.exec(process.execPath)?.[1] ?? app.getName();
}

function isTrustedUrl(url: string) {
  const { origin, protocol, hostname } = new URL(url);
  return DEV_URL
    ? origin === new URL(DEV_URL).origin
    : protocol === 'bonfire:' && hostname === 'app';
}

function send(channel: string, data: unknown) {
  if (mainWindow && !mainWindow.isDestroyed())
    mainWindow.webContents.send(channel, data);
}

/** Notifies only while the app is in the background; in front, the pane itself shows it. */
function notify({ paneId, title, body }: Notice) {
  if (!Notification.isSupported() || mainWindow.isFocused()) return;
  const notification = new Notification({ title, body });
  const release = () => shownNotices.delete(notification);
  notification.on('click', () => {
    release();
    mainWindow.show();
    mainWindow.focus();
    send(events.focusPane, paneId);
  });
  notification.on('close', release);
  // macOS refuses silently unless notifications are allowed for the app in System Settings.
  notification.on('failed', (_event, error) => {
    release();
    console.warn(`Notification failed: ${error}`);
    if (reportedBlocked) return;
    reportedBlocked = true;
    send(events.notificationsBlocked, bundleName());
  });
  shownNotices.add(notification);
  notification.show();
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1280,
    minHeight: 550,
    backgroundColor: '#111111',
    title: 'Bonfire',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 20, y: 19 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isTrustedUrl(url)) event.preventDefault();
  });
  mainWindow.webContents.session.setPermissionRequestHandler(
    (_contents, _permission, callback) => callback(false),
  );
  mainWindow.on('enter-full-screen', () => send(events.fullscreen, true));
  mainWindow.on('leave-full-screen', () => send(events.fullscreen, false));
  mainWindow.webContents.on('did-finish-load', () =>
    send(events.fullscreen, mainWindow.isFullScreen()),
  );
  await mainWindow.loadURL(DEV_URL || 'bonfire://app/');
}

function serveBuild(root: string) {
  protocol.handle('bonfire', (request) => {
    const url = new URL(request.url);
    const pathname = url.pathname === '/' ? '/index.html' : url.pathname;
    const path = resolve(root, `.${decodeURIComponent(pathname)}`);
    const relativePath = relative(root, path);
    if (
      url.host !== 'app' ||
      relativePath.startsWith('..') ||
      isAbsolute(relativePath)
    )
      return new Response('Forbidden', { status: 403 });
    return net.fetch(pathToFileURL(path).href);
  });
}

/** Routes each validated IPC channel to `backend.api[group][method]`, trusting only our main frame. */
function registerIpc() {
  const api = backend.api as unknown as Record<
    string,
    Record<string, (...args: unknown[]) => unknown>
  >;
  for (const [channel, schema] of Object.entries(requests)) {
    const [group, method] = channel.split('.');
    ipcMain.handle(channel, async (event, ...args) => {
      if (
        event.sender !== mainWindow.webContents ||
        event.senderFrame !== mainWindow.webContents.mainFrame ||
        !isTrustedUrl(event.senderFrame.url)
      )
        throw Error('Untrusted IPC sender');
      return api[group][method](...schema.parse(args));
    });
  }
}

app
  .whenReady()
  .then(async () => {
    serveBuild(resolve(__dirname, '../../build'));
    backend = services({
      dataDirectory: app.getPath('userData'),
      chooseDirectory: async () => {
        const result = await dialog.showOpenDialog(mainWindow, {
          properties: ['openDirectory'],
        });
        return result.canceled ? undefined : result.filePaths[0];
      },
      chooseImage: async () => {
        const result = await dialog.showOpenDialog(mainWindow, {
          properties: ['openFile'],
          filters: [{ name: 'Images', extensions: IMAGE_EXTENSIONS }],
        });
        if (result.canceled) return undefined;
        const [path] = result.filePaths;
        return { name: basename(path), path };
      },
      send,
      openHelp: () => shell.openExternal(HELP_URL),
      openUrl: (url) => shell.openExternal(url),
      copyText: (text) => clipboard.writeText(text),
      isFullscreen: () => mainWindow.isFullScreen(),
      notify,
      power: {
        start: () => powerSaveBlocker.start('prevent-app-suspension'),
        stop: (blocker) => powerSaveBlocker.stop(blocker),
        dischargingLevel,
      },
    });
    registerIpc();
    await createWindow();
    if (process.env.BONFIRE_SMOKE) {
      const { smoke } = await import('./smoke');
      await smoke(mainWindow, backend);
      app.quit();
    }
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });

app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => {
  void backend?.close();
});
