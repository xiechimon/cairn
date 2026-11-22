import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { format } from 'node:util';
import {
  ACCESS_TOKEN_FILE_NAME,
  DESKTOP_SHELL_USER_AGENT,
  type DesktopUpdateState,
  desktopNotificationOptions,
  ENV_VARS,
  isDesktopNotifyPayload,
  OWNER_CHANNEL_HEADER,
  OWNER_CHANNEL_MESSAGE,
  OWNER_CHANNEL_READY,
  PAGE_CAPTURE_RESULT,
  parseAccessTokenFile,
} from '@cairn/shared';
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  globalShortcut,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  ipcMain,
  Menu,
  type NativeImage,
  Notification,
  nativeImage,
  powerMonitor,
  powerSaveBlocker,
  session,
  shell,
  Tray,
  type UtilityProcess,
  utilityProcess,
} from 'electron';
import {
  antigravityCancelLogin,
  antigravityImportKey,
  antigravityLocalStatus,
  antigravityLogin,
  stopAntigravityLogin,
} from './antigravity-auth.js';
import { appMenuTemplate } from './app-menu.js';
import { installContextMenu } from './context-menu.js';
import {
  devinCancelLogin,
  devinImportKey,
  devinLocalStatus,
  devinLogin,
  stopDevinLogin,
} from './devin-auth.js';
import { createKeepAwake } from './keep-awake.js';
import { readLocalProviders, scanLocalProviders } from './local-providers.js';
import { type DesktopLocale, desktopLocale, openDesktopLocalePreference } from './locale.js';
import { desktopOtelEnv, withOtelFileEnv } from './otel-config.js';
import { openPermissionGuide, readPermissions, registerOwnComputerIpc } from './own-computer.js';
import { type CapturePage, createPageCapture } from './page-capture.js';
import { offscreenCaptureSurfaces, pageCaptureRequestOf } from './page-capture-window.js';
import { createRestartBudget } from './restart-budget.js';
import { type LocalRunner, startLocalRunner } from './runner.js';
import { migrateRunnerHome, runnerHomeFor } from './runner-home.js';
import { createServerExitHandler } from './server-exit.js';
import { createServerLog, otelHeaderSecrets, serverLogPath } from './server-log.js';
import { createTrayDataLoader, type TrayData } from './tray-data.js';
import {
  type TrayMenuActions,
  type TrayRunnerState,
  trayMenuTemplate,
  traySettingsPath,
} from './tray-menu.js';
import { createTrayRefresh } from './tray-refresh.js';
import {
  couldNotStartCopy,
  installUpdateCopy,
  serverStoppedCopy,
  unsupportedUpdateCopy,
  updateCheckFailedCopy,
  upToDateCopy,
} from './update-copy.js';
import {
  armGuard,
  type GuardAction,
  type GuardEvent,
  type GuardState,
  guardStep,
} from './update-guard.js';
import { appendUpdateLog, updateLogPath } from './update-log.js';
import { removeFolder, removeFolderAfterExit } from './update-staging.js';
import {
  readUpdateState,
  type UpdateNotice,
  updateStatePath,
  writeUpdateState,
} from './update-state.js';
import {
  failedAppPath,
  previousAppPath,
  readBundleVersion,
  restoreIfBundleMissing,
  restorePrevious,
} from './update-swap.js';
import {
  BACKGROUND_LAUNCH_FLAG,
  createUpdater,
  messageOf,
  relaunchArgs,
  removeLeftoverUpdates,
  runningBundle,
  type Updater,
} from './updater.js';
import { createWakeAhead, earliestScheduleNextRunAt } from './wake-ahead.js';

