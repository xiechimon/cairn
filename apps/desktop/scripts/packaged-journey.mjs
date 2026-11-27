#!/usr/bin/env node

import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { _electron as electron } from '@playwright/test';
import { mainWindow } from './main-window.mjs';

const VALID_MODES = ['local-server', 'remote-server'];

export function parsePackagedJourneyArgs(argv, cwd = process.cwd()) {
  const positionals = [];
  let selectedMode = null;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--mode') {
      const value = argv[i + 1];
      if (!value || !VALID_MODES.includes(value)) {
        throw new Error(`unknown packaged journey mode: ${value ?? 'missing'}`);
      }
      selectedMode = value;
      i += 1;
      continue;
    }
    if (arg.startsWith('--mode=')) {
      const value = arg.slice('--mode='.length);
      if (!VALID_MODES.includes(value)) {
        throw new Error(`unknown packaged journey mode: ${value}`);
      }
      selectedMode = value;
      continue;
    }
    if (arg.startsWith('--')) {
      throw new Error(`unknown option: ${arg}`);
    }
    positionals.push(arg);
  }
  const [appPath, evidenceRoot = join(cwd, 'release', 'packaged-journeys')] = positionals;
  if (appPath === undefined) {
    throw new Error(
      'usage: node scripts/packaged-journey.mjs <Cairn.app> [evidence-dir] [--mode <local-server|remote-server>]',
    );
  }
  return {
    appPath,
    evidenceRoot,
    modes: selectedMode === null ? [...VALID_MODES] : [selectedMode],
  };
}

const PAIRING_SETTLE_TIMEOUT_MS = 10_000;
const REPO_ROOT = resolve(import.meta.dirname, '..', '..', '..');

function freePort() {
  return new Promise((resolvePort, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      probe.close(() => resolvePort(address.port));
    });
  });
}

async function waitForRemote(url, child, logPath) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null)
      throw new Error(`remote server exited ${child.exitCode}; log ${logPath}`);
    try {
      const response = await fetch(`${url}/api/remote/descriptor`, {
        signal: AbortSignal.timeout(1_000),
      });
      if (response.ok) return;
    } catch {}
    await new Promise((done) => setTimeout(done, 250));
  }
  throw new Error(`remote server did not answer ${url}/api/remote/descriptor; log ${logPath}`);
}

