import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
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
import { desktopOtelEnv, type OtelEnv, withOtelEnv } from './otel-config.js';
import { openPermissionGuide, readPermissions, registerOwnComputerIpc } from './own-computer.js';
import { createRestartBudget } from './restart-budget.js';
import { type LocalRunner, startLocalRunner } from './runner.js';
import { runnerHomeFor } from './runner-home.js';
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
const TRAY_FIRST_HEIGHT = 440;
const TRAY_MAX_HEIGHT = 900;
const TRAY_REFRESH_MS = 2_000;
const TRAY_REOPEN_GUARD_MS = 250;
const TRAY_LIGHT_FILL = '#f6f6f6';
const TRAY_DARK_FILL = '#2b2b2b';
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
let serverOtelEnv: OtelEnv | null = null;
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
      dialog.showErrorBox('Cairn server stopped', `The Cairn server exited with code ${code}.`);
      app.quit();
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

function migrateRunnerHome(): void {
  const legacy = join(app.getPath('userData'), 'runner');
  const target = runnerHome();
  let entries: string[];
  try {
    entries = readdirSync(legacy);
  } catch {
    return;
  }
  for (const entry of entries) {
    const to = join(target, entry);
    try {
      if (existsSync(to) || lstatSync(join(legacy, entry)).isSymbolicLink()) continue;
      mkdirSync(target, { recursive: true, mode: 0o700 });
      renameSync(join(legacy, entry), to);
    } catch (error) {
      console.warn(`runner-home migration skipped ${entry}:`, error);
    }
  }
  try {
    const claudeTarget = join(target, 'homes', 'claude');
    if (
      existsSync(join(target, 'claude')) &&
      !existsSync(claudeTarget) &&
      !lstatSync(join(target, 'claude')).isSymbolicLink()
    ) {
      mkdirSync(dirname(claudeTarget), { recursive: true });
      renameSync(join(target, 'claude'), claudeTarget);
    }
  } catch (error) {
    console.warn('runner-home claude home migration failed:', error);
  }
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

function startServer(
  port: number,
  otelEnv: OtelEnv,
  onExit: (dead: RunningServer, code: number | null) => void,
): RunningServer {
  serverRestartBudget.started();
  const env = withOtelEnv(
    {
      ...process.env,
      HOST: LOOPBACK,
      PORT: String(port),
      [ENV_VARS.home]: cairnHome(),
      [ENV_VARS.parentPid]: String(process.pid),
    },
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
  const next = startServer(serverPortOf(dead), serverOtelEnv as OtelEnv, serverExited);
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
  installContextMenu(window.webContents, { clipboard, Menu });
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

function createTrayPopover(origin: string): BrowserWindow {
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
  popover.on('close', (event) => {
    if (quitting) return;
    event.preventDefault();
    popover.hide();
  });
  popover.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  popover.webContents.on('will-navigate', (event) => event.preventDefault());
  void popover.loadURL(`${origin}${DESKTOP_TRAY_PATH}`);
  return popover;
}

function systemAccent(): string | null {
  if (!IS_MAC) return null;
  return `#${systemPreferences.getAccentColor().slice(0, 6)}`;
}

function showTray(origin: string, controls: TrayControls): Tray {
  const trayIcon = (name: string): NativeImage => {
    const image = nativeImage.createFromPath(join(app.getAppPath(), 'assets', name));
    image.setTemplateImage(true);
    return image;
  };
  const idleIcon = trayIcon('trayTemplate.png');
  const awakeIcon = trayIcon('trayAwakeTemplate.png');
  const keepAwake = createKeepAwake(powerSaveBlocker, join(app.getPath('userData'), 'keep-awake'));
  const created = new Tray(keepAwake.isOn() ? awakeIcon : idleIcon);
  const refreshIcon = (): void => {
    created.setImage(keepAwake.isOn() ? awakeIcon : idleIcon);
  };
  const fallbackMenu = (): Menu =>
    Menu.buildFromTemplate(
      trayMenuTemplate(new URL(origin).host, keepAwake.isOn(), {
        open: focusWindow,
        setKeepAwake,
        quit: () => app.quit(),
      }),
    );
  created.setToolTip(`Cairn · ${new URL(origin).host}`);
  const setKeepAwake = (on: boolean): void => {
    keepAwake.set(on);
    refreshIcon();
    if (!IS_MAC) created.setContextMenu(fallbackMenu());
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
  const popover = createTrayPopover(origin);
  let height = TRAY_FIRST_HEIGHT;
  let hiddenAt = 0;
  const state = (): DesktopTrayState => ({
    runner: controls.runner(),
    keepAwake: keepAwake.isOn(),
    accent: systemAccent(),
  });
  const publish = (): void => {
    if (popover.isVisible()) popover.webContents.send('desktop-tray:state', state());
  };
  const place = (): void => {
    const iconBounds = created.getBounds();
    popover.setBounds(
      trayPopoverBounds(iconBounds, screen.getDisplayMatching(iconBounds).workArea, height),
    );
  };
  const hide = (): void => {
    if (popover.isVisible()) popover.hide();
  };
  popover.on('blur', () => {
    hiddenAt = Date.now();
    popover.hide();
  });
  const toggle = (): void => {
    if (popover.isVisible() || Date.now() - hiddenAt < TRAY_REOPEN_GUARD_MS) {
      hide();
      return;
    }
    const show = (): void => {
      place();
      popover.show();
      if (!IS_MAC) popover.focus();
      publish();
    };
    if (popover.webContents.isLoading()) popover.once('ready-to-show', show);
    else show();
  };
  created.on('click', toggle);
  (app as NodeJS.EventEmitter).on('cairn-tray-toggle', toggle);
  if (IS_MAC) created.on('right-click', toggle);
  else created.setContextMenu(fallbackMenu());
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
  return created;
}

function serveNotifications(origin: string): void {
  ipcMain.on('desktop-notify', (event, payload: unknown) => {
    if (event.senderFrame?.origin !== origin || !isDesktopNotifyPayload(payload)) return;
    if (!Notification.isSupported()) return;
    const notification = new Notification(desktopNotificationOptions(payload));
    notification.on('click', () => sendToWindow('desktop-navigate', payload.href));
    notification.on('failed', (_event, error) => console.warn('notification failed:', error));
    notification.show();
  });
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
    const { response } = await dialog.showMessageBox({
      type: 'question',
      message: `Cairn ${state.version} is available`,
      detail:
        readUpdateState(updateStatePath(app.getPath('userData'))).blocked?.version === state.version
          ? `${state.version} did not start here last time. Cairn will install it again because you asked.`
          : `You have ${app.getVersion()}. Cairn downloads the update and restarts to install it.`,
      buttons: ['Install and Restart', 'Later'],
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
  showMenu(created.state());
  const fromOwnPage = (event: IpcMainInvokeEvent | IpcMainEvent): boolean =>
    event.senderFrame?.origin === origin;
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
    fromOwnPage(event) ? antigravityLogin() : { ok: false, reason: 'cancelled' },
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

async function tellRollback(notice: UpdateNotice): Promise<void> {
  const line = `${notice.failedVersion} did not start, so Cairn went back to ${notice.restoredVersion}.`;
  if (Notification.isSupported()) {
    const delivered = await new Promise<boolean>((done) => {
      const notification = new Notification({ title: 'Cairn rolled back an update', body: line });
      notification.on('failed', () => done(false));
      notification.on('show', () => done(true));
      notification.show();
      setTimeout(() => done(true), 3_000).unref();
    });
    if (delivered) return;
  }
  await dialog.showMessageBox({
    type: 'warning',
    message: 'Cairn rolled back an update',
    detail: `${line}\n\nThe failure is logged in ${notice.logPath}.`,
  });
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
      dialog.showErrorBox('Cairn could not start', `${reason}\n\n${messageOf(error)}`);
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
    const otelEnv = desktopOtelEnv(join(userData, 'otel.env'), console.error);
    serverOtelEnv = otelEnv;
    otelHeaderLogSecrets.push(...otelHeaderSecrets(otelEnv.CAIRN_OTEL_HEADERS));
    server = startServer(await serverPort(), otelEnv, serverExited);
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
      migrateRunnerHome();
      runnerStarting ??= startLocalRunner({
        root: bundledRoot('runner'),
        home: runnerHome(),
        serverHome: cairnHome(),
        origin,
        ownerToken,
        otelEnv,
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
    serveUpdates(server.origin);
    serveNotifications(server.origin);
    serveOwnComputer(server.origin, agentDesktopBinary());
    watchIdleUpdate();
    if (!BACKGROUND_LAUNCH) openWindow(server.origin);
    if (notice !== null) void tellRollback(notice);
  } catch (error) {
    const reason = messageOf(error);
    if (guard !== null) {
      await guard.step('health-failed', reason);
      if (guard.rollingBack()) return;
    }
    quitting = true;
    dialog.showErrorBox('Cairn could not start', reason);
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