const LOOPBACK = '127.0.0.1';
const READY_TIMEOUT_MS = 60_000;
const READY_POLL_MS = 250;
const STOP_TIMEOUT_MS = 10_000;
const SERVER_RESTART_MAX = 3;
const SERVER_RESTART_STABLE_MS = 60_000;
const UPDATE_FIRST_CHECK_MS = 10_000;
const UPDATE_CHECK_EVERY_MS = 60 * 60 * 1000;
const UPDATE_CHECK_ON_FOCUS_AFTER_MS = 10 * 60 * 1000;
const HEALTH_PROBE_MS = 5_000;
const HEALTH_PROBE_TIMEOUT_MS = 5_000;
const IDLE_APPLY_MS = 10 * 60_000;
const IDLE_TICK_MS = 60_000;
const NEW_TASK_SHORTCUT = 'Control+Alt+N';
const TRAY_DATA_REFRESH_MS = 30_000;
const BACKGROUND_LAUNCH = process.argv.includes(BACKGROUND_LAUNCH_FLAG);

interface RunningServer {
  process: UtilityProcess;
  origin: string;
  exitCode: number | null;
}

let server: RunningServer | null = null;
let serverOtelFile: string | null = null;
const serverRestartBudget = createRestartBudget(SERVER_RESTART_MAX, SERVER_RESTART_STABLE_MS);
const serverExited = createServerExitHandler<RunningServer>({
  budget: serverRestartBudget,
  hooks: {
    isQuitting: () => quitting,
    current: () => server,
    gate: async (_dead, code) => {
      const guard = activeGuard;
      if (guard === null) return false;
      await guard.step('server-exit', `The Cairn server exited with code ${code}.`);
      return guard.rollingBack();
    },
    restart: (dead) => void restartServer(dead),
    fatal: (code) => {
      void windowLocale().then((locale) => {
        const copy = serverStoppedCopy(locale, code);
        dialog.showErrorBox(copy.title, copy.detail);
        app.quit();
      });
    },
  },
});
let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let runner: LocalRunner | null = null;
let runnerStarting: Promise<void> | null = null;
let quitting = false;
let updater: Updater | null = null;
let hiddenSince: number | null = null;
let launchActivationPending = BACKGROUND_LAUNCH;
let activeGuard: VersionGuard | null = null;
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

function runnerHome(): string {
  return runnerHomeFor({
    userData: app.getPath('userData'),
    defaultUserData: join(app.getPath('appData'), app.getName()),
    bundle: runningBundle(),
    installedBundle: '/Applications/Cairn.app',
    home: homedir(),
  });
}

function bundledRoot(name: string): string {
  return app.isPackaged ? join(process.resourcesPath, name) : join(app.getAppPath(), name);
}

function agentDesktopBinary(): string | null {
  if (process.platform !== 'darwin') return null;
  const folder = app.isPackaged
    ? bundledRoot('agent-desktop')
    : join(bundledRoot('agent-desktop'), process.arch);
  return join(folder, 'agent-desktop');
}

