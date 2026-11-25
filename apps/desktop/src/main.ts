import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { homedir, release } from 'node:os';
import { dirname, join } from 'node:path';
import { format } from 'node:util';
import {
  ACCESS_TOKEN_FILE_NAME,
  DESKTOP_SHELL_USER_AGENT,
  DESKTOP_TRAY_PATH,
  type DesktopActivity,
  type DesktopMenuCommand,
  type DesktopRunnerState,
  type DesktopTrayState,
  type DesktopUpdateState,
  desktopNotificationOptions,
  ENV_VARS,
  isAppPath,
  isDesktopActivity,
  isDesktopNotifyPayload,
  type NativeTrayMenu,
  nativeTrayMenuSchema,
  OWNER_CHANNEL_HEADER,
  OWNER_CHANNEL_MESSAGE,
  OWNER_CHANNEL_READY,
  PAGE_CAPTURE_RESULT,
  parseAccessTokenFile,
} from '@cairn/shared';
import { reapCredentialProfiles } from '@cairn/shared/credential-profile';
import {
  applyShellEnvironment,
  discoverShellEnvironment,
  SHELL_ENV_RESOLVED_VAR,
  type ShellEnvironmentPatch,
} from '@cairn/shared/shell-env';
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
  type MessageBoxOptions,
  type MessageBoxReturnValue,
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
  antigravityLocalStatus,
  stopAntigravityLogin,
} from './antigravity-auth.js';
import { appMenuTemplate } from './app-menu.js';
import {
  activeConnectionOf,
  addRemoteConnection,
  LOCAL_CONNECTION_ID,
  readConnectionCatalog,
  removeRemoteConnection,
  runnerHomeForConnection,
  setActiveConnection,
} from './connections.js';
import { installContextMenu } from './context-menu.js';
import { devinCancelLogin, devinLocalStatus, stopDevinLogin } from './devin-auth.js';
import { createIdleWatch } from './idle-update.js';
import { createKeepAwake } from './keep-awake.js';
import { LAUNCH_SETTLED_FLAG, type LaunchVerdict, settleBundleAtLaunch } from './launch-update.js';
import { desktopCredentialActions } from './local-credential-actions.js';
import { scanLocalProviders } from './local-providers.js';
import { type DesktopLocale, desktopLocale } from './locale.js';
import {
  type NativeTray,
  nativeTrayAction,
  skeletonTrayMenu,
  startNativeTray,
  withHostState,
} from './native-tray.js';
import { offlinePageHtml } from './offline-page.js';
import { desktopOtelEnv, withOtelFileEnv } from './otel-config.js';
import { openPermissionGuide, readPermissions, registerOwnComputerIpc } from './own-computer.js';
import { type CapturePage, createPageCapture } from './page-capture.js';
import { offscreenCaptureSurfaces, pageCaptureRequestOf } from './page-capture-window.js';
import { finishQuit } from './quit-steps.js';
import {
  parseRelaunchWindow,
  RELAUNCH_WINDOW_FILE_NAME,
  type RelaunchWindow,
  relaunchWindowOf,
  restoredUrl,
} from './relaunch-window.js';
import {
  isAllowedRemoteAuthUrl,
  isOfflineHttpStatus,
  isSameOriginUrl,
  parseHttpsOrigin,
} from './remote-auth.js';
import {
  clearServerOwner,
  handoffFromResidentHost,
  handoffToResidentHost,
  installResidentHost,
  isResidentInstalled,
  kickstartResidentHost,
  probeResidentServer,
  readServerOwner,
  resolveResidentAtBoot,
  uninstallResidentHost,
  waitForResidentExit,
  waitForResidentServer,
  writeServerOwner,
} from './resident-host.js';
import { createRestartBudget } from './restart-budget.js';
import {
  type LocalRunner,
  RunnerAuthPendingError,
  readRunnerRegistration,
  startLocalRunner,
} from './runner.js';
import { runnerStepsInFlight } from './runner-activity.js';
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
  updateInstallFailedCopy,
  updateOfflineCopy,
  upToDateCopy,
} from './update-copy.js';
import {
  armGuard,
  GUARD_HEALTHY_AFTER_MS,
  type GuardAction,
  type GuardEvent,
  type GuardState,
  guardStep,
} from './update-guard.js';
import { acquireUpdateLock, updateLockPath } from './update-lock.js';
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
  updateBlocker,
} from './updater.js';
import { ensureUpdaterAgent, UPDATER_ENTRY, updaterPlistPath } from './updater-agent.js';
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
const IDLE_TICK_MS = 60_000;
const BOOT_LOCK_WAIT_MS = 60_000;
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
let desktopShellEnv: ShellEnvironmentPatch = {};
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
let appOrigin: string | null = null;
let remoteClerkIssuer: string | null = null;
let showingOfflinePage = false;
let expectedOfflineUrl: string | null = null;
let activeRemoteHostName: string | null = null;
let mainWindowShown = false;
let windowState: WindowStateStore | null = null;
let tray: { destroy: () => void } | null = null;
let trayOpenUntil = 0;
let runner: LocalRunner | null = null;
let runnerStarting: Promise<void> | null = null;
let quitting = false;
let updater: Updater | null = null;
let pageActivity: DesktopActivity | null = null;
let openMessageBoxes = 0;
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
  shellEnv: ShellEnvironmentPatch = desktopShellEnv,
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
  applyShellEnvironment(env, shellEnv, process.platform);
  env[SHELL_ENV_RESOLVED_VAR] = '1';
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

