import { readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import {
  ACCESS_TOKEN_FILE_NAME,
  DESKTOP_SHELL_USER_AGENT,
  ENV_VARS,
  parseAccessTokenFile,
} from '@cairn/shared';
import {
  app,
  BrowserWindow,
  dialog,
  type IpcMainInvokeEvent,
  ipcMain,
  Menu,
  nativeImage,
  session,
  shell,
  Tray,
  type UtilityProcess,
  utilityProcess,
} from 'electron';
import { type LocalRunner, startLocalRunner } from './runner.js';
import { createUpdater, removeLeftoverUpdates } from './updater.js';

const LOOPBACK = '127.0.0.1';
const READY_TIMEOUT_MS = 60_000;
const READY_POLL_MS = 250;
const STOP_TIMEOUT_MS = 10_000;
const UPDATE_FIRST_CHECK_MS = 10_000;
const UPDATE_CHECK_EVERY_MS = 60 * 60 * 1000;
const UPDATE_CHECK_ON_FOCUS_AFTER_MS = 10 * 60 * 1000;

interface RunningServer {
  process: UtilityProcess;
  origin: string;
  exitCode: number | null;
}

let server: RunningServer | null = null;
let tray: Tray | null = null;
let runner: LocalRunner | null = null;
let quitting = false;

function cairnHome(): string {
  return join(app.getPath('userData'), 'home');
}

function bundledRoot(name: string): string {
  return app.isPackaged ? join(process.resourcesPath, name) : join(app.getAppPath(), name);
}

function freeLoopbackPort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, LOOPBACK, () => {
      const address = probe.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      probe.close(() => resolvePort(port));
    });
  });
}

function startServer(port: number): RunningServer {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOST: LOOPBACK,
    PORT: String(port),
    [ENV_VARS.home]: cairnHome(),
  };
  delete env[ENV_VARS.token];
  delete env[ENV_VARS.auth];
  const child = utilityProcess.fork(join(bundledRoot('server'), 'dist', 'index.mjs'), [], {
    serviceName: 'Cairn server',
    stdio: 'inherit',
    env,
  });
  const running: RunningServer = {
    process: child,
    origin: `http://${LOOPBACK}:${port}`,
    exitCode: null,
  };
  child.on('exit', (code) => {
    running.exitCode = code;
    if (quitting) return;
    dialog.showErrorBox('Cairn server stopped', `The Cairn server exited with code ${code}.`);
    app.quit();
  });
  return running;
}

async function waitUntilServing(running: RunningServer): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (running.exitCode !== null) {
      throw new Error(`The Cairn server exited with code ${running.exitCode} before it was ready.`);
    }
    const answered = await fetch(running.origin, {
      signal: AbortSignal.timeout(READY_POLL_MS * 4),
    }).then(
      () => true,
      () => false,
    );
    if (answered) return;
    await new Promise((wake) => setTimeout(wake, READY_POLL_MS));
  }
  throw new Error(`The Cairn server did not answer on ${running.origin} within 60 seconds.`);
}

function readOwnerToken(): string {
  const path = join(cairnHome(), ACCESS_TOKEN_FILE_NAME);
  const token = parseAccessTokenFile(readFileSync(path, 'utf8'));
  if (token === null) throw new Error(`The Cairn owner token file ${path} has no usable token.`);
  return token;
}

function signOwnPagesIn(origin: string, token: string): void {
  const { host } = new URL(origin);
  session.defaultSession.webRequest.onBeforeSendHeaders(
    { urls: [`http://${host}/*`, `ws://${host}/*`] },
    (details, callback) => {
      if (details.initiatorOrigin !== origin) {
        callback({});
        return;
      }
      const requestHeaders = Object.fromEntries(
        Object.entries(details.requestHeaders).filter(
          ([name]) => name.toLowerCase() !== 'authorization',
        ),
      );
      callback({ requestHeaders: { ...requestHeaders, Authorization: `Bearer ${token}` } });
    },
  );
}

function isWebUrl(url: string): boolean {
  return url.startsWith('https://') || url.startsWith('http://');
}