function serveOwnComputer(origin: string, binary: string | null): void {
  if (binary === null) return;
  registerOwnComputerIpc(
    ipcMain,
    (event: IpcMainInvokeEvent) => event.senderFrame?.origin === origin,
    {
      guide: () => openPermissionGuide(binary),
      permissions: () => readPermissions(binary),
    },
  );
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

const ownerChannelKey = randomBytes(32).toString('base64url');

let pageCapture: CapturePage | null = null;

async function answerPageCapture(
  child: UtilityProcess,
  request: { id: string; html: string },
): Promise<void> {
  pageCapture ??= createPageCapture(offscreenCaptureSurfaces({ BrowserWindow, session }));
  const image = tray === null ? null : await pageCapture(request.html);
  try {
    child.postMessage({ type: PAGE_CAPTURE_RESULT, id: request.id, image });
  } catch (error) {
    console.error('the page thumbnail reply did not reach the server:', messageOf(error));
  }
}

function startServer(
  port: number,
  otelFile: string | null,
  onExit: (dead: RunningServer, code: number | null) => void,
): RunningServer {
  serverRestartBudget.started();
  const env = withOtelFileEnv(
    {
      ...process.env,
      HOST: LOOPBACK,
      PORT: String(port),
      [ENV_VARS.home]: cairnHome(),
      [ENV_VARS.parentPid]: String(process.pid),
      [ENV_VARS.ownerChannel]: 'ipc',
    },
    otelFile,
  );
  delete env[ENV_VARS.token];
  delete env[ENV_VARS.auth];
  delete env[ENV_VARS.apiKey];
  const child = utilityProcess.fork(join(bundledRoot('server'), 'dist', 'index.mjs'), [], {
    serviceName: 'Cairn server',
    stdio: 'pipe',
    env,
  });
  child.on('message', (data: unknown) => {
    const capture = pageCaptureRequestOf(data);
    if (capture !== null) {
      void answerPageCapture(child, capture);
      return;
    }
    if (
      data !== null &&
      typeof data === 'object' &&
      (data as { type?: unknown }).type === OWNER_CHANNEL_READY
    ) {
      child.postMessage({ type: OWNER_CHANNEL_MESSAGE, key: ownerChannelKey });
    }
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
    onExit(running, code);
  });
  return running;
}

function serverPortOf(running: RunningServer): number {
  return Number(new URL(running.origin).port);
}

async function restartServer(dead: RunningServer): Promise<void> {
  if (quitting) return;
  console.error(`Cairn server exited (code ${dead.exitCode}); restarting`);
  const next = startServer(serverPortOf(dead), serverOtelFile, serverExited);
  server = next;
  try {
    await waitUntilServing(next);
    startHealthWatch(next, activeGuard);
  } catch {
    next.process.kill();
  }
}

async function waitUntilServing(running: RunningServer): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (running.exitCode !== null) {
      throw new Error(`The Cairn server exited with code ${running.exitCode} before it was ready.`);
    }
    const answered = await fetch(running.origin, {
      signal: AbortSignal.timeout(HEALTH_PROBE_TIMEOUT_MS),
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
          ([name]) =>
            name.toLowerCase() !== 'authorization' && name.toLowerCase() !== OWNER_CHANNEL_HEADER,
        ),
      );
      callback({
        requestHeaders: {
          ...requestHeaders,
          Authorization: `Bearer ${token}`,
          [OWNER_CHANNEL_HEADER]: ownerChannelKey,
        },
      });
    },
  );
}

function isWebUrl(url: string): boolean {
  return url.startsWith('https://') || url.startsWith('http://');
}

function openWindow(origin: string, path = '/'): BrowserWindow {
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
  installContextMenu(window.webContents, { clipboard, Menu }, desktopLocale);
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
  void window.loadURL(new URL(path, origin).href);
  mainWindow = window;
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null;
  });
  return window;
}

function focusWindow(): void {
  const window = mainWindow;
  if (window === null) {
    if (server !== null) openWindow(server.origin);
    return;
  }
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}

function sendToWindow(channel: string, payload: unknown): void {
  focusWindow();
  mainWindow?.webContents.send(channel, payload);
}

function openTrayPath(origin: string, path: string): void {
  const window = mainWindow;
  if (window === null) {
    openWindow(origin, path);
    return;
  }
  focusWindow();
  if (window.webContents.isLoadingMainFrame()) {
    void window.loadURL(new URL(path, origin).href);
  } else {
    window.webContents.send('desktop-navigate', path);
  }
}

interface TrayControls {
  runner: () => TrayRunnerState;
  setRunner: (on: boolean) => Promise<void>;
  nextRunAt: () => Promise<number | null>;
}

async function windowLocale(): Promise<DesktopLocale> {
  for (const window of BrowserWindow.getAllWindows()) {
    const lang = await window.webContents
      .executeJavaScript('document.documentElement.lang')
      .catch(() => null);
    if (typeof lang === 'string' && lang !== '') return desktopLocale(lang);
  }
  return desktopLocale(app.getLocale());
}

