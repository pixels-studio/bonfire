import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  MessageChannelMain,
  Notification,
  powerMonitor,
  powerSaveBlocker,
  protocol,
  net,
  session,
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
const PING_EVERY_MS = 2000;
/** How long the page may take to answer a ping before it is called stuck. */
const PING_LATE_MS = 2000;

/** What each Electron process is using, which says which one is pegged when the window freezes. */
function processSnapshot() {
  return app
    .getAppMetrics()
    .map(
      ({ type, pid, cpu, memory }) =>
        `${type}#${pid} cpu ${cpu.percentCPUUsage.toFixed(0)}% mem ${Math.round(memory.workingSetSize / 1024)} MB`,
    )
    .join(', ');
}

/** Logs when the main process was kept from its timers, which freezes everything that waits on it. */
function watchEventLoop() {
  let last = Date.now();
  setInterval(() => {
    const now = Date.now();
    const stalled = now - last - STALL_CHECK_MS;
    last = now;
    if (stalled >= STALL_LOG_MS)
      log(`Main process stalled for ${stalled} ms [${processSnapshot()}]`);
  }, STALL_CHECK_MS).unref();
}

/**
 * Pings the page and logs while it doesn't answer. A page stuck in one long task never gets to
 * report it, so this is what says the page is frozen, for how long, and what the processes are doing.
 */
function watchPage(window: BrowserWindow) {
  let waitingSince = 0;
  const timer = setInterval(() => {
    if (window.isDestroyed()) return clearInterval(timer);
    if (waitingSince) {
      log(
        `Page not answering for ${Date.now() - waitingSince} ms [${processSnapshot()}]`,
      );
      return;
    }
    const sent = Date.now();
    waitingSince = sent;
    window.webContents
      .executeJavaScript('0')
      .catch(() => undefined)
      .then(() => {
        const late = Date.now() - sent;
        if (late >= PING_LATE_MS) log(`Page answered after ${late} ms`);
        waitingSince = 0;
      });
  }, PING_EVERY_MS);
  timer.unref();
}

/** F12 or Ctrl+Shift+I (Cmd+Option+I) opens the developer tools, as the menu bar can't on Windows. */
function allowDevTools(window: BrowserWindow) {
  window.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const inspector =
      input.key.toLowerCase() === 'i' &&
      (process.platform === 'darwin'
        ? input.meta && input.alt
        : input.control && input.shift);
    if (input.key !== 'F12' && !inspector) return;
    event.preventDefault();
    window.webContents.toggleDevTools();
  });
}

function watchHealth(window: BrowserWindow) {
  window.webContents.on('console-message', (event) => {
    if (event.message.startsWith('[perf]')) log(event.message);
  });
  window.on('unresponsive', () =>
    log(`Window became unresponsive [${processSnapshot()}]`),
  );
  window.on('responsive', () => log('Window responsive again'));
  window.webContents.on('render-process-gone', (_event, details) =>
    log(`Renderer gone: ${details.reason} (exit code ${details.exitCode})`),
  );
  watchPage(window);
  allowDevTools(window);
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
      // The browser pane shows pages in a <webview>, locked down below.
      webviewTag: true,
    },
  });
  guardBrowserPane(mainWindow);
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
  // What waited while the window was hidden catches up as it comes back.
  const catchUp = () => void backend.cameIntoView();
  mainWindow.on('show', catchUp);
  mainWindow.on('restore', catchUp);
  mainWindow.on('focus', catchUp);
  mainWindow.on('enter-full-screen', () => send(events.fullscreen, true));
  mainWindow.on('leave-full-screen', () => send(events.fullscreen, false));
  mainWindow.webContents.on('did-finish-load', () =>
    send(events.fullscreen, mainWindow.isFullScreen()),
  );
  await mainWindow.loadURL(DEV_URL || 'bonfire://app/');
}

/** The session browser panes share, kept apart from the app's own. */
const BROWSER_PARTITION = 'persist:browser';
/** What a page in the browser pane may ask for; everything else is refused. */
const BROWSER_PERMISSIONS = new Set([
  'clipboard-sanitized-write',
  'fullscreen',
  'pointerLock',
]);

