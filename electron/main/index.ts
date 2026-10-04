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
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { setTimeout as wait } from 'node:timers/promises';
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
// Opened from Finder or the Dock, the app starts in `/`, and so does every process it starts
// without a folder of its own, such as the agents' background sessions for models, limits and
// titles. Claude Code lists the files of its folder as it starts, which from `/` walks Music,
// Photos, Contacts and every mounted volume, each a macOS privacy prompt. An empty folder of
// the app's own gives those processes nothing to walk.
if (process.cwd() === '/') {
  const idle = join(app.getPath('userData'), 'idle');
  mkdirSync(idle, { recursive: true });
  process.chdir(idle);
}
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
/** How long quitting waits for the backend to close, such as for a save to land. */
const CLOSE_TIMEOUT_MS = 5000;
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

/** Appends to `bonfire.log` in the data folder, which says what happened when a window hangs or dies. */
function log(message: string) {
  try {
    appendFileSync(
      join(app.getPath('userData'), 'bonfire.log'),
      `${new Date().toISOString()} ${message}\n`,
    );
  } catch {
    // Logging must never be the thing that breaks.
  }
}

const STALL_CHECK_MS = 250;
const STALL_LOG_MS = 500;

/** Logs when the main process was kept from its timers, which freezes everything that waits on it. */
function watchEventLoop() {
  let last = Date.now();
  setInterval(() => {
    const now = Date.now();
    const stalled = now - last - STALL_CHECK_MS;
    last = now;
    if (stalled >= STALL_LOG_MS) log(`Main process stalled for ${stalled} ms`);
  }, STALL_CHECK_MS).unref();
}

function watchHealth(window: BrowserWindow) {
  window.webContents.on('console-message', (event) => {
    if (event.message.startsWith('[perf]')) log(event.message);
  });
  window.on('unresponsive', () => log('Window became unresponsive'));
  window.on('responsive', () => log('Window responsive again'));
  window.webContents.on('render-process-gone', (_event, details) =>
    log(`Renderer gone: ${details.reason} (exit code ${details.exitCode})`),
  );
}

watchEventLoop();
app.on('child-process-gone', (_event, details) =>
  log(
    `${details.type} process gone: ${details.reason} (${details.name ?? ''})`,
  ),
);
// A main-process error would otherwise only show as a dialog, which looks like a hang.
process.on('uncaughtException', (error) =>
  console.error(`Uncaught exception: ${error.stack ?? error}`),
);
process.on('unhandledRejection', (reason) =>
  console.error(
    `Unhandled rejection: ${reason instanceof Error ? reason.stack : String(reason)}`,
  ),
);
// Warnings, such as a save that failed and will be retried, land in the log too.
for (const level of ['warn', 'error'] as const) {
  const write = console[level].bind(console);
  console[level] = (...args: unknown[]) => {
    write(...args);
    log(`${level}: ${args.map(String).join(' ')}`);
  };
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1280,
    minHeight: 550,
    backgroundColor: '#111111',
    title: 'Bonfire',
    icon: resolve(__dirname, '../../static/icon.png'),
    // On macOS the native traffic lights sit over the header, and on Windows the native window
    // buttons do; elsewhere the regular frame is kept so the window keeps its native controls.
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hidden', trafficLightPosition: { x: 16, y: 20 } }
      : process.platform === 'win32'
        ? {
            titleBarStyle: 'hidden',
            titleBarOverlay: {
              color: '#111111',
              symbolColor: '#ffffff',
              height: 52,
            },
          }
        : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  // Without a menu bar the header is the whole title bar, as in VS Code.
  if (process.platform === 'win32') mainWindow.removeMenu();
  watchHealth(mainWindow);
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isTrustedUrl(url)) event.preventDefault();
  });
  // The window needs no web permissions (camera, microphone, location, and the like).
  mainWindow.webContents.session.setPermissionRequestHandler(
    (_contents, _permission, callback) => callback(false),
  );
  mainWindow.webContents.session.setPermissionCheckHandler(() => false);
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
    // Packaged builds take the icon from the bundle; in development this replaces Electron's.
    app.dock?.setIcon(resolve(__dirname, '../../static/icon.png'));
    backend = services({
      dataDirectory: app.getPath('userData'),
      chooseDirectory: async () => {
        const result = await dialog.showOpenDialog(mainWindow, {
          properties: ['openDirectory'],
        });
        return result.canceled ? undefined : result.filePaths[0];
      },
      chooseIdentity: async () => {
        const result = await dialog.showOpenDialog(mainWindow, {
          title: 'Choose a private key',
          defaultPath: join(homedir(), '.ssh'),
          properties: ['openFile', 'showHiddenFiles'],
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
/** Quitting waits for the backend to close, briefly, so a save being written lands. */
let closing: Promise<void> | undefined;
app.on('before-quit', (event) => {
  if (closing || !backend) return;
  event.preventDefault();
  closing = Promise.race([backend.close(), wait(CLOSE_TIMEOUT_MS)])
    .catch((cause) => console.error(`Could not close cleanly: ${cause}`))
    .then(() => app.quit());
});
