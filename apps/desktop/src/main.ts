import { readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { ACCESS_TOKEN_FILE_NAME, ENV_VARS, parseAccessTokenFile } from '@cairn/shared';
import {
  app,
  BrowserWindow,
  dialog,
  session,
  shell,
  type UtilityProcess,
  utilityProcess,
} from 'electron';

const LOOPBACK = '127.0.0.1';
const READY_TIMEOUT_MS = 60_000;
const READY_POLL_MS = 250;
const STOP_TIMEOUT_MS = 10_000;

interface RunningServer {
  process: UtilityProcess;
  origin: string;
  exitCode: number | null;
}

let server: RunningServer | null = null;
let quitting = false;

function serverRoot(): string {
  return app.isPackaged ? join(process.resourcesPath, 'server') : join(app.getAppPath(), 'server');
}

function cairnHome(): string {
  return join(app.getPath('userData'), 'home');
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
  const child = utilityProcess.fork(join(serverRoot(), 'dist', 'index.mjs'), [], {
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
    show: false,
    title: 'Cairn',
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  window.once('ready-to-show', () => window.show());
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
  window.focus();
}

async function boot(): Promise<void> {
  try {
    server = startServer(await freeLoopbackPort());
    await waitUntilServing(server);
    signOwnPagesIn(server.origin, readOwnerToken());
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
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', (event) => {
    if (quitting || server === null) return;
    quitting = true;
    event.preventDefault();
    void stopServer(server).then(() => app.quit());
  });
  void app.whenReady().then(boot);
}
