import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { _electron as electron } from '@playwright/test';
import { isServerHelper } from '../src/server-process.ts';

const LAUNCH_TIMEOUT_MS = 120_000;
const GATE_SETTLE_MS = 5_000;
const PAIRING_INPUT = '#cairn-pair-input';
const FIRST_RUN_SETUP = '[data-testid="first-run-setup"]';
const RUNNER_ONLINE_TIMEOUT_MS = 90_000;
const RUNNER_ENTRY = 'Resources/runner/dist/cli.mjs';

const SERVER_ENTRY =
  'Contents/Frameworks/Cairn Helper.app/Contents/MacOS/Cairn Helper --type=utility';

function matchingPids(pattern) {
  try {
    return execFileSync('pgrep', ['-f', pattern], { encoding: 'utf8' })
      .trim()
      .split('\n')
      .filter(Boolean);
  } catch {
    return [];
  }
}

function childPids(parentPid) {
  try {
    return execFileSync('pgrep', ['-P', String(parentPid)], { encoding: 'utf8' })
      .trim()
      .split('\n')
      .filter(Boolean);
  } catch {
    return [];
  }
}

function commandOf(pid) {
  try {
    return execFileSync('ps', ['-o', 'command=', '-p', pid], { encoding: 'utf8' });
  } catch {
    return '';
  }
}

function serverPids(parentPid) {
  return childPids(parentPid).filter((pid) => isServerHelper(commandOf(pid)));
}

const [appPath, screenshotPath, trayShotPath] = process.argv.slice(2);
if (appPath === undefined || screenshotPath === undefined) {
  console.error('usage: node scripts/smoke-mac.mjs <Cairn.app> <screenshot.png>');
  process.exit(2);
}

const appRoot = realpathSync(resolve(appPath));
if (appRoot.startsWith('/Applications/')) {
  console.error(`refusing to smoke an installed app: ${appRoot}`);
  process.exit(2);
}

function runnerProcesses() {
  return matchingPids(`${appRoot}/${RUNNER_ENTRY}`).join('\n');
}

const serverProcesses = () =>
  matchingPids(`${appRoot}/${SERVER_ENTRY}`).filter((pid) => isServerHelper(commandOf(pid)));