function relaunchWindowPath(): string {
  return join(app.getPath('userData'), RELAUNCH_WINDOW_FILE_NAME);
}

function rememberWindowForRelaunch(): void {
  const window = mainWindow;
  if (window === null || window.isDestroyed() || appOrigin === null) return;
  const saved = relaunchWindowOf(
    {
      isVisible: () => mainWindowShown,
      isMinimized: () => window.isMinimized(),
      isMaximized: () => window.isMaximized(),
      isFullScreen: () => window.isFullScreen(),
      url: window.webContents.getURL(),
    },
    appOrigin,
  );
  try {
    writeFileSync(relaunchWindowPath(), `${JSON.stringify(saved)}\n`);
  } catch (error) {
    console.error('could not remember the window for the relaunch:', messageOf(error));
  }
}

function takeRelaunchWindow(): RelaunchWindow | null {
  const path = relaunchWindowPath();
  let raw: string | null = null;
  try {
    raw = readFileSync(path, 'utf8');
    rmSync(path, { force: true });
  } catch {}
  return parseRelaunchWindow(raw);
}

function showRestored(window: BrowserWindow, restore: RelaunchWindow | null): void {
  if (restore === null) {
    window.show();
    return;
  }
  if (!restore.visible && BACKGROUND_LAUNCH) return;
  if (restore.maximized) window.maximize();
  if (BACKGROUND_LAUNCH) window.showInactive();
  else window.show();
  if (restore.minimized) window.minimize();
  if (!restore.fullScreen) return;
  if (window.isFocused()) window.setFullScreen(true);
  else window.once('focus', () => window.setFullScreen(true));
}

function switchDesktopHost(userData: string, id: string): void {
  setActiveConnection(userData, id);
  app.relaunch({ args: relaunchArgs(false) });
  setTimeout(() => app.exit(0), STOP_TIMEOUT_MS + 3_000).unref();
  app.quit();
}

function hostMenuEntries(userData: string) {
  const catalog = readConnectionCatalog(userData);
  return [
    {
      id: LOCAL_CONNECTION_ID,
      label: 'This computer',
      active: catalog.activeId === LOCAL_CONNECTION_ID,
    },
    ...catalog.items.map((item) => ({
      id: item.id,
      label: item.name,
      active: catalog.activeId === item.id,
    })),
  ];
}

function showOfflineFallback(window: BrowserWindow, origin: string): void {
  const userData = app.getPath('userData');
  const catalog = readConnectionCatalog(userData);
  const html = offlinePageHtml({
    locale: desktopLocale(app.getLocale()),
    hostName: activeRemoteHostName ?? new URL(origin).host,
    hostUrl: origin,
    connections: [
      { id: LOCAL_CONNECTION_ID, kind: 'local', name: 'This computer' },
      ...catalog.items.map((item) => ({ id: item.id, kind: 'remote' as const, name: item.name })),
    ],
    activeId: catalog.activeId,
  });
  const offlineUrl = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
  expectedOfflineUrl = offlineUrl;
  showingOfflinePage = true;
  void window.loadURL(offlineUrl);
  if (!window.isVisible() && !BACKGROUND_LAUNCH) window.show();
}