function showTray(
  origin: string,
  ownerToken: string,
  controls: TrayControls,
): { tray: Tray; refresh: () => void } {
  const trayIcon = (name: string): NativeImage => {
    const image = nativeImage.createFromPath(join(app.getAppPath(), 'assets', name));
    image.setTemplateImage(true);
    return image;
  };
  const idleIcon = trayIcon('trayTemplate.png');
  const awakeIcon = trayIcon('trayAwakeTemplate.png');
  const keepAwake = createKeepAwake(powerSaveBlocker, join(app.getPath('userData'), 'keep-awake'));
  const created = new Tray(keepAwake.isHolding() ? awakeIcon : idleIcon);
  created.setToolTip('Cairn');

  const locale = openDesktopLocalePreference(app.getPath('userData'), app.getLocale(), (error) => {
    console.error('Cairn could not save the desktop language:', messageOf(error));
  });
  const onLocale = (event: IpcMainEvent, value: unknown): void => {
    const frame = event.senderFrame;
    if (
      event.sender === mainWindow?.webContents &&
      frame?.origin === origin &&
      frame.parent === null &&
      locale.set(value)
    ) {
      refresh();
    }
  };
  ipcMain.on('desktop-locale:report', onLocale);
  let data: TrayData = { status: 'loading' };
  let tracking = false;
  let rendered = '';
  const refreshWorkspace = createTrayRefresh(createTrayDataLoader(origin, ownerToken), (next) => {
    data = next;
    refresh();
  });
  const actions: TrayMenuActions = {
    open: (path) => openTrayPath(origin, path),
    settings: () => {
      const path = traySettingsPath(mainWindow?.webContents.getURL() ?? '', origin);
      if (path === null) focusWindow();
      else openTrayPath(origin, path);
    },
    setRunner: (on) => {
      void controls
        .setRunner(on)
        .catch((error: unknown) => {
          console.error('Cairn Runner could not change state:', messageOf(error));
        })
        .finally(reconcile);
    },
    setKeepAwake: (on) => {
      try {
        keepAwake.set(on);
        refreshIcon();
      } catch (error) {
        console.error('Cairn could not save the screen-awake setting:', messageOf(error));
      }
      reconcile();
    },
    quit: () => app.quit(),
  };

  function refreshIcon(): void {
    if (!quitting) created.setImage(keepAwake.isHolding() ? awakeIcon : idleIcon);
  }

  function refreshData(opened = false): void {
    if (!quitting) void refreshWorkspace(opened);
  }

  function refresh(): void {
    if (quitting || tracking) return;
    const state = {
      locale: locale.locale(),
      runner: controls.runner(),
      keepAwake: keepAwake.isOn(),
      data,
    };
    const key = JSON.stringify(state);
    if (rendered === key) return;
    const menu = Menu.buildFromTemplate(trayMenuTemplate(state, actions));
    menu.on('menu-will-show', () => {
      tracking = true;
      refreshData(true);
    });
    menu.on('menu-will-close', () => {
      tracking = false;
      setImmediate(refresh);
    });
    created.setContextMenu(menu);
    rendered = key;
  }

  function reconcile(): void {
    rendered = '';
    setImmediate(refresh);
  }

  const wakeAhead = createWakeAhead({
    nextRunAt: controls.nextRunAt,
    onWindow: (active) => {
      keepAwake.setWakeAhead(active);
      refreshIcon();
    },
  });
  wakeAhead.start();
  const onResume = () => {
    void wakeAhead.pollNow();
    refreshData();
  };
  powerMonitor.on('resume', onResume);
  globalShortcut.register(NEW_TASK_SHORTCUT, () => sendToWindow('desktop-menu', 'new-task'));
  refresh();
  refreshData();
  const timer = setInterval(refreshData, TRAY_DATA_REFRESH_MS);
  timer.unref();
  app.once('will-quit', () => {
    clearInterval(timer);
    wakeAhead.stop();
    ipcMain.removeListener('desktop-locale:report', onLocale);
    powerMonitor.removeListener('resume', onResume);
  });
  return { tray: created, refresh };
}

