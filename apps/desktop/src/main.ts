import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { homedir, release } from 'node:os';
import { dirname, join } from 'node:path';
import { format } from 'node:util';
import {
  ACCESS_TOKEN_FILE_NAME,
  DESKTOP_SHELL_USER_AGENT,
  DESKTOP_TRAY_PATH,
  type DesktopMenuCommand,
  type DesktopRunnerState,
  type DesktopTrayState,
  type DesktopUpdateState,
  desktopNotificationOptions,
  ENV_VARS,
  isAppPath,
  isDesktopNotifyPayload,
  type NativeTrayMenu,
  nativeTrayMenuSchema,
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
  nativeTheme,
  powerMonitor,
  powerSaveBlocker,
  screen,
  session,
  shell,
  systemPreferences,
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
import { type DesktopLocale, desktopLocale } from './locale.js';
import {
  type NativeTray,
  nativeTrayAction,
  skeletonTrayMenu,
  startNativeTray,
  withHostState,
} from './native-tray.js';
import { desktopOtelEnv, withOtelFileEnv } from './otel-config.js';
import { openPermissionGuide, readPermissions, registerOwnComputerIpc } from './own-computer.js';
import { type CapturePage, createPageCapture } from './page-capture.js';
import { offscreenCaptureSurfaces, pageCaptureRequestOf } from './page-capture-window.js';
import { createRestartBudget } from './restart-budget.js';
import { type LocalRunner, startLocalRunner } from './runner.js';
import { migrateRunnerHome, runnerHomeFor } from './runner-home.js';
import { createServerExitHandler } from './server-exit.js';
import { createServerLog, otelHeaderSecrets, serverLogPath } from './server-log.js';
import { addLiquidGlass } from './tray-glass.js';
import { trayMenuTemplate } from './tray-menu.js';
import {
  hasLiquidGlass,
  TRAY_POPOVER_RADIUS,
  TRAY_POPOVER_WIDTH,
  trayPopoverBounds,
} from './tray-popover.js';
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
import {
  clampBounds,
  createWindowStateStore,
  DEFAULT_WINDOW_SIZE,
  MIN_WINDOW_SIZE,
  WINDOW_STATE_FILE_NAME,
  type WindowStateStore,
} from './window-state.js';

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
const TRAY_FIRST_HEIGHT = 440;
const TRAY_MAX_HEIGHT = 900;
const TRAY_REFRESH_MS = 2_000;
const TRAY_REOPEN_GUARD_MS = 250;
const TRAY_QUEUED_OPEN_MS = 2_000;
const ERR_ABORTED = -3;
const TRAY_LIGHT_FILL = '#f6f6f6';
const TRAY_DARK_FILL = '#2b2b2b';
const NATIVE_TRAY_RESTART_MAX = 3;
const NATIVE_TRAY_STABLE_MS = 60_000;
const IS_MAC = process.platform === 'darwin';
const BACKGROUND_LAUNCH = process.argv.includes(BACKGROUND_LAUNCH_FLAG);
const MENU_COMMANDS: ReadonlySet<string> = new Set<DesktopMenuCommand>([
  'settings',
  'new-task',
  'search',
]);

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
let windowState: WindowStateStore | null = null;
let tray: { destroy: () => void } | null = null;
let trayOpenUntil = 0;
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

function windowStateStore(): WindowStateStore {
  if (windowState !== null) return windowState;
  const path = join(app.getPath('userData'), WINDOW_STATE_FILE_NAME);
  windowState = createWindowStateStore({
    read: () => {
      try {
        return readFileSync(path, 'utf8');
      } catch {
        return null;
      }
    },
    write: (contents) => writeFileSync(path, contents),
  });
  return windowState;
}

function restoredBounds(store: WindowStateStore) {
  const saved = store.current().bounds;
  if (saved === null) return DEFAULT_WINDOW_SIZE;
  return clampBounds(
    saved,
    screen.getAllDisplays().map((display) => display.workArea),
    screen.getPrimaryDisplay().workArea,
  );
}

function rememberWindow(window: BrowserWindow, store: WindowStateStore): void {
  const saveBounds = () => {
    if (!window.isFullScreen()) store.update({ bounds: window.getNormalBounds() });
  };
  window.on('resize', saveBounds);
  window.on('move', saveBounds);
  window.on('hide', () => store.flush());
}

function openWindow(origin: string): BrowserWindow {
  const store = windowStateStore();
  const window = new BrowserWindow({
    ...restoredBounds(store),
    minWidth: MIN_WINDOW_SIZE.width,
    minHeight: MIN_WINDOW_SIZE.height,
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
  const clearQueuedTrayOpen = (): void => {
    trayOpenUntil = 0;
  };
  window.webContents.on('before-input-event', (_event, input) => {
    if (input.type === 'keyDown' && input.key === 'Escape') clearQueuedTrayOpen();
  });
  window.webContents.on('before-mouse-event', (_event, input) => {
    if (input.type === 'mouseDown') clearQueuedTrayOpen();
  });
  window.on('close', clearQueuedTrayOpen);
  window.on('minimize', clearQueuedTrayOpen);
  window.on('hide', clearQueuedTrayOpen);
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
  rememberWindow(window, store);
  void window.loadURL(origin);
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

function openFromTray(target: unknown): void {
  if (typeof target !== 'object' || target === null) return;
  const { kind, path, command } = target as Partial<Record<string, unknown>>;
  if (kind === 'path' && isAppPath(path)) sendToWindow('desktop-navigate', path);
  else if (kind === 'command' && typeof command === 'string' && MENU_COMMANDS.has(command))
    sendToWindow('desktop-menu', command);
}

interface TrayControls {
  runner: () => DesktopRunnerState;
  setRunner: (on: boolean) => Promise<void>;
  nextRunAt?: () => Promise<number | null>;
}

function createTrayPopover(): BrowserWindow {
  const popover = new BrowserWindow({
    width: TRAY_POPOVER_WIDTH,
    height: TRAY_FIRST_HEIGHT,
    show: false,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: true,
    ...(IS_MAC
      ? { type: 'panel', transparent: true, roundedCorners: true }
      : { backgroundColor: nativeTheme.shouldUseDarkColors ? TRAY_DARK_FILL : TRAY_LIGHT_FILL }),
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      preload: join(app.getAppPath(), 'dist', 'preload.cjs'),
    },
  });
  if (IS_MAC) {
    const glass =
      hasLiquidGlass(process.platform, release()) && addLiquidGlass(popover, TRAY_POPOVER_RADIUS);
    if (!glass) popover.setVibrancy('menu');
  }
  popover.setVisibleOnAllWorkspaces(true, {
    visibleOnFullScreen: true,
    skipTransformProcessType: true,
  });
  popover.webContents.setUserAgent(
    `${popover.webContents.getUserAgent()} ${DESKTOP_SHELL_USER_AGENT}`,
  );
  popover.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  popover.webContents.on('will-navigate', (event) => event.preventDefault());
  return popover;
}

function systemAccent(): string | null {
  if (!IS_MAC) return null;
  return `#${systemPreferences.getAccentColor().slice(0, 6)}`;
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

function nativeTrayHelper(): string | null {
  if (!IS_MAC) return null;
  const helper = app.isPackaged
    ? join(process.resourcesPath, 'tray', 'CairnTray')
    : join(app.getAppPath(), 'tray-helper', process.arch, 'CairnTray');
  return existsSync(helper) ? helper : null;
}

function showTray(origin: string, controls: TrayControls): { destroy: () => void } {
  const trayIcon = (name: string): NativeImage => {
    const image = nativeImage.createFromPath(join(app.getAppPath(), 'assets', name));
    image.setTemplateImage(true);
    return image;
  };
  const idleIcon = trayIcon('trayTemplate.png');
  const awakeIcon = trayIcon('trayAwakeTemplate.png');
  const keepAwake = createKeepAwake(powerSaveBlocker, join(app.getPath('userData'), 'keep-awake'));
  const tooltip = `Cairn · ${new URL(origin).host}`;
  let created: Tray | null = null;
  let native: NativeTray | null = null;
  let pageMenu: NativeTrayMenu | null = null;
  let sentMenu: NativeTrayMenu = skeletonTrayMenu(desktopLocale(app.getLocale()));
  let sentMenuJson = '';
  const sendIcon = (): void => {
    native?.send({ type: 'icon', awake: keepAwake.isHolding(), tooltip });
  };
  const refreshIcon = (): void => {
    created?.setImage(keepAwake.isHolding() ? awakeIcon : idleIcon);
    sendIcon();
  };
  const pushMenu = (force = false): void => {
    if (native === null) return;
    const menu = withHostState(pageMenu ?? sentMenu, {
      keepAwake: keepAwake.isOn(),
      runner: controls.runner(),
    });
    const json = JSON.stringify(menu);
    if (!force && json === sentMenuJson) return;
    sentMenu = menu;
    sentMenuJson = json;
    native.send({ type: 'menu', menu });
  };
  const fallbackMenu = (): Menu =>
    Menu.buildFromTemplate(
      trayMenuTemplate(new URL(origin).host, keepAwake.isOn(), {
        open: focusWindow,
        setKeepAwake,
        quit: () => app.quit(),
      }),
    );
  const setKeepAwake = (on: boolean): void => {
    keepAwake.set(on);
    refreshIcon();
    if (!IS_MAC) created?.setContextMenu(fallbackMenu());
  };
  if (controls.nextRunAt !== undefined) {
    const nextRunAt = controls.nextRunAt;
    const wakeAhead = createWakeAhead({
      nextRunAt,
      onWindow: (active) => {
        keepAwake.setWakeAhead(active);
        refreshIcon();
      },
    });
    wakeAhead.start();
    powerMonitor.on('resume', () => void wakeAhead.pollNow());
  }
  globalShortcut.register(NEW_TASK_SHORTCUT, () => sendToWindow('desktop-menu', 'new-task'));
  const popover = createTrayPopover();
  const contents = popover.webContents;
  const trayUrl = `${origin}${DESKTOP_TRAY_PATH}`;
  let height = TRAY_FIRST_HEIGHT;
  let hiddenAt = 0;
  let documentState: 'loading' | 'usable' | 'failed' = 'failed';
  let navigation = 0;
  let waitingForCommit = false;
  const state = (): DesktopTrayState => ({
    runner: controls.runner(),
    keepAwake: keepAwake.isOn(),
    accent: systemAccent(),
  });
  const publish = (): void => {
    if (!contents.isDestroyed()) contents.send('desktop-tray:state', state());
    pushMenu();
  };
  const place = (): void => {
    if (created === null) return;
    const iconBounds = created.getBounds();
    popover.setBounds(
      trayPopoverBounds(iconBounds, screen.getDisplayMatching(iconBounds).workArea, height),
    );
  };
  const hide = (): void => {
    trayOpenUntil = 0;
    if (popover.isVisible()) popover.hide();
  };
  contents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || input.key !== 'Escape') return;
    if (popover.isVisible()) event.preventDefault();
    hide();
  });
  popover.on('close', (event) => {
    if (quitting) return;
    event.preventDefault();
    hide();
  });
  popover.on('blur', () => {
    hiddenAt = Date.now();
    hide();
  });
  if (IS_MAC) {
    app.on('did-resign-active', () => {
      trayOpenUntil = 0;
    });
  }
  const show = (): void => {
    if (quitting) return;
    place();
    popover.show();
    if (!IS_MAC) popover.focus();
    publish();
  };
  const failDocument = (): void => {
    documentState = 'failed';
    hide();
  };
  const reconcileStoppedLoad = (attempt = navigation): void => {
    setImmediate(() => {
      if (
        attempt === navigation &&
        documentState === 'loading' &&
        !contents.isDestroyed() &&
        !contents.isLoading()
      ) {
        failDocument();
      }
    });
  };
  const loadTray = (): void => {
    navigation++;
    waitingForCommit = true;
    documentState = 'loading';
    const load = popover.loadURL(trayUrl);
    const attempt = navigation;
    void load.catch(() => reconcileStoppedLoad(attempt));
  };
  const toggle = (): void => {
    if (popover.isVisible() || Date.now() - hiddenAt < TRAY_REOPEN_GUARD_MS) {
      hide();
      return;
    }
    if (documentState === 'usable') {
      show();
      return;
    }
    const now = performance.now();
    trayOpenUntil = now < trayOpenUntil ? 0 : now + TRAY_QUEUED_OPEN_MS;
    if (documentState === 'failed') loadTray();
  };
  contents.on('did-start-navigation', ({ isMainFrame, isSameDocument }) => {
    if (!isMainFrame || isSameDocument) return;
    navigation++;
    if (documentState === 'failed') {
      waitingForCommit = true;
      documentState = 'loading';
    }
  });
  contents.on('did-navigate', () => {
    waitingForCommit = false;
    documentState = 'loading';
    if (popover.isVisible()) hide();
  });
  contents.on('did-finish-load', () => {
    if (documentState !== 'loading' || waitingForCommit) return;
    documentState = 'usable';
    const shouldOpen = performance.now() < trayOpenUntil;
    trayOpenUntil = 0;
    if (shouldOpen) show();
  });
  contents.on('did-fail-provisional-load', (_event, _code, _description, _url, isMainFrame) => {
    if (isMainFrame) reconcileStoppedLoad();
  });
  contents.on('did-fail-load', (_event, code, _description, _url, isMainFrame) => {
    if (!isMainFrame) return;
    if (code === ERR_ABORTED) reconcileStoppedLoad();
    else failDocument();
  });
  contents.on('did-stop-loading', () => reconcileStoppedLoad());
  contents.on('render-process-gone', failDocument);
  const showFallback = (): void => {
    if (created !== null || quitting) return;
    const fallback = new Tray(keepAwake.isHolding() ? awakeIcon : idleIcon);
    if (IS_MAC) fallback.setIgnoreDoubleClickEvents(true);
    fallback.setToolTip(tooltip);
    fallback.on('click', toggle);
    if (IS_MAC) fallback.on('right-click', toggle);
    else fallback.setContextMenu(fallbackMenu());
    created = fallback;
  };
  const hideFallback = (): void => {
    hide();
    created?.destroy();
    created = null;
  };
  const runNativeAction = (id: string): void => {
    const action = nativeTrayAction(sentMenu, id);
    if (action === null) return;
    if (action.kind === 'open') {
      app.focus({ steal: true });
      openFromTray(action.target);
    } else if (action.kind === 'runner') {
      void controls.setRunner(action.on).then(publish);
    } else if (action.kind === 'keep-awake') {
      setKeepAwake(action.on);
      publish();
    } else {
      app.quit();
    }
  };
  const helper = nativeTrayHelper();
  if (helper === null) {
    showFallback();
  } else {
    native = startNativeTray({
      command: helper,
      args: [dirname(helper)],
      spawn,
      budget: createRestartBudget(NATIVE_TRAY_RESTART_MAX, NATIVE_TRAY_STABLE_MS),
      host: {
        up: () => {
          hideFallback();
          pushMenu(true);
          sendIcon();
        },
        down: showFallback,
        event: (event) => {
          if (event.type === 'opened' && !contents.isDestroyed()) {
            contents.send('desktop-tray:opened');
          } else if (event.type === 'action') {
            runNativeAction(event.id);
          }
        },
        log: (line) => console.error(`Cairn tray: ${line}`),
      },
    });
  }
  setInterval(publish, TRAY_REFRESH_MS);
  const fromPopover = (event: IpcMainInvokeEvent | IpcMainEvent): boolean =>
    event.sender === popover.webContents && event.senderFrame?.origin === origin;
  ipcMain.handle('desktop-tray:state', (event) => (fromPopover(event) ? state() : null));
  ipcMain.on('desktop-tray:open', (event, target: unknown) => {
    if (!fromPopover(event)) return;
    hide();
    openFromTray(target);
  });
  ipcMain.handle('desktop-tray:runner', async (event, on: unknown) => {
    if (!fromPopover(event)) return;
    await controls.setRunner(on === true);
    publish();
  });
  ipcMain.on('desktop-tray:keep-awake', (event, on: unknown) => {
    if (!fromPopover(event)) return;
    setKeepAwake(on === true);
    publish();
  });
  ipcMain.on('desktop-tray:resize', (event, next: unknown) => {
    if (!fromPopover(event) || typeof next !== 'number' || !Number.isFinite(next) || next <= 0)
      return;
    height = Math.min(next, TRAY_MAX_HEIGHT);
    if (popover.isVisible()) place();
  });
  ipcMain.on('desktop-tray:hide', (event) => {
    if (fromPopover(event)) hide();
  });
  ipcMain.on('desktop-tray:quit', (event) => {
    if (fromPopover(event)) app.quit();
  });
  ipcMain.on('desktop-tray:menu', (event, menu: unknown) => {
    if (!fromPopover(event)) return;
    const parsed = nativeTrayMenuSchema.safeParse(menu);
    if (!parsed.success) {
      console.error('Cairn tray: the page sent a menu that does not match the schema');
      return;
    }
    pageMenu = parsed.data;
    pushMenu();
  });
  loadTray();
  return {
    destroy: () => {
      native?.stop();
      native = null;
      created?.destroy();
      created = null;
    },
  };
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
    const bringRunnerUp = (): Promise<void> => {
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
    tray = showTray(origin, {
      runner: () => {
        if (runner === null) return runnerStarting !== null ? 'starting' : 'failed';
        if (runner.isRunning()) return 'on';
        return runnerWanted ? 'failed' : 'off';
      },
      setRunner: async (on) => {
        runnerWanted = on;
        if (on) await bringRunnerUp();
        else await runner?.stop();
      },
      nextRunAt: () => earliestScheduleNextRunAt(origin, ownerToken),
    });
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
  app.on('will-quit', () => windowState?.flush());
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
