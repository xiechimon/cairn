import assert from 'node:assert/strict';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, normalize, resolve } from 'node:path';
import { _electron as electron } from '@playwright/test';
import { mainWindow } from './main-window.mjs';

const MIME_BY_EXT = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

const BROWSER_FALLBACK_RE =
  /open this page in the cairn desktop app|在 Cairn 桌面 App 中打开这一页/i;
const LOGIN_STARTED_RE =
  /The Antigravity sign-in page is open in your browser|已在浏览器中打开 Antigravity 登录页/;
const UPDATE_CAIRN_RE = /Update Cairn|更新 Cairn/;
const CANCEL_LABEL_RE = /^(?:Cancel|取消)$/;

function remoteApiPayload(pathname) {
  if (pathname === '/api/auth/clerk/config') return { enabled: false };
  if (pathname === '/api/auth/stream-ticket') return { ticket: 'smoke-ticket' };
  if (pathname === '/api/teams') return [{ id: 't1', name: 'Remote Team' }];
  if (pathname === '/api/user/me') return { id: 'u1', displayName: 'ian', avatarUrl: null };
  if (pathname === '/api/teams/t1/notifications') return { unreadThreadIds: [] };
  if (pathname === '/api/teams/t1/routing-settings') return { rules: [], policies: [] };
  if (pathname === '/api/teams/t1/model-sources') return { sources: [] };
  if (pathname === '/api/teams/t1/model-routing') return { connections: [] };
  if (pathname === '/api/teams/t1/chief/threads') {
    return [
      {
        id: 'chief-home',
        chiefId: 'chief-u1-t1',
        userId: 'u1',
        teamId: 't1',
        title: 'Coordinator',
        createdAt: 2,
        updatedAt: 2,
        lastTurnAt: null,
        session: { runtime: 'pi', id: 's2', openedAt: 2 },
        pendingSessionResumeAt: null,
        toolDefHashes: {},
        toolResultHashes: {},
        activeRun: null,
      },
    ];
  }
  if (pathname === '/api/teams/t1/chief') {
    return {
      chief: {
        id: 'chief-u1-t1',
        userId: 'u1',
        teamId: 't1',
        agent: { agentId: 'agent-1' },
        lastTurnAt: null,
        createdAt: 0,
        tz: null,
      },
      agentActor: {
        id: 'agent-1',
        displayName: 'r5-scribe',
        description: null,
        status: 'active',
        avatarUrl: null,
        provider: 'r3-gw',
        modelId: 'claude-sonnet-5',
        thinkingLevel: null,
        tools: [],
        secrets: [],
        defaultSkill: null,
        skillsAllowlist: null,
        mcpServers: [],
      },
      context: null,
      watches: [],
      wakes: [],
    };
  }
  if (pathname === '/api/conversations/chief-home/messages') return { messages: [] };
  if (pathname === '/api/todos') return [];
  if (pathname === '/api/tasks') return { entries: [] };
  if (pathname === '/api/projects') {
    return [
      {
        id: 'proj-1',
        name: 'cairn',
        teamId: 't1',
        repoKind: 'hosted',
        repoName: 'cairn',
        githubRepo: null,
        localPath: null,
      },
    ];
  }
  if (pathname === '/api/teams/t1/machines') {
    return [{ id: 'm1', name: 'remote-box', online: true, kind: 'remote' }];
  }
  if (pathname === '/api/computers/steps') return { steps: [] };
  if (pathname === '/api/teams/t1/providers') {
    return {
      presets: [],
      providers: [{ id: 'p1', providerId: 'r3-gw', label: 'r3-gw', models: [] }],
    };
  }
  if (pathname === '/api/teams/t1/antigravity-subscriptions') {
    return [
      {
        id: 'ag-expired-1',
        label: 'expired-ag',
        kind: 'oauth-personal',
        expiresAt: Date.now() - 3_600_000,
        createdAt: 1,
      },
    ];
  }
  if (pathname === '/api/teams/t1/claude-subscriptions') return [];
  if (pathname === '/api/teams/t1/devin-subscriptions') return [];
  if (pathname === '/api/server/backup') return { state: 'none' };
  return [];
}

