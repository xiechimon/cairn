import { readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { format } from 'node:util';
import {
  ACCESS_TOKEN_FILE_NAME,
  DESKTOP_SHELL_USER_AGENT,
  type DesktopUpdateState,
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
  powerMonitor,
  powerSaveBlocker,
  session,
  shell,
  Tray,
  type UtilityProcess,
  utilityProcess,
} from 'electron';
import { appMenuTemplate } from './app-menu.js';
import { createKeepAwake } from './keep-awake.js';
import { readLocalProviders, scanLocalProviders } from './local-providers.js';
import { desktopOtelEnv, type OtelEnv, withOtelEnv } from './otel-config.js';
import { type LocalRunner, startLocalRunner } from './runner.js';
import { createServerLog, otelHeaderSecrets, serverLogPath } from './server-log.js';
import { trayMenuTemplate } from './tray-menu.js';
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
let runnerStarting: Promise<void> | null = null;
let quitting = false;
const otelHeaderLogSecrets: string[] = [];
let ownerTokenLogSecret: string | null = null;

function logSecrets(): string[] {
  if (ownerTokenLogSecret === null) {
    try {
      ownerTokenLogSecret = parseAccessTokenFile(
        readFileSync(join(cairnHome(), ACCESS_TOKEN_FILE_NAME), 'utf8'),
      );
    } catch {}
  }
  return ownerTokenLogSecret === null
    ? otelHeaderLogSecrets
    : [...otelHeaderLogSecrets, ownerTokenLogSecret];
}

function cairnHome(): string {
  return join(app.getPath('userData'), 'home');
}

function bundledRoot(name: string): string {
  return app.isPackaged ? join(process.resourcesPath, name) : join(app.getAppPath(), name);
}

function freeLoopbackPort(wanted: number): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(wanted, LOOPBACK, () => {
      const address = probe.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      probe.close(() => resolvePort(port));
    });
  });
}

async function serverPort(): Promise<number> {
  const path = join(app.getPath('userData'), 'server-port');
  let saved = 0;
  try {
    saved = Number.parseInt(readFileSync(path, 'utf8'), 10);
  } catch {}
  const port = await freeLoopbackPort(Number.isInteger(saved) && saved > 0 ? saved : 0).catch(() =>
    freeLoopbackPort(0),
  );
  writeFileSync(path, `${port}\n`);
  return port;
}