async function startRemoteServer(evidenceDir, webDir) {
  const home = mkdtempSync(join(tmpdir(), 'cairn-journey-server-'));
  const token = randomBytes(32).toString('hex');
  const port = await freePort();
  const logPath = join(evidenceDir, 'remote-server.log');
  const out = createWriteStream(logPath);
  const child = spawn('pnpm', ['exec', 'tsx', 'apps/server/src/index.ts'], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      CAIRN_HOME: home,
      CAIRN_TOKEN: token,
      CAIRN_DISABLE_EXTERNAL_CONNECTORS: '1',
      CAIRN_WEB_DIR: webDir,
      HOST: '127.0.0.1',
      PORT: String(port),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.pipe(out);
  child.stderr.pipe(out);
  const url = `http://127.0.0.1:${port}`;
  await waitForRemote(url, child, logPath);
  return { child, token, url };
}

function seedRemoteConnection(userData, url) {
  writeFileSync(
    join(userData, 'connections.json'),
    `${JSON.stringify(
      {
        activeId: 'packaged-remote',
        items: [{ id: 'packaged-remote', name: 'packaged remote', url }],
      },
      null,
      2,
    )}\n`,
  );
}

async function stopServer(child) {
  if (child.exitCode !== null) return;
  child.kill();
  await new Promise((done) => {
    const timer = setTimeout(done, 5_000);
    child.once('exit', () => {
      clearTimeout(timer);
      done();
    });
  });
}

async function withDeadline(promise, ms) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((resolve) => {
        timer = setTimeout(resolve, ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function captureFailure(window, evidenceDir, mode, logs) {
  await window.screenshot({ path: join(evidenceDir, `${mode}-failure.png`) }).catch(() => {});
  const state = await window
    .evaluate(() => ({
      url: location.href,
      title: document.title,
      text: document.body.innerText.slice(0, 4000),
      testIds: [...document.querySelectorAll('[data-testid]')]
        .map((node) => node.getAttribute('data-testid'))
        .slice(0, 120),
    }))
    .catch((error) => ({ error: String(error) }));
  writeFileSync(
    join(evidenceDir, `${mode}-failure.json`),
    `${JSON.stringify({ state, logs }, null, 2)}\n`,
  );
}

async function signInToRemote(window, token) {
  await window.getByTestId('pair-request-code').waitFor({ timeout: 30_000 });
  await window.getByTestId('owner-token-toggle').click();
  await window.getByTestId('owner-token-input').fill(token);
  await window.getByTestId('owner-token-submit').click();
  await window.getByTestId('owner-token-input').waitFor({ state: 'detached', timeout: 30_000 });
  await window
    .locator('[data-testid="home-c"], [data-testid="first-run-setup"]')
    .first()
    .waitFor({ timeout: 30_000 });
  await assertNoPairingRequestLeft(window);
}

async function assertNoPairingRequestLeft(window) {
  const read = () =>
    window.evaluate(async () => {
      const response = await fetch('/api/remote/pairing-requests');
      return { status: response.status, requests: await response.json() };
    });
  const deadline = Date.now() + PAIRING_SETTLE_TIMEOUT_MS;
  let pending = await read();
  while (pending.requests.length > 0 && Date.now() < deadline) {
    await window.waitForTimeout(250);
    pending = await read();
  }
  assert.equal(pending.status, 200, 'the signed-in app cannot read pairing requests');
  assert.deepEqual(pending.requests, [], 'signing in left a pairing request waiting for approval');
  await window
    .getByTestId('pairing-request-banner')
    .waitFor({ state: 'detached', timeout: PAIRING_SETTLE_TIMEOUT_MS });
}

function disposableCopy(appRoot) {
  const copy = join(mkdtempSync(join(tmpdir(), 'cairn-journey-app-')), 'Cairn.app');
  execFileSync('/usr/bin/ditto', [appRoot, copy]);
  return realpathSync(copy);
}

async function launch(userData, appRoot) {
  const home = mkdtempSync(join(tmpdir(), 'cairn-journey-home-'));
  const env = { ...process.env, HOME: home, CAIRN_SMOKE_ISOLATED_SESSION: '1' };
  delete env.CAIRN_HOME;
  const app = await electron.launch({
    executablePath: join(disposableCopy(appRoot), 'Contents', 'MacOS', 'Cairn'),
    args: [`--user-data-dir=${userData}`],
    timeout: 120_000,
    env,
  });
  const window = await mainWindow(app, 120_000);
  const logs = [];
  window.on('console', (message) => logs.push(`[${message.type()}] ${message.text()}`));
  window.on('pageerror', (error) => logs.push(`[pageerror] ${error.message}`));
  await window.waitForLoadState('load');
  return { app, window, logs };
}

async function close(app) {
  const closed = await withDeadline(
    app
      .close()
      .then(() => 'closed')
      .catch(() => 'closed'),
    10_000,
  );
  if (closed !== 'closed') {
    try {
      const child = app.process();
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    } catch {}
  }
}

async function main(argv) {
  let options;
  try {
    options = parsePackagedJourneyArgs(argv);
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }
  const { appPath, evidenceRoot, modes } = options;
  const { journeys } = JSON.parse(
    readFileSync(join(REPO_ROOT, '.claude/skills/verify-cairn/packaged-journeys.json'), 'utf8'),
  );
  const appRoot = existsSync(appPath) ? realpathSync(resolve(appPath)) : resolve(appPath);
  if (appRoot.startsWith('/Applications/')) {
    console.error(`refusing to run packaged journeys against an installed app: ${appRoot}`);
    process.exit(2);
  }
  mkdirSync(evidenceRoot, { recursive: true });

  for (const mode of modes) {
    for (const [id, journey] of Object.entries(journeys)) {
      if (!journey.modes.includes(mode)) continue;
      const { default: walk } = await import(`./journeys/${id}.mjs`);
      const evidenceDir = join(evidenceRoot, mode, id);
      mkdirSync(evidenceDir, { recursive: true });
      const remote =
        mode === 'remote-server'
          ? await startRemoteServer(
              evidenceDir,
              join(appRoot, 'Contents', 'Resources', 'server', 'web'),
            )
          : null;
      const userData = mkdtempSync(join(tmpdir(), `cairn-packaged-${mode}-`));
      if (remote !== null) seedRemoteConnection(userData, remote.url);
      const running = await launch(userData, appRoot);
      try {
        const { origin } = new URL(running.window.url());
        if (remote !== null) {
          assert.equal(origin, remote.url, 'the packaged app did not connect to the remote server');
          await signInToRemote(running.window, remote.token);
        }
        await walk({ window: running.window, mode, evidenceDir });
        console.log(`[packaged-journey] ${id} passed in ${mode} against ${origin}`);
      } catch (error) {
        await captureFailure(running.window, evidenceDir, mode, running.logs);
        throw error;
      } finally {
        await close(running.app);
        if (remote !== null) await stopServer(remote.child);
      }
    }
  }

  process.exit(0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main(process.argv.slice(2));
}