function serveNotifications(origin: string): void {
  ipcMain.on('desktop-notify', (event, payload: unknown) => {
    if (event.senderFrame?.origin !== origin || !isDesktopNotifyPayload(payload)) return;
    const fallback = (): void => {
      if (payload.dialog !== undefined) {
        void dialog.showMessageBox({
          type: 'warning',
          message: payload.dialog.title,
          detail: payload.dialog.detail,
        });
      }
    };
    if (!Notification.isSupported()) {
      fallback();
      return;
    }
    const notification = new Notification(desktopNotificationOptions(payload));
    notification.on('click', () => sendToWindow('desktop-navigate', payload.href));
    notification.on('failed', (_event, error) => {
      console.warn('notification failed:', error);
      fallback();
    });
    notification.show();
  });
}

function serveUpdates(origin: string, notice: UpdateNotice | null): void {
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
            send: (command) => sendToWindow('desktop-menu', command),
            back: () => BrowserWindow.getFocusedWindow()?.webContents.navigationHistory.goBack(),
            forward: () =>
              BrowserWindow.getFocusedWindow()?.webContents.navigationHistory.goForward(),
          },
        ),
      ),
    );
  const created = createUpdater((state) => {
    showMenu(state);
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send('desktop-update:state', state);
    }
  });
  updater = created;
  let lastCheckedAt = 0;
  const check = (): Promise<void> => {
    lastCheckedAt = Date.now();
    return created.check();
  };
  const installFromMenu = async (): Promise<void> => {
    const state = created.state();
    if (state.status === 'ready') {
      await created.apply('foreground');
      return;
    }
    if (state.status !== 'available') return;
    const blocked =
      readUpdateState(updateStatePath(app.getPath('userData'))).blocked?.version === state.version;
    const copy = installUpdateCopy(await windowLocale(), state.version, app.getVersion(), blocked);
    const { response } = await dialog.showMessageBox({
      type: 'question',
      message: copy.title,
      detail: copy.detail,
      buttons: copy.buttons ?? [],
      defaultId: 0,
      cancelId: 1,
    });
    if (response === 0) {
      await created.install();
      await created.apply('foreground');
    }
  };
  const checkFromMenu = async (): Promise<void> => {
    await check();
    const state = created.state();
    if (state.status === 'available' || state.status === 'ready') await installFromMenu();
    else if (state.status === 'current') {
      const copy = upToDateCopy(await windowLocale(), state.version);
      await dialog.showMessageBox({ type: 'info', message: copy.title, detail: copy.detail });
    } else if (state.status === 'unsupported') {
      const copy = unsupportedUpdateCopy(await windowLocale(), state.blocker);
      await dialog.showMessageBox({ type: 'info', message: copy.title, detail: copy.detail });
    } else if (state.status === 'error') {
      const copy = updateCheckFailedCopy(await windowLocale(), state.message);
      await dialog.showMessageBox({ type: 'warning', message: copy.title, detail: copy.detail });
    }
  };
  showMenu(created.state());
  let pendingNotice = notice;
  const fromOwnPage = (event: IpcMainInvokeEvent | IpcMainEvent): boolean =>
    event.senderFrame?.origin === origin;
  ipcMain.handle('desktop-update:rollback-notice', (event) => {
    if (!fromOwnPage(event)) return null;
    const pending = pendingNotice;
    pendingNotice = null;
    return pending === null
      ? null
      : {
          failedVersion: pending.failedVersion,
          restoredVersion: pending.restoredVersion,
          logPath: pending.logPath,
        };
  });
  ipcMain.on('window-controls:set-visible', (event, visible: unknown) => {
    if (!fromOwnPage(event)) return;
    BrowserWindow.fromWebContents(event.sender)?.setWindowButtonVisibility(visible === true);
  });
  ipcMain.handle('desktop-update:state', (event) => (fromOwnPage(event) ? created.state() : null));
  ipcMain.handle('desktop-update:check', (event) => (fromOwnPage(event) ? check() : undefined));
  ipcMain.handle('desktop-update:install', (event) => {
    if (!fromOwnPage(event)) return undefined;
    return created.state().status === 'ready' ? created.apply('foreground') : created.install();
  });
  ipcMain.handle('local-providers:scan', (event) =>
    fromOwnPage(event) ? scanLocalProviders() : [],
  );
  ipcMain.handle('local-providers:read', (event, providerIds: unknown) =>
    fromOwnPage(event) ? readLocalProviders(providerIds) : [],
  );
  ipcMain.handle('devin:status', (event) =>
    fromOwnPage(event) ? devinLocalStatus() : { loggedIn: false, canLogin: false },
  );
  ipcMain.handle('devin:import-key', (event) =>
    fromOwnPage(event) ? devinImportKey() : { ok: false, reason: 'no-key' },
  );
  ipcMain.handle('devin:login', (event) =>
    fromOwnPage(event) ? devinLogin() : { ok: false, reason: 'cancelled' },
  );
  ipcMain.handle('devin:cancel-login', (event) => {
    if (fromOwnPage(event)) devinCancelLogin();
  });
  ipcMain.handle('antigravity:status', (event) =>
    fromOwnPage(event)
      ? antigravityLocalStatus()
      : { installed: false, loggedIn: false, canLogin: false },
  );
  ipcMain.handle('antigravity:import-key', (event) =>
    fromOwnPage(event) ? antigravityImportKey() : { ok: false, reason: 'no-key' },
  );
  ipcMain.handle('antigravity:login', (event) =>
    fromOwnPage(event)
      ? antigravityLogin((phase) => {
          if (!event.sender.isDestroyed()) {
            event.sender.send('antigravity:login-progress', phase);
          }
        })
      : { ok: false, reason: 'cancelled' },
  );
  ipcMain.handle('antigravity:cancel-login', (event) => {
    if (fromOwnPage(event)) antigravityCancelLogin();
  });
  setTimeout(() => void check(), UPDATE_FIRST_CHECK_MS);
  setInterval(() => void check(), UPDATE_CHECK_EVERY_MS);
  app.on('browser-window-focus', () => {
    if (lastCheckedAt !== 0 && Date.now() - lastCheckedAt >= UPDATE_CHECK_ON_FOCUS_AFTER_MS) {
      void check();
    }
  });
}