function openWindow(origin: string, restore: RelaunchWindow | null = null): BrowserWindow {
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
  window.on('show', () => {
    if (mainWindow === window) mainWindowShown = true;
  });
  window.on('hide', () => {
    if (mainWindow === window) mainWindowShown = false;
  });
  window.once('ready-to-show', () => showRestored(window, restore));
  const forgetActivity = (): void => {
    if (mainWindow === window) pageActivity = null;
  };
  window.webContents.on('render-process-gone', forgetActivity);
  window.webContents.on('did-start-navigation', ({ isMainFrame, isSameDocument }) => {
    if (isMainFrame && !isSameDocument) forgetActivity();
  });
  window.on('close', (event) => {
    if (quitting) return;
    event.preventDefault();
    window.hide();
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (activeRemoteHostName !== null && isAllowedRemoteAuthUrl(url, origin, remoteClerkIssuer)) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          parent: window,
          width: 480,
          height: 680,
          webPreferences: {
            contextIsolation: true,
            sandbox: true,
            nodeIntegration: false,
          },
        },
      };
    }
    if (isWebUrl(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('did-create-window', (child) => {
    child.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    child.webContents.on('will-navigate', (event, url) => {
      if (isAllowedRemoteAuthUrl(url, origin, remoteClerkIssuer)) return;
      event.preventDefault();
      if (isWebUrl(url)) void shell.openExternal(url);
    });
  });
  window.webContents.on('will-navigate', (event, url) => {
    let targetOrigin: string | null = null;
    try {
      targetOrigin = new URL(url).origin;
    } catch {
      targetOrigin = null;
    }
    if (targetOrigin !== null && targetOrigin === origin) return;
    if (activeRemoteHostName !== null && isAllowedRemoteAuthUrl(url, origin, remoteClerkIssuer)) {
      return;
    }
    event.preventDefault();
    if (isWebUrl(url)) void shell.openExternal(url);
  });
  window.webContents.on('did-navigate', (_event, url, httpResponseCode) => {
    if (
      activeRemoteHostName !== null &&
      isOfflineHttpStatus(httpResponseCode) &&
      isSameOriginUrl(url, origin)
    ) {
      showOfflineFallback(window, origin);
      return;
    }
    if (expectedOfflineUrl === null || url !== expectedOfflineUrl) {
      showingOfflinePage = false;
      expectedOfflineUrl = null;
    }
  });
  window.webContents.on(
    'did-fail-load',
    (_event, code, _description, validatedUrl, isMainFrame) => {
      if (
        !isMainFrame ||
        code === ERR_ABORTED ||
        activeRemoteHostName === null ||
        validatedUrl.startsWith('data:text/html')
      ) {
        return;
      }
      showOfflineFallback(window, origin);
    },
  );
  rememberWindow(window, store);
  void window.loadURL(restore === null ? origin : restoredUrl(origin, restore.path));
  mainWindow = window;
  mainWindowShown = false;
  window.on('closed', () => {
    if (mainWindow === window) {
      mainWindow = null;
      mainWindowShown = false;
      pageActivity = null;
    }
  });
  return window;
}

function focusWindow(): void {
  const window = mainWindow;
  if (window === null) {
    if (appOrigin !== null) openWindow(appOrigin);
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
  connectionLabel: string | null;
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
  const tooltip =
    controls.connectionLabel === null ? 'Cairn' : `Cairn · ${controls.connectionLabel}`;
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
      trayMenuTemplate(
        controls.connectionLabel,
        keepAwake.isOn(),
        {
          open: focusWindow,
          setKeepAwake,
          hosts: hostMenuEntries(app.getPath('userData')),
          switchHost: (id) => switchDesktopHost(app.getPath('userData'), id),
          quit: () => app.quit(),
        },
        desktopLocale(app.getLocale()),
      ),
    );
  const setKeepAwake = (on: boolean): void => {
    keepAwake.set(on);
    refreshIcon();
    if (!IS_MAC) created?.setContextMenu(fallbackMenu());
  };
  let wakeAhead: ReturnType<typeof createWakeAhead> | null = null;
  if (controls.nextRunAt !== undefined) {
    const nextRunAt = controls.nextRunAt;
    const monitor = createWakeAhead({
      nextRunAt,
      onWindow: (active) => {
        keepAwake.setWakeAhead(active);
        refreshIcon();
      },
    });
    wakeAhead = monitor;
    monitor.start();
    powerMonitor.on('resume', () => void monitor.pollNow());
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
  let pendingLoadStart = false;
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
        !pendingLoadStart &&
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
    pendingLoadStart = true;
    documentState = 'loading';
    const load = popover.loadURL(trayUrl);
    const attempt = navigation;
    void load.catch(() => {
      if (attempt === navigation) pendingLoadStart = false;
      reconcileStoppedLoad(attempt);
    });
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
    trayOpenUntil =
      now < trayOpenUntil
        ? 0
        : documentState === 'failed'
          ? Number.POSITIVE_INFINITY
          : now + TRAY_QUEUED_OPEN_MS;
    if (documentState === 'failed') loadTray();
  };
  contents.on('did-start-navigation', ({ isMainFrame, isSameDocument }) => {
    if (!isMainFrame || isSameDocument) return;
    navigation++;
    pendingLoadStart = false;
    if (documentState === 'failed') {
      waitingForCommit = true;
      documentState = 'loading';
    }
  });
  contents.on('did-navigate', () => {
    waitingForCommit = false;
    pendingLoadStart = false;
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
    if (!isMainFrame || pendingLoadStart) return;
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
  const refreshTimer = setInterval(publish, TRAY_REFRESH_MS);
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
      clearInterval(refreshTimer);
      wakeAhead?.stop();
      wakeAhead = null;
      native?.stop();
      native = null;
      created?.destroy();
      created = null;
    },
  };
}

async function messageBox(options: MessageBoxOptions): Promise<MessageBoxReturnValue> {
  openMessageBoxes += 1;
  try {
    return await dialog.showMessageBox(options);
  } finally {
    openMessageBoxes -= 1;
  }
}

function servePageActivity(origin: string): void {
  ipcMain.on('desktop-activity', (event, activity: unknown) => {
    if (
      mainWindow?.webContents !== event.sender ||
      event.senderFrame !== event.sender.mainFrame ||
      event.senderFrame?.origin !== origin ||
      !isDesktopActivity(activity)
    ) {
      return;
    }
    pageActivity = { turnInFlight: activity.turnInFlight, dialogOpen: activity.dialogOpen };
  });
}

function serveNotifications(origin: string): void {
  ipcMain.on('desktop-notify', (event, payload: unknown) => {
    if (event.senderFrame?.origin !== origin || !isDesktopNotifyPayload(payload)) return;
    const fallback = (): void => {
      if (payload.dialog !== undefined) {
        void messageBox({
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

function serveUpdates(
  origin: string,
  notice: UpdateNotice | null,
  ownerToken: string,
  allowLocalCredentials = true,
): void {
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
          desktopLocale(app.getLocale()),
          {
            entries: hostMenuEntries(app.getPath('userData')),
            switchHost: (id) => switchDesktopHost(app.getPath('userData'), id),
          },
        ),
      ),
    );
  const created = createUpdater(
    (state) => {
      showMenu(state);
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send('desktop-update:state', state);
      }
    },
    { beforeRelaunch: rememberWindowForRelaunch },
  );
  updater = created;
  let lastCheckedAt = 0;
  const check = (): Promise<void> => {
    lastCheckedAt = Date.now();
    return created.check();
  };
  const installFromMenu = async (): Promise<void> => {
    try {
      await installChosenUpdate();
    } catch (error) {
      const copy = updateInstallFailedCopy(await windowLocale(), messageOf(error));
      await messageBox({ type: 'warning', message: copy.title, detail: copy.detail });
    }
  };
  const installChosenUpdate = async (): Promise<void> => {
    const state = created.state();
    if (state.status === 'ready') {
      await created.apply('foreground');
      return;
    }
    if (state.status !== 'available') return;
    const blocked =
      readUpdateState(updateStatePath(app.getPath('userData'))).blocked?.version === state.version;
    const copy = installUpdateCopy(await windowLocale(), state.version, app.getVersion(), blocked);
    const { response } = await messageBox({
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
      await messageBox({ type: 'info', message: copy.title, detail: copy.detail });
    } else if (state.status === 'unsupported') {
      const copy = unsupportedUpdateCopy(await windowLocale(), state.blocker);
      await messageBox({ type: 'info', message: copy.title, detail: copy.detail });
    } else if (state.status === 'offline') {
      const copy = updateOfflineCopy(await windowLocale());
      await messageBox({ type: 'info', message: copy.title, detail: copy.detail });
    } else if (state.status === 'error') {
      const copy = updateCheckFailedCopy(await windowLocale(), state.message);
      await messageBox({ type: 'warning', message: copy.title, detail: copy.detail });
    }
  };
  showMenu(created.state());
  let pendingNotice = notice;
  const fromOwnPage = (event: IpcMainInvokeEvent | IpcMainEvent): boolean =>
    event.senderFrame?.origin === origin;
  const fromMainPage = (event: IpcMainInvokeEvent): boolean =>
    !quitting &&
    mainWindow?.webContents === event.sender &&
    event.senderFrame === event.sender.mainFrame &&
    fromOwnPage(event);
  ipcMain.handle('desktop-update:rollback-notice', (event) => {
    if (!fromMainPage(event)) return null;
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
  const workerPath = join(
    app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'dist'),
    'antigravity-login-worker.mjs',
  );
  const credentials = allowLocalCredentials
    ? desktopCredentialActions(
        origin,
        ownerToken,
        ownerChannelKey,
        app.getPath('userData'),
        workerPath,
      )
    : null;
  const fromLocalMainPage = (event: IpcMainInvokeEvent): boolean =>
    allowLocalCredentials && fromMainPage(event);
  ipcMain.handle('local-providers:scan', (event) =>
    fromLocalMainPage(event) ? scanLocalProviders() : [],
  );
  ipcMain.handle('local-providers:import', (event, input: unknown) =>
    fromLocalMainPage(event) && credentials !== null ? credentials.importProviders(input) : [],
  );
  ipcMain.handle('devin:status', (event) =>
    fromLocalMainPage(event) ? devinLocalStatus() : { loggedIn: false, canLogin: false },
  );
  ipcMain.handle('devin:import', (event, input: unknown) =>
    fromLocalMainPage(event) && credentials !== null
      ? credentials.importDevin(input)
      : { ok: false, reason: 'cancelled' },
  );
  ipcMain.handle('devin:login', (event, input: unknown) =>
    fromLocalMainPage(event) && credentials !== null
      ? credentials.loginDevin(input)
      : { ok: false, reason: 'cancelled' },
  );
  ipcMain.handle('devin:cancel-login', (event) => {
    if (fromLocalMainPage(event)) devinCancelLogin();
  });
  ipcMain.handle('antigravity:status', async (event) => {
    if (!fromLocalMainPage(event)) return { installed: false, loggedIn: false, canLogin: false };
    const status = await antigravityLocalStatus();
    const runnerId = readRunnerRegistration(runnerHome())?.machineId;
    return runnerId === undefined ? status : { ...status, runnerId };
  });
  ipcMain.handle('antigravity:import', (event, input: unknown) =>
    fromLocalMainPage(event) && credentials !== null
      ? credentials.importAntigravity(input)
      : { ok: false, reason: 'cancelled' },
  );
  ipcMain.handle('antigravity:login', async (event, input: unknown, subscriptionId?: unknown) => {
    if (!fromLocalMainPage(event) || credentials === null) {
      return { ok: false, reason: 'cancelled' };
    }
    const controller = new AbortController();
    const cancel = () => controller.abort();
    event.sender.once('render-process-gone', cancel);
    event.sender.once('destroyed', cancel);
    try {
      const outcome = await credentials.loginAntigravity(
        input,
        (phase) => {
          if (!event.sender.isDestroyed()) event.sender.send('antigravity:login-progress', phase);
        },
        controller.signal,
        subscriptionId,
      );
      const runnerId = readRunnerRegistration(runnerHome())?.machineId;
      return outcome.ok && runnerId !== undefined ? { ...outcome, runnerId } : outcome;
    } finally {
      event.sender.removeListener('render-process-gone', cancel);
      event.sender.removeListener('destroyed', cancel);
    }
  });
  ipcMain.handle('antigravity:cancel-login', (event) => {
    if (fromMainPage(event)) antigravityCancelLogin();
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
  settled(): boolean;
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
        knownVersion: installed.previousVersion,
        blocked: { version: installed.version, at, reason, attempts: attempts + 1 },
        notice: {
          failedVersion: installed.version,
          restoredVersion: installed.previousVersion,
          reason,
          logPath: updateLogPath(userData),
          at,
        },
      });
      rememberWindowForRelaunch();
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
    settled: () => !rolling && guard.phase !== 'armed',
  };
}

function confirmAfterBoot(guard: VersionGuard | null): void {
  if (guard === null) return;
  void guard.step('health-ok', 'started without a server of its own');
  setTimeout(
    () => void guard.step('health-ok', 'stayed up without a server of its own'),
    GUARD_HEALTHY_AFTER_MS,
  ).unref();
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
    if (running.exitCode === null && server === running) void probe();
  }, HEALTH_PROBE_MS);
  timer.unref();
  void probe();
}

function watchIdleUpdate(runnerHome: string): void {
  const watch = createIdleWatch();
  const used = (): void => watch.cairnUsed(Date.now());
  app.on('browser-window-focus', used);
  app.on('browser-window-blur', used);
  const tick = (): void => {
    const current = updater;
    if (current === null) return;
    const state = current.state();
    const verdict = watch.sample({
      now: Date.now(),
      ready: state.status === 'ready',
      guardSettled: activeGuard === null || activeGuard.settled(),
      locked: powerMonitor.getSystemIdleState(1) === 'locked',
      inputIdleMs: powerMonitor.getSystemIdleTime() * 1000,
      cairnFocused: BrowserWindow.getFocusedWindow() !== null,
      turnInFlight: pageActivity?.turnInFlight === true,
      dialogOpen: openMessageBoxes > 0 || pageActivity?.dialogOpen === true,
      stepsInFlight: runner === null ? 0 : runnerStepsInFlight(runnerHome),
    });
    if (!verdict.apply || state.status !== 'ready') return;
    appendUpdateLog(
      app.getPath('userData'),
      `applying ${state.version} while the user is away (${verdict.trigger})`,
    );
    void current
      .apply('background')
      .catch((error: unknown) =>
        console.error('applying the idle update failed:', messageOf(error)),
      );
  };
  setInterval(tick, IDLE_TICK_MS).unref();
  powerMonitor.on('lock-screen', tick);
  powerMonitor.on('resume', tick);
}

async function settleLaunch(userData: string): Promise<LaunchVerdict> {
  if (!IS_MAC || !app.isPackaged) return 'continue';
  const release = await acquireUpdateLock(updateLockPath(userData), 'app', BOOT_LOCK_WAIT_MS);
  let verdict: LaunchVerdict;
  try {
    verdict = await settleBundleAtLaunch({
      bundle: runningBundle(),
      userData,
      runningVersion: app.getVersion(),
      settled: process.argv.includes(LAUNCH_SETTLED_FLAG),
      log: (line) => appendUpdateLog(userData, line),
    });
  } finally {
    release?.();
  }
  if (verdict === 'relaunch') {
    quitting = true;
    app.relaunch({ args: [...relaunchArgs(BACKGROUND_LAUNCH), LAUNCH_SETTLED_FLAG] });
    app.exit(0);
  }
  return verdict;
}

function keepUpdaterAgent(userData: string): void {
  if (!IS_MAC || !app.isPackaged) return;
  void updateBlocker(runningBundle())
    .then(async (blocker) => {
      if (blocker !== null) return;
      const result = await ensureUpdaterAgent({
        executablePath: process.execPath,
        entry: join(process.resourcesPath, UPDATER_ENTRY),
        userData,
        plistPath: updaterPlistPath(homedir()),
      });
      if (result === 'installed') appendUpdateLog(userData, 'registered the background updater');
    })
    .catch((error: unknown) =>
      console.error('registering the background updater failed:', messageOf(error)),
    );
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
    try {
      reapCredentialProfiles(userData);
    } catch {
      console.warn('Could not clean abandoned credential profiles');
    }
    const discoveredShell = await discoverShellEnvironment({
      env: process.env,
      cachePath: join(userData, 'shell-environment-cache.json'),
      onWarn: (message) => console.warn(message),
      onRefresh: (refreshed) => {
        desktopShellEnv = refreshed.patch;
        applyShellEnvironment(process.env, refreshed.patch, process.platform);
      },
    });
    desktopShellEnv = discoveredShell.patch;
    applyShellEnvironment(process.env, discoveredShell.patch, process.platform);
    process.env[SHELL_ENV_RESOLVED_VAR] = '1';
    const preLaunchUpdateState = readUpdateState(updateStatePath(userData));
    const bundleVersionChanged =
      preLaunchUpdateState.knownVersion !== null &&
      preLaunchUpdateState.knownVersion !== app.getVersion();
    if ((await settleLaunch(userData)) === 'relaunch') return;
    const notice = takeRollbackNotice(userData);
    guard = armVersionGuard(userData);
    activeGuard = guard;
    const residentUpdatedAt = preLaunchUpdateState.installed?.at ?? notice?.at ?? null;
    const otelEnvPath = join(userData, 'otel.env');
    const otelEnv = desktopOtelEnv(otelEnvPath, console.error);
    const otelFile = otelEnv.CAIRN_OTEL_ENDPOINT === undefined ? null : otelEnvPath;
    serverOtelFile = otelFile;
    otelHeaderLogSecrets.push(...otelHeaderSecrets(otelEnv.CAIRN_OTEL_HEADERS));

    const catalog = readConnectionCatalog(userData);
    const activeConn = activeConnectionOf(catalog);
    let origin: string;
    let ownerToken = '';
    let attachedToResident = false;

    const refreshRemoteClerkIssuer = async (remoteOrigin: string): Promise<void> => {
      try {
        const response = await session.defaultSession.fetch(
          `${remoteOrigin}/api/auth/clerk/config`,
          {
            redirect: 'error',
            signal: AbortSignal.timeout(2_500),
          },
        );
        if (response.ok) {
          const body = (await response.json()) as { enabled?: boolean; issuer?: unknown };
          remoteClerkIssuer = body.enabled === true ? parseHttpsOrigin(body.issuer) : null;
        }
      } catch {}
    };

    if (activeConn.kind === 'remote') {
      origin = activeConn.url;
      activeRemoteHostName = activeConn.name;
      remoteClerkIssuer = null;
      await refreshRemoteClerkIssuer(origin);
    } else {
      activeRemoteHostName = null;
      remoteClerkIssuer = null;
      const resident = IS_MAC
        ? await resolveResidentAtBoot({
            homeDir: homedir(),
            executablePath: process.execPath,
            serverEntry: join(bundledRoot('server'), 'dist', 'index.mjs'),
            cairnHome: cairnHome(),
            logDir: join(userData, 'logs'),
            versionChanged: bundleVersionChanged,
            updatedAt: residentUpdatedAt,
            probe: (home) => probeResidentServer(home),
            waitForHealthy: (opts) => waitForResidentServer(cairnHome(), opts),
            install: () =>
              installResidentHost({
                homeDir: homedir(),
                executablePath: process.execPath,
                serverEntry: join(bundledRoot('server'), 'dist', 'index.mjs'),
                cairnHome: cairnHome(),
                logDir: join(userData, 'logs'),
              }),
            kickstart: () => kickstartResidentHost({ homeDir: homedir() }),
          }).catch((error: unknown) => {
            console.warn('Could not attach to resident host at boot:', messageOf(error));
            return null;
          })
        : await probeResidentServer(cairnHome());
      if (resident !== null) {
        origin = resident.origin;
        attachedToResident = true;
        ownerToken = readOwnerToken();
        if (ownerToken !== '') signOwnPagesIn(origin, ownerToken);
      } else {
        const port = await serverPort();
        server = startServer(port, otelFile, serverExited, desktopShellEnv);
        await waitUntilServing(server);
        writeServerOwner(cairnHome(), {
          pid: process.pid,
          port,
          origin: server.origin,
          managedBy: 'desktop',
          startedAt: Date.now(),
        });
        startHealthWatch(server, guard);
        ownerToken = readOwnerToken();
        signOwnPagesIn(server.origin, ownerToken);
        origin = server.origin;
      }
    }
    appOrigin = origin;

    const activeRunnerHome = runnerHomeForConnection(runnerHome(), userData, activeConn.id);
    let runnerWanted = true;
    const bringRunnerUp = (): Promise<void> => {
      if (runner !== null) {
        runner.ensureRunning();
        return Promise.resolve();
      }
      const legacyRunnerDir = join(app.getPath('userData'), 'runner');
      if (activeConn.id === LOCAL_CONNECTION_ID) {
        migrateRunnerHome(legacyRunnerDir, activeRunnerHome);
      }
      runnerStarting ??= startLocalRunner({
        root: bundledRoot('runner'),
        home: activeRunnerHome,
        legacyHomes:
          activeConn.id === LOCAL_CONNECTION_ID
            ? [legacyRunnerDir, join(app.getPath('userData'), 'runner-home')]
            : [],
        serverHome: cairnHome(),
        origin,
        ownerToken,
        ownerChannelKey: activeConn.kind === 'local' ? ownerChannelKey : '',
        authMode: activeConn.kind === 'remote' ? 'session' : 'token',
        ...(activeConn.kind === 'remote'
          ? {
              fetchImpl: ((input, init) =>
                session.defaultSession.fetch(input as string, init as RequestInit)) as typeof fetch,
            }
          : {}),
        otelFile,
        agentDesktop: agentDesktopBinary(),
        shellEnv: () => desktopShellEnv,
        isQuitting: () => quitting,
      })
        .then(
          (started) => {
            runner = started;
          },
          (error: unknown) => {
            if (error instanceof RunnerAuthPendingError) {
              console.info(error.message);
              return;
            }
            console.error('Cairn Runner did not start:', error);
          },
        )
        .finally(() => {
          runnerStarting = null;
        });
      return runnerStarting;
    };
    if (activeConn.kind === 'remote') {
      const originHost = new URL(origin).hostname.toLowerCase();
      session.defaultSession.cookies.on('changed', (_event, cookie, _cause, removed) => {
        if (
          removed ||
          !runnerWanted ||
          runner !== null ||
          runnerStarting !== null ||
          cookie.name !== 'cairn_auth'
        ) {
          return;
        }
        const rawDomain = cookie.domain?.toLowerCase() ?? '';
        const domain = rawDomain.replace(/^\./, '');
        if (
          domain !== '' &&
          (domain === originHost ||
            (rawDomain.startsWith('.') && originHost.endsWith(`.${domain}`)))
        ) {
          void bringRunnerUp();
        }
      });
    }
    void bringRunnerUp();
    tray = showTray(origin, {
      connectionLabel: activeConn.kind === 'local' ? null : activeConn.name || new URL(origin).host,
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
    const fromOfflinePage = (event: IpcMainInvokeEvent): boolean =>
      !quitting &&
      showingOfflinePage &&
      expectedOfflineUrl !== null &&
      mainWindow?.webContents === event.sender &&
      event.senderFrame === event.sender.mainFrame &&
      event.senderFrame?.url === expectedOfflineUrl;
    const fromHostMainPage = (event: IpcMainInvokeEvent): boolean =>
      !quitting &&
      mainWindow?.webContents === event.sender &&
      event.senderFrame === event.sender.mainFrame &&
      event.senderFrame?.origin === origin;
    const hostStatus = () => {
      const current = readConnectionCatalog(userData);
      return {
        activeId: current.activeId,
        connections: [
          { id: LOCAL_CONNECTION_ID, kind: 'local' as const, name: 'This computer', url: null },
          ...current.items.map((item) => ({
            id: item.id,
            kind: 'remote' as const,
            name: item.name,
            url: item.url,
          })),
        ],
        residentSupported: IS_MAC && activeConn.kind === 'local',
        residentInstalled: isResidentInstalled(homedir()),
        attachedToResident,
      };
    };
    ipcMain.handle('desktop-host:status', (event) => {
      if (!fromHostMainPage(event)) return null;
      return hostStatus();
    });
    ipcMain.handle('desktop-host:add-remote', (event, input: unknown) => {
      if (!fromHostMainPage(event)) return null;
      if (
        typeof input !== 'object' ||
        input === null ||
        typeof (input as { name?: unknown }).name !== 'string' ||
        typeof (input as { url?: unknown }).url !== 'string'
      ) {
        throw new Error('Invalid remote connection input');
      }
      addRemoteConnection(userData, {
        name: (input as { name: string }).name,
        url: (input as { url: string }).url,
      });
      return hostStatus();
    });
    ipcMain.handle('desktop-host:remove-remote', (event, id: unknown) => {
      if (!fromHostMainPage(event)) return null;
      if (typeof id !== 'string' || id === '') throw new Error('Invalid connection id');
      removeRemoteConnection(userData, id);
      return hostStatus();
    });
    ipcMain.handle('desktop-host:switch', (event, id: unknown) => {
      if (!fromHostMainPage(event) && !fromOfflinePage(event)) return null;
      if (typeof id !== 'string' || id === '') throw new Error('Invalid connection id');
      switchDesktopHost(userData, id);
      return hostStatus();
    });
    ipcMain.handle('desktop-host:retry', async (event) => {
      if (!fromHostMainPage(event) && !fromOfflinePage(event)) return;
      showingOfflinePage = false;
      expectedOfflineUrl = null;
      if (activeRemoteHostName !== null) {
        await refreshRemoteClerkIssuer(origin);
      }
      void mainWindow?.loadURL(origin);
    });
    let residentTransitionInFlight = false;
    const relaunchForHostTransition = (): void => {
      rememberWindowForRelaunch();
      setTimeout(() => {
        app.relaunch({ args: relaunchArgs(false) });
        setTimeout(() => app.exit(0), STOP_TIMEOUT_MS + 3_000).unref();
        app.quit();
      }, 50).unref();
    };
    ipcMain.handle('desktop-host:set-resident', async (event, enabled: unknown) => {
      if (!fromHostMainPage(event) || activeConn.kind !== 'local') return null;
      if (typeof enabled !== 'boolean') throw new Error('enabled must be boolean');
      if (residentTransitionInFlight) return hostStatus();
      residentTransitionInFlight = true;
      try {
        if (enabled) {
          const running = server;
          const previousPort = running === null ? null : serverPortOf(running);
          const previousOwner = readServerOwner(cairnHome());
          const excludePid = previousOwner?.managedBy === 'launchd' ? previousOwner.pid : undefined;
          await handoffToResidentHost({
            hasEmbeddedServer: running !== null,
            stopEmbeddedServer: async () => {
              if (running === null) return;
              server = null;
              await stopServer(running);
              clearServerOwner(cairnHome(), process.pid);
            },
            restoreEmbeddedServer: async () => {
              const port = previousPort ?? (await serverPort());
              const restored = startServer(port, otelFile, serverExited, desktopShellEnv);
              server = restored;
              await waitUntilServing(restored);
              writeServerOwner(cairnHome(), {
                pid: process.pid,
                port,
                origin: restored.origin,
                managedBy: 'desktop',
                startedAt: Date.now(),
              });
              startHealthWatch(restored, activeGuard);
            },
            install: () =>
              installResidentHost({
                homeDir: homedir(),
                executablePath: process.execPath,
                serverEntry: join(bundledRoot('server'), 'dist', 'index.mjs'),
                cairnHome: cairnHome(),
                logDir: join(userData, 'logs'),
              }),
            uninstall: () => uninstallResidentHost({ homeDir: homedir() }),
            waitForHealthy: () =>
              waitForResidentServer(cairnHome(), { excludePid, timeoutMs: 20_000 }),
            relaunch: relaunchForHostTransition,
          });
        } else {
          await handoffFromResidentHost({
            attachedToResident,
            uninstall: () => uninstallResidentHost({ homeDir: homedir() }),
            waitForExit: () => waitForResidentExit(cairnHome(), { timeoutMs: STOP_TIMEOUT_MS }),
            relaunch: relaunchForHostTransition,
          });
        }
        return hostStatus();
      } finally {
        residentTransitionInFlight = false;
      }
    });
    void removeLeftoverUpdates();
    serveUpdates(origin, notice, ownerToken, activeConn.kind === 'local');
    serveNotifications(origin);
    servePageActivity(origin);
    serveOwnComputer(origin, agentDesktopBinary());
    watchIdleUpdate(activeRunnerHome);
    const restore = takeRelaunchWindow();
    if (restore !== null || !BACKGROUND_LAUNCH) openWindow(origin, restore);
    if (server === null) confirmAfterBoot(guard);
    keepUpdaterAgent(userData);
  } catch (error) {
    const reason = messageOf(error);
    if (guard !== null) {
      await guard.step('boot-failed', reason);
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
    if (quitting) return;
    quitting = true;
    globalShortcut.unregisterAll();
    event.preventDefault();
    const running = server;
    void finishQuit({
      stopHelpers: () => Promise.all([stopAntigravityLogin(), stopDevinLogin(), runner?.stop()]),
      stopOwnServer:
        running === null
          ? null
          : () => stopServer(running).then(() => clearServerOwner(cairnHome(), process.pid)),
      rollingBack: () => activeGuard?.rollingBack() === true,
      applyUpdate: async () => {
        await updater?.apply('none');
      },
    })
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