const isWebUrl = (url: string) => /^https?:\/\//i.test(url);

/**
 * The browser pane's <webview> shows untrusted pages, so each one is attached with no
 * preload, no Node, in a sandbox and its own session, and only to web URLs. Pages
 * that open a window open it in the pane instead.
 */
function guardBrowserPane(window: BrowserWindow) {
  const browserSession = session.fromPartition(BROWSER_PARTITION);
  browserSession.setPermissionRequestHandler(
    (_contents, permission, callback) =>
      callback(BROWSER_PERMISSIONS.has(permission)),
  );
  browserSession.setPermissionCheckHandler((_contents, permission) =>
    BROWSER_PERMISSIONS.has(permission),
  );
  window.webContents.on('will-attach-webview', (event, preferences, params) => {
    delete preferences.preload;
    preferences.nodeIntegration = false;
    preferences.nodeIntegrationInSubFrames = false;
    preferences.contextIsolation = true;
    preferences.sandbox = true;
    preferences.webSecurity = true;
    preferences.allowRunningInsecureContent = false;
    preferences.partition = BROWSER_PARTITION;
    if (
      params.partition !== BROWSER_PARTITION ||
      (params.src && !isWebUrl(params.src))
    )
      event.preventDefault();
  });
  window.webContents.on('did-attach-webview', (_event, guest) => {
    guest.setWindowOpenHandler(({ url }) => {
      if (isWebUrl(url)) void guest.loadURL(url);
      return { action: 'deny' };
    });
    guest.on('will-navigate', (event, url) => {
      if (!isWebUrl(url)) event.preventDefault();
    });
  });
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

/** Whether an IPC message came from our own page in the main frame. */
function isTrustedSender(
  event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent,
) {
  return (
    event.sender === mainWindow.webContents &&
    event.senderFrame === mainWindow.webContents.mainFrame &&
    isTrustedUrl(event.senderFrame.url)
  );
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
      if (!isTrustedSender(event)) throw Error('Untrusted IPC sender');
      return api[group][method](...schema.parse(args));
    });
  }
  // Each page load asks for a channel straight to the terminal host, which then carries the
  // terminals' output and typing instead of main. A host not yet started gets one as it
  // starts, with the first terminal, so a launch with no terminals doesn't start it.
  ipcMain.on(events.terminalPort, (event) => {
    if (isTrustedSender(event) && backend.terminalsRunning())
      connectTerminals();
  });
}

/** Opens a channel between the window and the terminal host, replacing any before it. */
function connectTerminals() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const { port1, port2 } = new MessageChannelMain();
  backend.connectTerminals(port1);
  mainWindow.webContents.postMessage(events.terminalPort, null, [port2]);
}

// Without an ID Windows groups the taskbar button under Electron's.
if (process.platform === 'win32')
  app.setAppUserModelId('studio.pixels.bonfire');

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
      log,
      dictation: {
        program: resolve(
          __dirname,
          process.platform === 'win32'
            ? '../bin/bonfire-dictation.ps1'
            : '../bin/bonfire-dictation',
        ),
        disclaim: !app.isPackaged,
      },
      openTerminalChannel: connectTerminals,
      hosts: {
        terminals: join(__dirname, 'terminal-host.cjs'),
        agents: join(__dirname, 'agent-host.cjs'),
      },
      openHelp: () => shell.openExternal(HELP_URL),
      openUrl: (url) => shell.openExternal(url),
      copyText: (text) => clipboard.writeText(text),
      isFullscreen: () => mainWindow.isFullScreen(),
      notify,
      power: {
        start: () => powerSaveBlocker.start('prevent-app-suspension'),
        stop: (blocker) => powerSaveBlocker.stop(blocker),
        dischargingLevel,
        onBatteryPower: () => powerMonitor.isOnBatteryPower(),
        onPowerSourceChange: (listener) => {
          powerMonitor.on('on-battery', listener);
          powerMonitor.on('on-ac', listener);
        },
      },
      inView: () =>
        !!mainWindow &&
        !mainWindow.isDestroyed() &&
        mainWindow.isVisible() &&
        !mainWindow.isMinimized(),
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