function openWindow(origin: string): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 760,
    minHeight: 520,
    show: false,
    title: 'Cairn',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 18, y: 18 },
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      preload: join(app.getAppPath(), 'dist', 'preload.cjs'),
    },
  });
  window.webContents.setUserAgent(
    `${window.webContents.getUserAgent()} ${DESKTOP_SHELL_USER_AGENT}`,
  );
  window.once('ready-to-show', () => window.show());
  window.on('close', (event) => {
    if (quitting) return;
    event.preventDefault();
    window.hide();
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isWebUrl(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (new URL(url).origin === origin) return;
    event.preventDefault();
    if (isWebUrl(url)) void shell.openExternal(url);
  });
  void window.loadURL(origin);
  return window;
}

function focusWindow(): void {
  const [window] = BrowserWindow.getAllWindows();
  if (window === undefined) {
    if (server !== null) openWindow(server.origin);
    return;
  }
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}

function showTray(origin: string): Tray {
  const icon = nativeImage.createFromPath(join(app.getAppPath(), 'assets', 'trayTemplate.png'));
  icon.setTemplateImage(true);
  const created = new Tray(icon);
  created.setToolTip('Cairn');
  created.setContextMenu(
    Menu.buildFromTemplate([
      { label: `Running at ${new URL(origin).host}`, enabled: false },
      { type: 'separator' },
      { label: 'Open Cairn', click: focusWindow },
      { type: 'separator' },
      { label: 'Quit Cairn', accelerator: 'CommandOrControl+Q', click: () => app.quit() },
    ]),
  );
  return created;
}

function serveUpdates(origin: string): void {
  const updater = createUpdater((state) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send('desktop-update:state', state);
    }
  });
  let lastCheckedAt = 0;
  const check = (): Promise<void> => {
    lastCheckedAt = Date.now();
    return updater.check();
  };
  const fromOwnPage = (event: IpcMainInvokeEvent): boolean => event.senderFrame?.origin === origin;
  ipcMain.handle('desktop-update:state', (event) => (fromOwnPage(event) ? updater.state() : null));
  ipcMain.handle('desktop-update:check', (event) => (fromOwnPage(event) ? check() : undefined));
  ipcMain.handle('desktop-update:install', (event) =>
    fromOwnPage(event) ? updater.install() : undefined,
  );
  setTimeout(() => void check(), UPDATE_FIRST_CHECK_MS);
  setInterval(() => void check(), UPDATE_CHECK_EVERY_MS);
  app.on('browser-window-focus', () => {
    if (lastCheckedAt !== 0 && Date.now() - lastCheckedAt >= UPDATE_CHECK_ON_FOCUS_AFTER_MS) {
      void check();
    }
  });
}

async function boot(): Promise<void> {
  try {
    server = startServer(await freeLoopbackPort());
    await waitUntilServing(server);
    const ownerToken = readOwnerToken();
    signOwnPagesIn(server.origin, ownerToken);
    tray = showTray(server.origin);
    void startLocalRunner({
      root: bundledRoot('runner'),
      home: join(app.getPath('userData'), 'runner'),
      origin: server.origin,
      ownerToken,
      isQuitting: () => quitting,
    }).then(
      (started) => {
        runner = started;
      },
      (error: unknown) => console.error('Cairn Runner did not start:', error),
    );
    void removeLeftoverUpdates();
    serveUpdates(server.origin);
    openWindow(server.origin);
  } catch (error) {
    quitting = true;
    dialog.showErrorBox(
      'Cairn could not start',
      error instanceof Error ? error.message : String(error),
    );
    server?.process.kill();
    app.exit(1);
  }
}

function stopServer(running: RunningServer): Promise<void> {
  if (running.exitCode !== null) return Promise.resolve();
  return new Promise((done) => {
    const timer = setTimeout(done, STOP_TIMEOUT_MS);
    running.process.once('exit', () => {
      clearTimeout(timer);
      done();
    });
    running.process.kill();
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', focusWindow);
  app.on('activate', focusWindow);
  app.on('before-quit', (event) => {
    if (quitting || server === null) return;
    quitting = true;
    event.preventDefault();
    const running = server;
    void (runner?.stop() ?? Promise.resolve())
      .then(() => stopServer(running))
      .then(() => {
        tray?.destroy();
        app.quit();
      });
  });
  void app.whenReady().then(boot);
}