function startRemoteBundleServer(publicDir) {
  const sseSockets = new Set();
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (req.headers.accept?.includes('text/event-stream')) {
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });
      res.write(': ok\n\n');
      sseSockets.add(res);
      req.on('close', () => sseSockets.delete(res));
      return;
    }
    if (url.pathname === '/api/auth/session' || url.pathname === '/api/auth/access') {
      res.writeHead(204);
      res.end();
      return;
    }
    if (url.pathname.startsWith('/api/')) {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(remoteApiPayload(url.pathname)));
      return;
    }
    if (url.pathname === '/') {
      res.writeHead(302, { location: '/app' });
      res.end();
      return;
    }
    const clean = normalize(url.pathname).replace(/^(\.\.(\/|\\|$))+/, '');
    const candidate = join(publicDir, clean);
    const filePath =
      existsSync(candidate) && statSync(candidate).isFile()
        ? candidate
        : join(publicDir, 'index.html');
    const mime = MIME_BY_EXT[extname(filePath)] ?? 'application/octet-stream';
    res.writeHead(200, { 'content-type': mime });
    res.end(readFileSync(filePath));
  });
  return new Promise((resolveStart, rejectStart) => {
    server.once('error', rejectStart);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        rejectStart(new Error('remote smoke server did not bind a port'));
        return;
      }
      resolveStart({
        origin: `http://127.0.0.1:${address.port}`,
        close: () =>
          new Promise((done) => {
            for (const sock of sseSockets) sock.end();
            server.close(() => done());
          }),
      });
    });
  });
}

function createFakeAgyBinary(dir) {
  const scriptPath = join(dir, 'fake-agy.sh');
  writeFileSync(
    scriptPath,
    [
      '#!/bin/sh',
      'while IFS= read -r line; do',
      '  case "$line" in',
      '    *\'"id":1\'*) printf \'{"jsonrpc":"2.0","id":1,"result":{"authMethods":[{"id":"oauth-personal"}]}}\\n\' ;;',
      '  esac',
      'done',
      '',
    ].join('\n'),
    'utf8',
  );
  chmodSync(scriptPath, 0o755);
  return scriptPath;
}

function createSkewPreload(dir) {
  const preloadPath = join(dir, 'skew-preload.cjs');
  writeFileSync(
    preloadPath,
    [
      "const { contextBridge } = require('electron');",
      "contextBridge.exposeInMainWorld('cairnDesktop', {",
      '  update: {',
      "    state: async () => ({ status: 'current', version: '0.1.0' }),",
      '    check: async () => {},',
      '    install: async () => {},',
      '    rollbackNotice: async () => null,',
      '    subscribe: () => () => {},',
      '  },',
      '});',
      '',
    ].join('\n'),
    'utf8',
  );
  return preloadPath;
}