function startServer(port: number, otelEnv: OtelEnv): RunningServer {
  const env = withOtelEnv(
    { ...process.env, HOST: LOOPBACK, PORT: String(port), [ENV_VARS.home]: cairnHome() },
    otelEnv,
  );
  delete env[ENV_VARS.token];
  delete env[ENV_VARS.auth];
  const child = utilityProcess.fork(join(bundledRoot('server'), 'dist', 'index.mjs'), [], {
    serviceName: 'Cairn server',
    stdio: 'pipe',
    env,
  });
  const log = createServerLog(serverLogPath(app.getPath('userData')), logSecrets);
  child.stdout?.on('data', (chunk) => log.write(chunk));
  child.stderr?.on('data', (chunk) => log.write(chunk));
  const running: RunningServer = {
    process: child,
    origin: `http://${LOOPBACK}:${port}`,
    exitCode: null,
  };
  child.on('exit', (code) => {
    running.exitCode = code;
    log.close();
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
  const keepAwake = createKeepAwake(powerSaveBlocker, join(app.getPath('userData'), 'keep-awake'));
  const showMenu = (): void =>
    created.setContextMenu(
      Menu.buildFromTemplate(
        trayMenuTemplate(new URL(origin).host, keepAwake.isOn(), {
          open: focusWindow,
          setKeepAwake: (on) => {
            keepAwake.set(on);
            showMenu();
          },
          quit: () => app.quit(),
        }),
      ),
    );
  showMenu();
  return created;
}

function serveUpdates(origin: string): void {
  const showMenu = (state: DesktopUpdateState): void =>
    Menu.setApplicationMenu(
      Menu.buildFromTemplate(
        appMenuTemplate(
          state,
          {
            check: () => void checkFromMenu(),
            install: () => void installFromMenu(),
          },
          {
            send: (command) => {
              focusWindow();
              BrowserWindow.getAllWindows()[0]?.webContents.send('desktop-menu', command);
            },
            back: () => BrowserWindow.getFocusedWindow()?.webContents.navigationHistory.goBack(),
            forward: () =>
              BrowserWindow.getFocusedWindow()?.webContents.navigationHistory.goForward(),
          },
        ),
      ),
    );
  const updater = createUpdater((state) => {
    showMenu(state);
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send('desktop-update:state', state);
    }
  });
  let lastCheckedAt = 0;
  const check = (): Promise<void> => {
    lastCheckedAt = Date.now();
    return updater.check();
  };
  const installFromMenu = async (): Promise<void> => {
    const state = updater.state();
    if (state.status !== 'available') return;
    const { response } = await dialog.showMessageBox({
      type: 'question',
      message: `Cairn ${state.version} is available`,
      detail: `You have ${app.getVersion()}. Cairn downloads the update and restarts to install it.`,
      buttons: ['Install and Restart', 'Later'],
      defaultId: 0,
      cancelId: 1,
    });
    if (response === 0) await updater.install();
  };
  const checkFromMenu = async (): Promise<void> => {
    await check();
    const state = updater.state();
    if (state.status === 'available') await installFromMenu();
    else if (state.status === 'current')
      await dialog.showMessageBox({
        type: 'info',
        message: 'Cairn is up to date',
        detail: `You have the latest version, ${state.version}.`,
      });
    else if (state.status === 'unsupported')
      await dialog.showMessageBox({
        type: 'info',
        message: 'Cairn cannot update itself here',
        detail:
          state.blocker === 'not-in-applications'
            ? 'Move Cairn to the Applications folder, then check again.'
            : state.blocker === 'read-only'
              ? 'Cairn is running from a read-only location. Copy it to the Applications folder, then check again.'
              : 'This is a development build.',
      });
    else if (state.status === 'error')
      await dialog.showMessageBox({
        type: 'warning',
        message: 'Cairn could not check for updates',
        detail: state.message,
      });
  };
  showMenu(updater.state());
  const fromOwnPage = (event: IpcMainInvokeEvent): boolean => event.senderFrame?.origin === origin;
  ipcMain.handle('desktop-update:state', (event) => (fromOwnPage(event) ? updater.state() : null));
  ipcMain.handle('desktop-update:check', (event) => (fromOwnPage(event) ? check() : undefined));
  ipcMain.handle('desktop-update:install', (event) =>
    fromOwnPage(event) ? updater.install() : undefined,
  );
  ipcMain.handle('local-providers:scan', (event) =>
    fromOwnPage(event) ? scanLocalProviders() : [],
  );
  ipcMain.handle('local-providers:read', (event, providerIds: unknown) =>
    fromOwnPage(event) ? readLocalProviders(providerIds) : [],
  );
  setTimeout(() => void check(), UPDATE_FIRST_CHECK_MS);
  setInterval(() => void check(), UPDATE_CHECK_EVERY_MS);
  app.on('browser-window-focus', () => {
    if (lastCheckedAt !== 0 && Date.now() - lastCheckedAt >= UPDATE_CHECK_ON_FOCUS_AFTER_MS) {
      void check();
    }
  });
}

function captureMainConsole(): void {
  const log = createServerLog(join(app.getPath('userData'), 'logs', 'main.log'), logSecrets);
  for (const level of ['log', 'info', 'warn', 'error'] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      original(...args);
      log.write(`${new Date().toISOString()} ${level} ${format(...args)}\n`);
    };
  }
}

async function boot(): Promise<void> {
  try {
    captureMainConsole();
    const otelEnv = desktopOtelEnv(join(app.getPath('userData'), 'otel.env'), console.error);
    otelHeaderLogSecrets.push(...otelHeaderSecrets(otelEnv.CAIRN_OTEL_HEADERS));
    server = startServer(await serverPort(), otelEnv);
    await waitUntilServing(server);
    const ownerToken = readOwnerToken();
    signOwnPagesIn(server.origin, ownerToken);
    tray = showTray(server.origin);
    const origin = server.origin;
    const bringRunnerUp = (): Promise<void> => {
      if (runner !== null) {
        runner.ensureRunning();
        return Promise.resolve();
      }
      runnerStarting ??= startLocalRunner({
        root: bundledRoot('runner'),
        home: join(app.getPath('userData'), 'runner'),
        origin,
        ownerToken,
        otelEnv,
        isQuitting: () => quitting,
      })
        .then(
          (started) => {
            runner = started;
          },
          (error: unknown) => console.error('Cairn Runner did not start:', error),
        )
        .finally(() => {
          runnerStarting = null;
        });
      return runnerStarting;
    };
    void bringRunnerUp();
    powerMonitor.on('resume', () => void bringRunnerUp());
    ipcMain.handle('local-runner:reconnect', (event) =>
      event.senderFrame?.origin === origin ? bringRunnerUp() : undefined,
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