const QUIT_FALLBACK_MS = 30_000;

interface VersionGuard {
  step(event: GuardEvent, reason: string): Promise<GuardAction>;
  rollingBack(): boolean;
}

function takeRollbackNotice(userData: string): UpdateNotice | null {
  const statePath = updateStatePath(userData);
  const state = readUpdateState(statePath);
  const notice = state.notice;
  if (notice === null) return null;
  writeUpdateState(statePath, { ...state, notice: null });
  appendUpdateLog(
    userData,
    `told the user that ${notice.failedVersion} was rolled back to ${notice.restoredVersion}`,
  );
  return notice;
}

function armVersionGuard(userData: string): VersionGuard | null {
  const statePath = updateStatePath(userData);
  const state = readUpdateState(statePath);
  const installed = state.installed;
  const bundle = runningBundle();
  if (installed === null || installed.version !== app.getVersion()) {
    if (installed !== null) writeUpdateState(statePath, { ...state, installed: null });
    void removeFolder(previousAppPath(bundle)).catch(() => {});
    return null;
  }
  const attempts =
    state.blocked !== null && state.blocked.version === installed.version
      ? state.blocked.attempts
      : 0;
  let guard: GuardState = armGuard(attempts, Date.now());
  let rolling = false;
  const rollBack = async (reason: string): Promise<GuardAction> => {
    rolling = true;
    const previousApp = previousAppPath(bundle);
    try {
      if ((await readBundleVersion(previousApp)) !== installed.previousVersion) {
        throw new Error(
          `${previousApp} is not the copy of ${installed.previousVersion} Cairn kept`,
        );
      }
      await removeFolder(failedAppPath(bundle)).catch(() => {});
      const failed = await restorePrevious({ bundle, previousApp });
      removeFolderAfterExit(failed, process.pid);
      const at = Date.now();
      appendUpdateLog(
        userData,
        `rolled back ${installed.version} to ${installed.previousVersion}: ${reason}`,
      );
      writeUpdateState(statePath, {
        ...readUpdateState(statePath),
        installed: null,
        blocked: { version: installed.version, at, reason, attempts: attempts + 1 },
        notice: {
          failedVersion: installed.version,
          restoredVersion: installed.previousVersion,
          reason,
          logPath: updateLogPath(userData),
          at,
        },
      });
      app.relaunch({ args: relaunchArgs(true) });
      setTimeout(() => app.exit(1), QUIT_FALLBACK_MS).unref();
      app.quit();
    } catch (error) {
      appendUpdateLog(userData, `rollback of ${installed.version} failed: ${messageOf(error)}`);
      const copy = couldNotStartCopy(await windowLocale(), `${reason}\n\n${messageOf(error)}`);
      dialog.showErrorBox(copy.title, copy.detail);
      app.exit(1);
    }
    return 'rollback';
  };
  const confirm = async (): Promise<GuardAction> => {
    appendUpdateLog(userData, `${installed.version} started and stayed healthy`);
    writeUpdateState(statePath, { ...readUpdateState(statePath), installed: null });
    await removeFolder(previousAppPath(bundle)).catch(() => {});
    return 'confirm';
  };
  return {
    async step(event, reason) {
      const step = guardStep(guard, { event, at: Date.now() });
      guard = step.state;
      if (step.action === 'confirm') return confirm();
      if (step.action === 'rollback') return rollBack(reason);
      return 'none';
    },
    rollingBack: () => rolling,
  };
}