const app = await electron.launch({
  executablePath: join(resolve(appPath), 'Contents', 'MacOS', 'Cairn'),
  timeout: LAUNCH_TIMEOUT_MS,
});
const child = app.process();
try {
  const window = await app.firstWindow({ timeout: LAUNCH_TIMEOUT_MS });
  await window.waitForLoadState('load');
  const { hostname, protocol } = new URL(window.url());
  assert.equal(`${protocol}//${hostname}`, 'http://127.0.0.1', `window opened ${window.url()}`);

  const teams = await window.evaluate(async () => (await fetch('/api/teams')).status);
  assert.equal(teams, 200, 'the window is not signed in as the owner');

  const overridden = await window.evaluate(async () => {
    const response = await fetch('/api/teams', { headers: { authorization: 'Bearer wrong' } });
    return response.status;
  });
  assert.equal(overridden, 200, 'the owner header did not replace a page-set header');

  await window.waitForTimeout(GATE_SETTLE_MS);
  assert.equal(await window.locator(PAIRING_INPUT).count(), 0, 'the pairing gate is showing');

  await window.locator(FIRST_RUN_SETUP).waitFor({ timeout: GATE_SETTLE_MS });
  const update = await window.evaluate(async () => {
    const bridge = window.cairnDesktop.update;
    await bridge.check();
    return bridge.state();
  });
  assert.ok(
    ['current', 'available'].includes(update?.status),
    `the update check ended in ${JSON.stringify(update)}`,
  );
  console.log(`update check: ${JSON.stringify(update)}`);

  const runner = await window.evaluate(async (timeoutMs) => {
    const teams = await (await fetch('/api/teams')).json();
    const teamId = (teams.teams ?? teams)[0].id;
    const deadline = Date.now() + timeoutMs;
    let machines = [];
    while (Date.now() < deadline) {
      const body = await (await fetch(`/api/teams/${teamId}/machines`)).json();
      machines = (body.machines ?? body).map(({ name, kind, online }) => ({ name, kind, online }));
      if (machines.some((machine) => machine.kind === 'local' && machine.online)) break;
      await new Promise((wake) => setTimeout(wake, 1_000));
    }
    return machines;
  }, RUNNER_ONLINE_TIMEOUT_MS);
  assert.ok(
    runner.some((machine) => machine.kind === 'local' && machine.online),
    `the local Runner did not come online: ${JSON.stringify(runner)}`,
  );
  console.log(`local Runner: ${JSON.stringify(runner)}`);

  await window.screenshot({ path: screenshotPath });

  await app.evaluate(({ app: electronApp }) => electronApp.emit('cairn-tray-toggle'));
  const tray = await app.waitForEvent('window', {
    predicate: (page) => page.url().endsWith('/tray'),
    timeout: GATE_SETTLE_MS * 4,
  });
  await tray.locator('[data-testid="tray-popover"]').waitFor({ timeout: GATE_SETTLE_MS * 4 });
  await tray.waitForTimeout(1_000);
  const opened = await app.evaluate(({ BrowserWindow }) => {
    const popover = BrowserWindow.getAllWindows().find((w) =>
      w.webContents.getURL().endsWith('/tray'),
    );
    return {
      visible: popover?.isVisible() ?? false,
      focused: popover?.isFocused() ?? false,
      bounds: popover?.getBounds() ?? null,
    };
  });
  assert.equal(opened.visible, true, 'the tray popover did not open');
  console.log(`tray popover: ${JSON.stringify(opened)}`);
  if (trayShotPath !== undefined) {
    const { x, y, width, height } = opened.bounds;
    const pad = 40;
    execFileSync('screencapture', [
      '-x',
      `-R${x - pad},${Math.max(0, y - pad)},${width + pad * 2},${height + pad * 2}`,
      trayShotPath,
    ]);
  }
  await tray.locator('[data-testid="tray-quit"]').focus();
  await tray.keyboard.press('Escape');
  await tray.waitForTimeout(500);
  const afterEscape = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((w) => w.webContents.getURL().endsWith('/tray'))
      ?.isVisible(),
  );
  assert.equal(afterEscape, false, 'Escape did not close the tray popover');
  const origin = new URL(window.url()).origin;

  const closed = await app.evaluate(({ BrowserWindow }) => {
    const main = () =>
      BrowserWindow.getAllWindows().filter((w) => !w.webContents.getURL().endsWith('/tray'));
    const [shown] = main();
    shown?.close();
    return { windows: main().length, visible: shown?.isVisible() ?? false };
  });
  assert.deepEqual(closed, { windows: 1, visible: false }, 'closing the window did not hide it');
  assert.equal((await fetch(origin)).status, 200, 'the server stopped when the window closed');

  const pids = serverPids(child.pid);
  assert.equal(pids.length, 1, `expected one server process, found ${pids}`);
  process.kill(Number(pids[0]), 'SIGKILL');
  const recovered = await (async () => {
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      if (
        await fetch(origin).then(
          () => true,
          () => false,
        )
      )
        return true;
      await new Promise((wake) => setTimeout(wake, 500));
    }
    return false;
  })();
  assert.equal(recovered, true, 'the server did not come back after a SIGKILL');
  assert.equal(child.exitCode, null, 'the app quit instead of recovering the server');
  console.log('server SIGKILL: restarted on the same origin');

  const exited = new Promise((done) => child.once('exit', done));
  await app
    .evaluate(({ app: electronApp }) => {
      electronApp.quit();
    })
    .catch(() => {});
  await exited;
  const reachable = await fetch(origin).then(
    () => true,
    () => false,
  );
  assert.equal(reachable, false, 'the server outlived the app');
  assert.equal(runnerProcesses(), '', 'the local Runner outlived the app');

  const abrupt = await electron.launch({
    executablePath: join(resolve(appPath), 'Contents', 'MacOS', 'Cairn'),
    timeout: LAUNCH_TIMEOUT_MS,
  });
  const abruptChild = abrupt.process();
  try {
    await abrupt.firstWindow({ timeout: LAUNCH_TIMEOUT_MS });
    const abruptOrigin = new URL((await abrupt.windows())[0].url()).origin;
    const spawned = await (async () => {
      const deadline = Date.now() + 15_000;
      while (Date.now() < deadline) {
        if (serverPids(abruptChild.pid).length > 0) return true;
        await new Promise((done) => setTimeout(done, 500));
      }
      return false;
    })();
    assert.equal(spawned, true, 'the relaunched app never forked a server');
    abruptChild.kill('SIGKILL');
    await new Promise((done) => abruptChild.once('exit', done));
    const drained = await (async () => {
      const deadline = Date.now() + 30_000;
      while (Date.now() < deadline) {
        const unreachable = await fetch(abruptOrigin).then(
          () => false,
          () => true,
        );
        if (serverProcesses().length === 0 && unreachable) return true;
        await new Promise((wake) => setTimeout(wake, 500));
      }
      return false;
    })();
    assert.equal(drained, true, 'the server outlived a killed app');
    assert.equal(runnerProcesses(), '', 'the local Runner outlived a killed app');
    console.log('abrupt kill: server and Runner died with the app');
  } finally {
    for (const pid of matchingPids(`^${appRoot}/`)) {
      try {
        process.kill(Number(pid), 'SIGKILL');
      } catch {}
    }
  }

  console.log(
    `desktop smoke passed: ${origin} signed in, no pairing gate, Runner online, close hides, quit stops the server and Runner`,
  );
} finally {
  if (child.exitCode === null && child.signalCode === null) await app.close();
}