export async function runAntigravityRemoteAndSkewSmoke({
  appPath,
  appRoot,
  screenshotDir,
  launchTimeoutMs,
  quitTimeoutMs,
  withDeadline,
}) {
  const publicDir = join(appRoot, 'Contents', 'Resources', 'server', 'web');
  assert.equal(
    existsSync(join(publicDir, 'index.html')),
    true,
    `missing web bundle at ${publicDir}`,
  );
  mkdirSync(screenshotDir, { recursive: true });
  const tempRoot = mkdtempSync(join(tmpdir(), 'cairn-ag-remote-smoke-'));
  const userDataDir = join(tempRoot, 'user-data');
  mkdirSync(userDataDir, { recursive: true });
  const fakeAgyPath = createFakeAgyBinary(tempRoot);
  const skewPreloadPath = createSkewPreload(tempRoot);
  const remoteServer = await startRemoteBundleServer(publicDir);
  writeFileSync(
    join(userDataDir, 'connections.json'),
    JSON.stringify({
      activeId: 'remote-smoke',
      items: [{ id: 'remote-smoke', name: 'Remote Smoke', url: remoteServer.origin }],
    }),
    'utf8',
  );

  const remoteApp = await electron.launch({
    executablePath: join(resolve(appPath), 'Contents', 'MacOS', 'Cairn'),
    args: [`--user-data-dir=${userDataDir}`],
    env: { ...process.env, CAIRN_AGY_PATH: fakeAgyPath },
    timeout: launchTimeoutMs,
  });
  const remoteChild = remoteApp.process();
  const rendererLogs = [];
  remoteApp.on('window', (page) => {
    page.on('console', (msg) => {
      rendererLogs.push(`[${msg.type()}] ${msg.text()}`);
    });
  });
  try {
    const win = await mainWindow(remoteApp, launchTimeoutMs);
    await win.waitForLoadState('load');
    const shellDiag = await win.evaluate(() => ({
      href: location.href,
      hasBridge: typeof window.cairnDesktop,
      keys: window.cairnDesktop ? Object.keys(window.cairnDesktop) : null,
      shell: window.cairnDesktop?.shell ?? null,
      shellKeys: window.cairnDesktop?.shell ? Object.keys(window.cairnDesktop.shell) : null,
    }));
    const shell = shellDiag.shell;
    assert.ok(
      shell !== null && typeof shell.bridgeVersion === 'number',
      `cairnDesktop.shell descriptor missing in packaged remote mode: ${JSON.stringify({ ...shellDiag, rendererLogs })}`,
    );
    assert.equal(shell.bridgeVersion, 1, `unexpected bridgeVersion: ${JSON.stringify(shell)}`);
    assert.equal(shell.capabilities?.antigravitySignIn, true);
    const banner = win.getByTestId('antigravity-login-banner');
    await banner.waitFor({ state: 'visible', timeout: 20_000 });
    await win.getByTestId('antigravity-login-relogin').click();
    const stateBox = win.getByTestId('antigravity-relogin-state');
    await stateBox.waitFor({ state: 'visible', timeout: 10_000 });
    await win
      .waitForFunction(
        (re) => {
          const el = document.querySelector('[data-testid="antigravity-relogin-state"]');
          return el !== null && new RegExp(re).test(el.textContent ?? '');
        },
        LOGIN_STARTED_RE.source,
        { timeout: 15_000 },
      )
      .catch(() => {});
    await win.screenshot({ path: join(screenshotDir, 'smoke-ag-relogin.png') });
    const reloginText = (await stateBox.textContent()) ?? '';
    assert.match(reloginText, LOGIN_STARTED_RE, `remote sign-in did not start: ${reloginText}`);
    assert.equal(
      BROWSER_FALLBACK_RE.test(reloginText),
      false,
      `unexpected browser fallback copy in remote relogin: ${reloginText}`,
    );
    assert.equal(
      await win.getByTestId('antigravity-relogin-start').count(),
      0,
      'unexpected dead primary sign-in button while sign-in is active',
    );
    await win.getByRole('button', { name: CANCEL_LABEL_RE }).click();

    const openedSkew = remoteApp.waitForEvent('window', { timeout: 15_000 });
    await remoteApp.evaluate(
      ({ BrowserWindow }, { preload, url }) => {
        const skewWindow = new BrowserWindow({
          show: true,
          width: 1280,
          height: 800,
          webPreferences: {
            contextIsolation: true,
            sandbox: true,
            nodeIntegration: false,
            preload,
          },
        });
        void skewWindow.loadURL(url);
      },
      { preload: skewPreloadPath, url: `${remoteServer.origin}/app` },
    );
    const skewWin = await openedSkew;
    await skewWin.waitForLoadState('load');
    await skewWin
      .getByTestId('antigravity-login-banner')
      .waitFor({ state: 'visible', timeout: 20_000 });
    await skewWin.getByTestId('antigravity-login-relogin').click();
    const skewState = skewWin.getByTestId('antigravity-relogin-state');
    await skewState.waitFor({ state: 'visible', timeout: 10_000 });
    await skewWin.waitForTimeout(300);
    await skewWin.screenshot({ path: join(screenshotDir, 'smoke-ag-skew.png') });
    const skewDialogText = (await skewWin.getByRole('dialog').textContent()) ?? '';
    assert.equal(
      BROWSER_FALLBACK_RE.test(skewDialogText),
      false,
      `unexpected browser fallback copy in skew dialog: ${skewDialogText}`,
    );
    assert.match(
      skewDialogText,
      UPDATE_CAIRN_RE,
      `missing Update Cairn CTA when antigravity bridge is absent: ${skewDialogText}`,
    );
    console.log('remote antigravity re-sign-in and version-skew checks passed');
  } finally {
    if (remoteChild.exitCode === null && remoteChild.signalCode === null) {
      await withDeadline(
        remoteApp.close().catch(() => {}),
        quitTimeoutMs,
      );
      if (remoteChild.exitCode === null && remoteChild.signalCode === null) {
        remoteChild.kill('SIGKILL');
      }
    }
    await remoteServer.close();
    rmSync(tempRoot, { recursive: true, force: true });
  }
}