function startHealthWatch(running: RunningServer, guard: VersionGuard | null): void {
  if (guard === null) return;
  const probe = async (): Promise<void> => {
    const answered = await fetch(running.origin, {
      signal: AbortSignal.timeout(HEALTH_PROBE_TIMEOUT_MS),
    }).then(
      () => true,
      () => false,
    );
    const action = await guard.step(
      answered ? 'health-ok' : 'health-failed',
      `The Cairn server stopped answering on ${running.origin}.`,
    );
    if (action !== 'none') clearInterval(timer);
  };
  const timer = setInterval(() => {
    if (running.exitCode === null) void probe();
  }, HEALTH_PROBE_MS);
  timer.unref();
  void probe();
}

function watchIdleUpdate(): void {
  const timer = setInterval(() => {
    const visible = BrowserWindow.getAllWindows().some((window) => window.isVisible());
    if (visible || updater === null || updater.state().status !== 'ready') {
      hiddenSince = null;
      return;
    }
    hiddenSince ??= Date.now();
    if (Date.now() - hiddenSince < IDLE_APPLY_MS) return;
    if (activeGuard?.rollingBack() === true) return;
    hiddenSince = null;
    void updater
      .apply('background')
      .catch((error: unknown) =>
        console.error('applying the idle update failed:', messageOf(error)),
      );
  }, IDLE_TICK_MS);
  timer.unref();
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
  const userData = app.getPath('userData');
  let guard: VersionGuard | null = null;
  try {
    captureMainConsole();
    if (await restoreIfBundleMissing(runningBundle())) {
      console.warn('restored the previous Cairn after an install was interrupted');
    }
    const notice = takeRollbackNotice(userData);
    guard = armVersionGuard(userData);
    activeGuard = guard;
    const otelEnvPath = join(userData, 'otel.env');
    const otelEnv = desktopOtelEnv(otelEnvPath, console.error);
    const otelFile = otelEnv.CAIRN_OTEL_ENDPOINT === undefined ? null : otelEnvPath;
    serverOtelFile = otelFile;
    otelHeaderLogSecrets.push(...otelHeaderSecrets(otelEnv.CAIRN_OTEL_HEADERS));
    server = startServer(await serverPort(), otelFile, serverExited);
    await waitUntilServing(server);
    startHealthWatch(server, guard);
    const ownerToken = readOwnerToken();
    signOwnPagesIn(server.origin, ownerToken);
    const origin = server.origin;
    let runnerWanted = true;
    let stoppingRunner: Promise<void> | null = null;
    let refreshTray = (): void => {};
    const bringRunnerUp = (): Promise<void> => {
      if (stoppingRunner !== null) return stoppingRunner.then(bringRunnerUp);
      if (runner !== null) {
        runner.ensureRunning();
        return Promise.resolve();
      }
      migrateRunnerHome(join(app.getPath('userData'), 'runner'), runnerHome());
      runnerStarting ??= startLocalRunner({
        root: bundledRoot('runner'),
        home: runnerHome(),
        serverHome: cairnHome(),
        origin,
        ownerToken,
        ownerChannelKey,
        otelFile,
        agentDesktop: agentDesktopBinary(),
        isQuitting: () => quitting,
        onStateChanged: () => refreshTray(),
      })
        .then(
          (started) => {
            runner = started;
          },
          (error: unknown) => console.error('Cairn Runner did not start:', error),
        )
        .finally(() => {
          runnerStarting = null;
          refreshTray();
        });
      refreshTray();
      return runnerStarting;
    };
    void bringRunnerUp();
    const nativeTray = showTray(origin, ownerToken, {
      runner: () => {
        if (stoppingRunner !== null) return 'stopping';
        if (!runnerWanted) return 'off';
        if (runnerStarting !== null) return 'starting';
        return runner?.isRunning() === true ? 'on' : 'failed';
      },
      setRunner: async (on) => {
        runnerWanted = on;
        if (on) {
          await bringRunnerUp();
          return;
        }
        stoppingRunner ??= (runner?.stop() ?? Promise.resolve()).finally(() => {
          stoppingRunner = null;
          refreshTray();
        });
        refreshTray();
        await stoppingRunner;
      },
      nextRunAt: () => earliestScheduleNextRunAt(origin, ownerToken),
    });
    tray = nativeTray.tray;
    refreshTray = nativeTray.refresh;
    powerMonitor.on('resume', () => {
      if (runnerWanted) void bringRunnerUp();
    });
    ipcMain.handle('local-runner:reconnect', (event) => {
      if (event.senderFrame?.origin !== origin) return undefined;
      runnerWanted = true;
      return bringRunnerUp();
    });
    void removeLeftoverUpdates();
    serveUpdates(server.origin, notice);
    serveNotifications(server.origin);
    serveOwnComputer(server.origin, agentDesktopBinary());
    watchIdleUpdate();
    if (!BACKGROUND_LAUNCH) openWindow(server.origin);
  } catch (error) {
    const reason = messageOf(error);
    if (guard !== null) {
      await guard.step('health-failed', reason);
      if (guard.rollingBack()) return;
    }
    quitting = true;
    const copy = couldNotStartCopy(await windowLocale(), reason);
    dialog.showErrorBox(copy.title, copy.detail);
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
  app.on('activate', () => {
    if (launchActivationPending) {
      launchActivationPending = false;
      return;
    }
    focusWindow();
  });
  app.on('before-quit', (event) => {
    if (quitting || server === null) return;
    quitting = true;
    globalShortcut.unregisterAll();
    stopDevinLogin();
    stopAntigravityLogin();
    event.preventDefault();
    const running = server;
    void (runner?.stop() ?? Promise.resolve())
      .then(() => stopServer(running))
      .then(() => (activeGuard?.rollingBack() === true ? undefined : updater?.apply('none')))
      .catch((error: unknown) =>
        console.error('finishing the pending update on quit failed:', messageOf(error)),
      )
      .then(() => {
        tray?.destroy();
        app.quit();
      });
  });
  void app.whenReady().then(boot);
}
