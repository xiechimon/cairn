import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, resolve } from 'node:path';
import { _electron as electron } from '@playwright/test';
import { isServerHelper } from '../src/server-process.ts';
import { TRAY_POPOVER_WIDTH } from '../src/tray-popover.ts';
import { isTrayPage, mainWindow } from './main-window.mjs';
import { matchingPopover, TrayDriver, TrayDriverStopped } from './tray-click.mjs';

const LAUNCH_TIMEOUT_MS = 120_000;
const GATE_SETTLE_MS = 5_000;
const OPEN_TIMEOUT_MS = 5_000;
const GAP_TIMEOUT_MS = 10_000;
const FULL_SCREEN_TIMEOUT_MS = 15_000;
const QUIT_TIMEOUT_MS = 60_000;
const DISMISS_GAP_MS = 400;
const QUEUED_OPEN_MS = 2_000;
const QUEUED_OPEN_EXPIRY_WAIT_MS = 2_250;
const EVALUATE_TIMEOUT_MS = 15_000;
const NATIVE_TRAY_HELPER = 'Contents/Resources/tray/CairnTray';
const NATIVE_RESTARTS = 3;
const NATIVE_READY_TIMEOUT_MS = 20_000;
const NATIVE_CONTENT_TIMEOUT_MS = 30_000;
const PAIRING_INPUT = '#cairn-pair-input';
const FIRST_RUN_SETUP = '[data-testid="first-run-setup"]';
const RUNNER_ONLINE_TIMEOUT_MS = 90_000;
const RUNNER_ENTRY = 'Resources/runner/dist/cli.mjs';

class NotCovered extends Error {}

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

function withDeadline(promise, ms) {
  let timer;
  const deadline = new Promise((done) => {
    timer = setTimeout(() => done('timeout'), ms);
  });
  const settled = promise.then(
    () => 'done',
    () => 'done',
  );
  return Promise.race([settled, deadline]).finally(() => clearTimeout(timer));
}

const [appPath, screenshotPath, trayShotPath] = process.argv.slice(2);
if (appPath === undefined || screenshotPath === undefined) {
  console.error('usage: node scripts/smoke-mac.mjs <Cairn.app> <screenshot.png>');
  process.exit(2);
}

const appRoot = existsSync(appPath) ? realpathSync(resolve(appPath)) : resolve(appPath);
if (appRoot.startsWith('/Applications/')) {
  console.error(`refusing to smoke an installed app: ${appRoot}`);
  process.exit(2);
}
if (process.env.CAIRN_SMOKE_ISOLATED_SESSION !== '1') {
  console.error(
    'the real-click smoke needs an isolated GUI session (CAIRN_SMOKE_ISOLATED_SESSION=1)',
  );
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
let driver = null;
try {
  const step = (name) => console.log(`smoke step: ${name}`);
  const bounded = (promise, label) =>
    Promise.race([
      promise,
      new Promise((_done, fail) =>
        setTimeout(
          () => fail(new Error(`${label} did not answer in ${EVALUATE_TIMEOUT_MS} ms`)),
          EVALUATE_TIMEOUT_MS,
        ),
      ),
    ]);
  const coldArmed = await bounded(
    app.evaluate(async ({ app: electronApp, BrowserWindow, session, Tray }, width) => {
      await electronApp.whenReady();
      const isPopover = (candidate) => candidate.getBounds().width === width;
      if (BrowserWindow.getAllWindows().some(isPopover)) return false;
      const cold = {
        contentsId: null,
        painted: false,
        finished: false,
        release: null,
        clickTimes: [],
        shows: 0,
        beforeClick: null,
      };
      globalThis.__cairnColdTray = cold;
      const on = Tray.prototype.on;
      Tray.prototype.on = function (name, listener) {
        if (name === 'click') {
          this.prependListener('click', () => {
            cold.clickTimes.push(performance.now());
            cold.beforeClick?.();
          });
        }
        return on.call(this, name, listener);
      };
      const watchFirstPaint = (_event, candidate) => {
        if (!isPopover(candidate)) return;
        electronApp.off('browser-window-created', watchFirstPaint);
        cold.contentsId = candidate.webContents.id;
        candidate.on('show', () => {
          cold.shows++;
        });
        candidate.once('ready-to-show', () => {
          cold.painted = true;
        });
        candidate.webContents.once('did-finish-load', () => {
          cold.finished = true;
        });
      };
      electronApp.on('browser-window-created', watchFirstPaint);
      session.defaultSession.webRequest.onBeforeRequest(
        { urls: ['http://127.0.0.1/*'] },
        ({ webContentsId, resourceType, url }, callback) => {
          if (
            webContentsId === cold.contentsId &&
            resourceType === 'mainFrame' &&
            new URL(url).pathname === '/tray' &&
            cold.release === null
          ) {
            cold.release = callback;
          } else {
            callback({});
          }
        },
      );
      return true;
    }, TRAY_POPOVER_WIDTH),
    'arming the first tray document hold',
  );
  assert.equal(coldArmed, true, 'the tray window was created before the document hold was armed');

  const window = await mainWindow(app, LAUNCH_TIMEOUT_MS);
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
    ['current', 'available', 'ready'].includes(update?.status),
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

  const origin = new URL(window.url()).origin;
  step('starting the tray driver');
  driver = TrayDriver.start((line) => console.log(line));
  const appPid = child.pid;
  const driverInfo = await driver.send({ cmd: 'ping' });
  assert.equal(
    driverInfo.ok,
    true,
    `the tray driver needs Accessibility and event posting access: ${JSON.stringify(driverInfo)}`,
  );
  step(`tray driver answered ${JSON.stringify(driverInfo)}`);
  console.log(
    `smoke step: status item ${JSON.stringify(await driver.send({ cmd: 'statusItem', pid: appPid }))}`,
  );

  const popoverWindow = (fn, arg) =>
    bounded(app.evaluate(fn, arg ?? TRAY_POPOVER_WIDTH), 'the app');
  const popoverState = () =>
    popoverWindow(({ BrowserWindow }, width) => {
      const popover = BrowserWindow.getAllWindows().find(
        (candidate) => candidate.getBounds().width === width,
      );
      const ask = (read) => {
        try {
          return read() ?? null;
        } catch {
          return null;
        }
      };
      return {
        bounds: popover?.getBounds() ?? null,
        visible: popover?.isVisible() ?? false,
        focused: popover?.isFocused() ?? false,
        loading: ask(() => popover.webContents.isLoading()),
        crashed: ask(() => popover.webContents.isCrashed()),
        url: ask(() => popover.webContents.getURL()),
        reload: globalThis.__cairnSmokeReload ?? null,
        clicks: globalThis.__cairnColdTray.clickTimes.length,
        clickTimes: globalThis.__cairnColdTray.clickTimes,
        shows: globalThis.__cairnColdTray.shows,
        recoveryHeld: globalThis.__cairnSmokeRecovery?.release != null,
        watch: globalThis.__cairnSmokeWatch ?? null,
      };
    });
  const trayWindows = () =>
    popoverWindow(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .filter((candidate) => candidate.webContents.getURL().endsWith('/tray'))
        .map((candidate) => candidate.isVisible()),
    );

  async function popoverOnScreen() {
    const { bounds } = await popoverState();
    if (bounds === null) return { onScreen: false, reason: 'the app has no popover window' };
    const { windows } = await driver.send({ cmd: 'windows', pid: appPid });
    const entry = matchingPopover(windows, bounds);
    if (entry === null)
      return {
        onScreen: false,
        reason: `the window server lists no window at ${JSON.stringify(bounds)}: ${JSON.stringify(windows)}`,
      };
    return {
      onScreen: entry.onscreen === 1,
      entry,
      bounds,
      reason: `the window server reports the popover off screen: ${JSON.stringify(entry)}`,
    };
  }

  async function waitForScreen(onScreen, timeout = OPEN_TIMEOUT_MS) {
    const deadline = Date.now() + timeout;
    for (;;) {
      const seen = await popoverOnScreen();
      if (seen.onScreen === onScreen || Date.now() > deadline) return seen;
      await new Promise((wake) => setTimeout(wake, 100));
    }
  }

  async function clickStatusItem(button = 'left', doubleClick = false) {
    const clicked = await driver.send({ cmd: 'clickStatus', pid: appPid, button, doubleClick });
    if (clicked.ok !== true)
      throw new NotCovered(`the status item received no click: ${JSON.stringify(clicked)}`);
    if (clicked.statusPid !== appPid)
      throw new NotCovered(
        `the status item for pid ${appPid} never owned the top hit at its accessibility position: ${JSON.stringify(clicked.top)}`,
      );
    return clicked;
  }

  async function waitForFixtureMode(isReady) {
    const deadline = Date.now() + FULL_SCREEN_TIMEOUT_MS;
    for (;;) {
      const state = await driver.send({ cmd: 'fixtureMode' });
      if (isReady(state) || Date.now() >= deadline) return state;
      await new Promise((wake) => setTimeout(wake, 100));
    }
  }

  async function dismiss() {
    if ((await waitForScreen(false)).onScreen) await clickStatusItem();
    const closed = await waitForScreen(false);
    assert.equal(
      closed.onScreen,
      false,
      `the popover did not close on a second click: ${closed.reason}`,
    );
    await driver.send({ cmd: 'sleep', ms: DISMISS_GAP_MS });
  }

  const mandatory = async (outcome, body) => {
    try {
      outcome.detail = await body();
      outcome.result = 'green';
    } catch (error) {
      if (error instanceof TrayDriverStopped) throw error;
      outcome.detail =
        error instanceof NotCovered
          ? `this case cannot be skipped: ${error.message}`
          : error.message;
    }
  };
  const helperPids = () =>
    childPids(appPid).filter((pid) => commandOf(pid).includes(`${appRoot}/${NATIVE_TRAY_HELPER}`));
  async function waitForHelper(previous) {
    const deadline = Date.now() + NATIVE_READY_TIMEOUT_MS;
    for (;;) {
      const pid = helperPids().find((candidate) => candidate !== previous);
      if (
        pid !== undefined &&
        (await driver.send({ cmd: 'statusItem', pid: Number(pid) })).ok === true
      )
        return Number(pid);
      if (Date.now() > deadline)
        throw new Error(
          `no native tray helper with a status item after ${NATIVE_READY_TIMEOUT_MS} ms`,
        );
      await new Promise((wake) => setTimeout(wake, 200));
    }
  }
  const nativeMenuOpen = async (pid) =>
    (await driver.send({ cmd: 'windows', pid })).windows.some(
      (entry) => entry.onscreen === 1 && entry.layer >= 100,
    );
  async function waitForNativeMenu(pid, open) {
    const deadline = Date.now() + OPEN_TIMEOUT_MS;
    for (;;) {
      if ((await nativeMenuOpen(pid)) === open) return true;
      if (Date.now() > deadline) return false;
      await new Promise((wake) => setTimeout(wake, 100));
    }
  }
  async function openNativeMenu(pid) {
    const clicked = await driver.send({ cmd: 'clickStatus', pid, button: 'left' });
    assert.equal(
      clicked.statusPid,
      pid,
      `the native status item got no click: ${JSON.stringify(clicked)}`,
    );
    assert.equal(
      await waitForNativeMenu(pid, true),
      true,
      'the native menu did not open on a click',
    );
    await driver.send({ cmd: 'sleep', ms: 600 });
    assert.equal(await nativeMenuOpen(pid), true, 'the native menu closed after mouse-up');
  }
  async function closeNativeMenu(pid) {
    await driver.send({ cmd: 'escape', pid });
    assert.equal(await waitForNativeMenu(pid, false), true, 'Escape did not close the native menu');
    await driver.send({ cmd: 'sleep', ms: DISMISS_GAP_MS });
  }
  const nativeTitles = async (pid) =>
    (await driver.send({ cmd: 'menuItems', pid })).items.map((item) => item.title);

  const nativeMenu = {
    name: 'native menu: skeleton while the page loads, content, keyboard, the keep-awake button, Esc and Settings',
    result: 'red',
    detail: '',
  };
  const nativeFallback = {
    name: 'native menu falls back to the web popover after repeated helper crashes',
    result: 'red',
    detail: '',
  };
  const outcomes = [nativeMenu, nativeFallback];
  const coldTrayState = () =>
    popoverWindow(({ BrowserWindow, webContents }) => {
      const { contentsId, painted, finished, release } = globalThis.__cairnColdTray;
      const contents = contentsId === null ? null : webContents.fromId(contentsId);
      return {
        painted,
        finished,
        held: release !== null,
        loading: contents?.isLoading() ?? false,
        visible: contents != null && BrowserWindow.fromWebContents(contents)?.isVisible() === true,
      };
    });
  let helper = null;
  await mandatory(nativeMenu, async () => {
    const unpainted = {
      painted: false,
      finished: false,
      held: true,
      loading: true,
      visible: false,
    };
    helper = await waitForHelper(null);
    try {
      assert.deepEqual(await coldTrayState(), unpainted, 'the first tray document was not held');
      await openNativeMenu(helper);
      const skeleton = await nativeTitles(helper);
      assert.ok(
        skeleton.includes('Open Cairn') || skeleton.includes('打开 Cairn'),
        `the native menu did not show the skeleton while the page was held: ${JSON.stringify(skeleton)}`,
      );
      await closeNativeMenu(helper);
    } finally {
      await popoverWindow(({ session }) => {
        const cold = globalThis.__cairnColdTray;
        cold.release?.({});
        cold.release = null;
        session.defaultSession.webRequest.onBeforeRequest(null);
      });
    }
    const deadline = Date.now() + NATIVE_CONTENT_TIMEOUT_MS;
    let content = [];
    for (;;) {
      await openNativeMenu(helper);
      content = await nativeTitles(helper);
      if (content.some((title) => title.startsWith('Coordinator'))) break;
      await closeNativeMenu(helper);
      assert.ok(
        Date.now() < deadline,
        `the page never filled the native menu: ${JSON.stringify(content)}`,
      );
      await driver.send({ cmd: 'sleep', ms: 1_000 });
    }
    const settings = content.includes('Settings') ? 'Settings' : '设置';
    for (const title of [settings, content.includes('Quit Cairn') ? 'Quit Cairn' : '退出 Cairn']) {
      assert.ok(
        content.includes(title),
        `the native menu lacks ${title}: ${JSON.stringify(content)}`,
      );
    }
    if (trayShotPath !== undefined) {
      execFileSync('screencapture', ['-x', trayShotPath.replace(/\.png$/, '-native.png')]);
    }
    await driver.send({ cmd: 'key', pid: helper, code: 125 });
    await driver.send({ cmd: 'sleep', ms: 300 });
    const selected = (await driver.send({ cmd: 'menuItems', pid: helper })).items.filter(
      (item) => item.selected,
    );
    assert.equal(
      selected.length,
      1,
      `the Down arrow did not highlight one item: ${JSON.stringify(selected)}`,
    );
    await closeNativeMenu(helper);

    const keepAwakeChoice = join(
      await app.evaluate(({ app: electronApp }) => electronApp.getPath('userData')),
      'keep-awake',
    );
    const keepAwakeTitle = content.includes('Keep the screen on')
      ? 'Keep the screen on'
      : '保持屏幕常亮';
    for (const expected of ['on', 'off']) {
      await openNativeMenu(helper);
      const switched = await driver.send({
        cmd: 'clickMenuItem',
        pid: helper,
        title: keepAwakeTitle,
        hoverMs: 300,
      });
      assert.equal(
        switched.ok,
        true,
        `the keep-awake button got no click: ${JSON.stringify(switched)}`,
      );
      assert.equal(
        await waitForNativeMenu(helper, false),
        true,
        'clicking the keep-awake button left the menu open',
      );
      const saved = () =>
        existsSync(keepAwakeChoice) ? readFileSync(keepAwakeChoice, 'utf8').trim() : 'off';
      const switchDeadline = Date.now() + OPEN_TIMEOUT_MS;
      while (saved() !== expected && Date.now() < switchDeadline) {
        await driver.send({ cmd: 'sleep', ms: 100 });
      }
      assert.equal(saved(), expected, `clicking the keep-awake button did not turn it ${expected}`);
      await driver.send({ cmd: 'sleep', ms: DISMISS_GAP_MS });
    }

    await popoverWindow(({ BrowserWindow }, width) => {
      for (const candidate of BrowserWindow.getAllWindows())
        if (candidate.getBounds().width !== width) candidate.hide();
    });
    await openNativeMenu(helper);
    const picked = await driver.send({ cmd: 'clickMenuItem', pid: helper, title: settings });
    assert.equal(picked.ok, true, `the Settings item got no click: ${JSON.stringify(picked)}`);
    assert.equal(
      await waitForNativeMenu(helper, false),
      true,
      'picking Settings left the menu open',
    );
    const settingsDeadline = Date.now() + OPEN_TIMEOUT_MS * 2;
    for (;;) {
      const shown = await popoverWindow(({ BrowserWindow }, width) => {
        const main = BrowserWindow.getAllWindows().find(
          (candidate) => candidate.getBounds().width !== width,
        );
        return { visible: main?.isVisible() ?? false, url: main?.webContents.getURL() ?? '' };
      });
      if (shown.visible && new URL(shown.url).pathname.startsWith('/app/settings')) break;
      assert.ok(
        Date.now() < settingsDeadline,
        `Settings from the native menu did not show the main window on Settings: ${JSON.stringify(shown)}`,
      );
      await driver.send({ cmd: 'sleep', ms: 200 });
    }
    return `helper ${helper}: ${content.length} items`;
  });
  console.log(`tray ${nativeMenu.result}: ${nativeMenu.name}: ${nativeMenu.detail}`);

  async function recordNativeWalkthrough(pid, base) {
    const seconds = 70;
    const recorder = spawn('screencapture', ['-v', `-V${seconds}`, '-x', '-C', `${base}.mov`], {
      stdio: 'ignore',
    });
    const finished = new Promise((done) => recorder.once('exit', done));
    const pause = (ms) => driver.send({ cmd: 'sleep', ms });
    const shot = (name) => execFileSync('screencapture', ['-x', `${base}-${name}.png`]);
    const appearance = (dark) =>
      execFileSync('osascript', [
        '-e',
        `tell application "System Events" to tell appearance preferences to set dark mode to ${dark}`,
      ]);
    const reopen = async (step) => {
      for (let attempt = 1; ; attempt += 1) {
        try {
          await openNativeMenu(pid);
          return;
        } catch (error) {
          console.log(`tray recording: ${step} open attempt ${attempt} failed: ${error.message}`);
          if (attempt === 3) throw error;
          await driver.send({ cmd: 'escape', pid });
          await pause(1_500);
        }
      }
    };
    const walk = async (label) => {
      await reopen(`${label} first`);
      await pause(800);
      const titles = await nativeTitles(pid);
      const awake = titles.find(
        (title) => title === 'Keep the screen on' || title === '保持屏幕常亮',
      );
      for (const title of titles.filter(Boolean).slice(0, 6)) {
        await driver.send({ cmd: 'clickMenuItem', pid, title, hoverOnly: true, hoverMs: 450 });
      }
      shot(`${label}-open`);
      if (awake !== undefined) {
        await driver.send({ cmd: 'clickMenuItem', pid, title: awake, hoverMs: 400 });
        await pause(1_000);
        await reopen(`${label} after the switch`);
        await pause(600);
        shot(`${label}-keep-awake-on`);
        for (let press = 0; press < 3; press += 1) {
          await driver.send({ cmd: 'key', pid, code: 126 });
          await pause(400);
        }
        shot(`${label}-keyboard`);
        await closeNativeMenu(pid);
        await reopen(`${label} after the keyboard`);
        await pause(500);
        await driver.send({ cmd: 'clickMenuItem', pid, title: awake, hoverMs: 400 });
        await pause(800);
      } else {
        await closeNativeMenu(pid);
      }
      return titles;
    };
    try {
      await pause(1_000);
      const light = await walk('light');
      appearance(true);
      await pause(4_000);
      await walk('dark');
      return `recorded ${base}.mov: ${JSON.stringify(light)}`;
    } finally {
      try {
        appearance(false);
      } catch {}
      await finished;
    }
  }
  if (nativeMenu.result === 'green' && trayShotPath !== undefined && helper !== null) {
    await popoverWindow(({ BrowserWindow }, width) => {
      for (const candidate of BrowserWindow.getAllWindows())
        if (candidate.getBounds().width !== width) candidate.hide();
    });
    try {
      console.log(
        `tray recording: ${await recordNativeWalkthrough(helper, trayShotPath.replace(/\.png$/, '-native-walk'))}`,
      );
    } catch (error) {
      if (error instanceof TrayDriverStopped) throw error;
      console.log(`tray recording not made: ${error.message}`);
    }
  }

  await mandatory(nativeFallback, async () => {
    let current = helper ?? (await waitForHelper(null));
    for (let crash = 0; crash <= NATIVE_RESTARTS; crash += 1) {
      process.kill(current, 'SIGKILL');
      if (crash < NATIVE_RESTARTS) current = await waitForHelper(String(current));
    }
    await driver.send({ cmd: 'sleep', ms: 6_000 });
    assert.deepEqual(helperPids(), [], 'the helper restarted after the restart budget ran out');
    const item = await driver.send({ cmd: 'statusItem', pid: appPid });
    assert.equal(
      item.ok,
      true,
      `the web popover status item did not appear: ${JSON.stringify(item)}`,
    );
    return JSON.stringify(item.items);
  });
  console.log(`tray ${nativeFallback.result}: ${nativeFallback.name}: ${nativeFallback.detail}`);
  assert.equal(nativeFallback.result, 'green', 'the popover checks need the fallback status item');
  await waitForScreen(false);

  const tray =
    app.windows().find(isTrayPage) ??
    (await app.waitForEvent('window', {
      predicate: isTrayPage,
      timeout: GATE_SETTLE_MS * 4,
    }));
  const trayUrl = tray.url();
  assert.equal(
    (await trayWindows()).includes(true),
    false,
    'the tray popover showed before the icon was clicked',
  );
  assert.equal(
    (await waitForScreen(false)).onScreen,
    false,
    'the window server listed the tray popover before the icon was clicked',
  );
  step(`clicking the status item ${JSON.stringify(await clickStatusItem())}`);
  const opened = await waitForScreen(true);
  assert.equal(opened.onScreen, true, `the tray popover did not open on a click: ${opened.reason}`);
  await tray.locator('[data-testid="tray-popover"]').waitFor({ timeout: GATE_SETTLE_MS * 4 });
  await tray.waitForTimeout(1_000);
  assert.equal(
    (await trayWindows()).includes(true),
    true,
    'the tray popover was not visible after its page settled',
  );
  const settled = await waitForScreen(true);
  assert.equal(
    settled.onScreen,
    true,
    `the tray popover was not on screen after its page settled: ${settled.reason}`,
  );
  console.log(
    `tray popover: ${JSON.stringify({ ...settled.entry, focused: (await popoverState()).focused })}`,
  );
  if (trayShotPath !== undefined) {
    const { x, y, width, height } = settled.bounds;
    const pad = 40;
    execFileSync('screencapture', [
      '-x',
      `-R${x - pad},${Math.max(0, y - pad)},${width + pad * 2},${height + pad * 2}`,
      trayShotPath,
    ]);
  }
  await tray.locator('[data-testid="tray-quit"]').focus();
  assert.deepEqual(await trayWindows(), [true], 'the tray popover was not visible before Escape');
  await tray.keyboard.press('Escape');
  await tray.waitForTimeout(500);
  assert.deepEqual(
    await trayWindows(),
    [false],
    'Escape did not leave the tray window present and hidden',
  );
  assert.equal(
    (await waitForScreen(false)).onScreen,
    false,
    'Escape did not close the tray popover',
  );

  const loadingGap = { name: 'click while the popover page is loading', result: 'red', detail: '' };
  const heldDocument = {
    name: 'second click closes the panel while its next page document is still held',
    result: 'red',
    detail: '',
  };
  const heldEscape = {
    name: 'Escape closes the panel while its next page document is still held',
    result: 'red',
    detail: '',
  };
  const warmReload = {
    name: 'click waits for a committed reload to finish',
    result: 'red',
    detail: '',
  };
  outcomes.push(loadingGap, heldDocument, heldEscape, warmReload);

  const waitForPopover = async (ready) => {
    const deadline = Date.now() + GAP_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const state = await popoverState();
      if (ready(state)) return state;
      await new Promise((wake) => setTimeout(wake, 50));
    }
    return null;
  };
  const loadPopover = (url) =>
    popoverWindow(
      ({ BrowserWindow }, args) => {
        const popover = BrowserWindow.getAllWindows().find(
          (candidate) => candidate.getBounds().width === args.width,
        );
        return popover.loadURL(args.url);
      },
      { width: TRAY_POPOVER_WIDTH, url },
    );
  const uncommitted = [];
  const gapServer = createServer((_request, response) => uncommitted.push(response));
  await new Promise((done) => gapServer.listen(0, '127.0.0.1', done));
  const heldUrl = `http://127.0.0.1:${gapServer.address().port}/unpainted`;
  const documentIsHeld = (state) =>
    state.url === trayUrl &&
    state.loading === true &&
    uncommitted.some((response) => !response.writableEnded && !response.destroyed);
  const assertHeldDocument = async () => {
    const state = await popoverState();
    assert.ok(documentIsHeld(state), `the next document is not held: ${JSON.stringify(state)}`);
    return state;
  };
  try {
    await mandatory(loadingGap, async () => {
      await tray.waitForLoadState('load', { timeout: GAP_TIMEOUT_MS });
      assert.equal((await popoverState()).url, trayUrl, 'the previous tray page did not load');
      await popoverWindow(
        ({ BrowserWindow }, args) => {
          const popover = BrowserWindow.getAllWindows().find(
            (candidate) => candidate.getBounds().width === args.width,
          );
          void popover.loadURL(args.url).catch(() => {});
        },
        { width: TRAY_POPOVER_WIDTH, url: heldUrl },
      );
      const held = await waitForPopover(documentIsHeld);
      assert.ok(held !== null, 'the next tray document was not held before commit');
      step(`held document: old tray page still loaded ${JSON.stringify(held)}`);
      await clickStatusItem();
      const shown = await waitForScreen(true);
      assert.equal(
        shown.onScreen,
        true,
        `the popover did not open on a click while its page was loading: ${shown.reason}`,
      );
      await assertHeldDocument();
      return JSON.stringify(shown.entry);
    });
    await mandatory(heldDocument, async () => {
      await dismiss();
      await assertHeldDocument();
      await clickStatusItem();
      const shown = await waitForScreen(true);
      assert.equal(
        shown.onScreen,
        true,
        `the panel left the screen on the first click with its document still held: ${shown.reason}`,
      );
      await assertHeldDocument();
      await clickStatusItem();
      const hidden = await waitForScreen(false);
      assert.equal(
        hidden.onScreen,
        false,
        `the panel did not close on a second click with its document still held: ${hidden.reason}`,
      );
      await assertHeldDocument();
      return JSON.stringify(shown.entry);
    });
    await mandatory(heldEscape, async () => {
      await dismiss();
      await assertHeldDocument();
      await clickStatusItem();
      const shown = await waitForScreen(true);
      assert.equal(
        shown.onScreen,
        true,
        `the panel was not on screen before Escape: ${shown.reason}`,
      );
      const beforeEscape = await assertHeldDocument();
      assert.equal(beforeEscape.focused, true, 'the panel did not have focus before Escape');
      const escaped = await driver.send({ cmd: 'escape', pid: appPid });
      assert.equal(escaped.ok, true, `the driver did not send Escape: ${JSON.stringify(escaped)}`);
      const hidden = await waitForScreen(false);
      assert.equal(
        hidden.onScreen,
        false,
        `Escape did not hide the panel with its document still held: ${hidden.reason}`,
      );
      await assertHeldDocument();
      return JSON.stringify(shown.entry);
    });
  } finally {
    for (const response of uncommitted) {
      if (!response.writableEnded && !response.destroyed)
        response.writeHead(302, { location: trayUrl }).end();
    }
    gapServer.close();
  }
  assert.ok(
    (await waitForPopover(({ url, loading }) => url === trayUrl && loading === false)) !== null,
    'the held navigation did not settle after release',
  );
  await dismiss();

  async function withHeldReload(verify) {
    let hold = false;
    let pending = null;
    const script = 'document.body.textContent = "Cairn tray loading gap";';
    const server = createServer((request, response) => {
      response.setHeader('cache-control', 'no-store');
      if (request.url === '/held.js') {
        response.setHeader('content-type', 'text/javascript');
        if (hold) pending = response;
        else response.end(script);
        return;
      }
      response.setHeader('content-type', 'text/html; charset=utf-8');
      response.end('<!doctype html><body><script src="/held.js"></script>');
    });
    await new Promise((done) => server.listen(0, '127.0.0.1', done));
    const url = `http://127.0.0.1:${server.address().port}/reload`;
    const isHeld = (state) =>
      state.url === url &&
      state.loading === true &&
      state.reload?.committed === url &&
      state.reload.finished === false &&
      pending !== null &&
      !pending.writableEnded &&
      !pending.destroyed;
    const release = () => {
      hold = false;
      if (pending !== null && !pending.writableEnded && !pending.destroyed) pending.end(script);
    };
    try {
      await loadPopover(url);
      hold = true;
      await popoverWindow(({ BrowserWindow }, width) => {
        const contents = BrowserWindow.getAllWindows().find(
          (candidate) => candidate.getBounds().width === width,
        ).webContents;
        const reload = { committed: null, finished: false, finishedAt: null };
        globalThis.__cairnSmokeReload = reload;
        contents.once('did-navigate', (_event, target) => {
          reload.committed = target;
        });
        contents.once('did-finish-load', () => {
          reload.finished = true;
          reload.finishedAt = performance.now();
        });
        contents.reload();
      });
      const held = await waitForPopover(isHeld);
      assert.ok(held !== null, 'the reloaded document did not commit with its script held');
      const assertHeld = async () => {
        const state = await popoverState();
        assert.ok(isHeld(state), `the committed reload is not held: ${JSON.stringify(state)}`);
        return state;
      };
      return await verify({ assertHeld, release });
    } finally {
      release();
      server.close();
    }
  }

  await mandatory(warmReload, () =>
    withHeldReload(async ({ assertHeld, release }) => {
      assert.equal((await popoverOnScreen()).onScreen, false, 'the panel opened before the click');
      await clickStatusItem();
      assert.equal(
        (await popoverOnScreen()).onScreen,
        false,
        'the panel opened with the committed reload still held',
      );
      await assertHeld();
      release();
      const shown = await waitForScreen(true);
      assert.equal(
        shown.onScreen,
        true,
        `the queued click did not show the panel after the reload: ${shown.reason}`,
      );
      assert.equal(
        (await popoverState()).reload.finished,
        true,
        'the panel opened before load finished',
      );
      return JSON.stringify(shown.entry);
    }),
  );
  for (const outcome of [loadingGap, heldDocument, heldEscape, warmReload])
    console.log(`tray ${outcome.result}: ${outcome.name}: ${outcome.detail}`);
  await dismiss();
  await loadPopover(trayUrl);
  await tray.locator('[data-testid="tray-popover"]').waitFor({ timeout: GATE_SETTLE_MS * 4 });
  await driver.send({ cmd: 'sleep', ms: DISMISS_GAP_MS });

  async function crashPopover() {
    const gone = await popoverWindow(async ({ BrowserWindow }, width) => {
      const popover = BrowserWindow.getAllWindows().find(
        (candidate) => candidate.getBounds().width === width,
      );
      const crashed = new Promise((done) => {
        popover.webContents.once('render-process-gone', (_event, details) => done(details.reason));
      });
      popover.webContents.forcefullyCrashRenderer();
      return Promise.race([crashed, new Promise((done) => setTimeout(() => done(null), 10_000))]);
    });
    assert.ok(gone !== null, 'the popover renderer did not report a crash');
    console.log(`popover renderer gone: ${gone}`);
  }

  async function assertTrayRecovered() {
    const deadline = Date.now() + OPEN_TIMEOUT_MS;
    for (;;) {
      const controls = await popoverWindow(
        ({ BrowserWindow }, args) => {
          const contents = BrowserWindow.getAllWindows().find(
            (candidate) => candidate.getBounds().width === args.width,
          ).webContents;
          if (contents.isCrashed() || contents.getURL() !== args.url || contents.isLoading())
            return false;
          return contents.executeJavaScript(
            `document.querySelector('[data-testid="tray-popover"]') !== null`,
          );
        },
        { width: TRAY_POPOVER_WIDTH, url: trayUrl },
      );
      if (controls) return;
      assert.ok(Date.now() < deadline, 'the popover did not reload its tray controls');
      await new Promise((wake) => setTimeout(wake, 100));
    }
  }

  async function restoreTray() {
    await loadPopover(trayUrl);
    await assertTrayRecovered();
    await dismiss();
  }

  async function clickWhileHidden(doubleClick = false) {
    const before = await popoverState();
    assert.equal(before.visible, false, 'the popover was visible before the click');
    await clickStatusItem('left', doubleClick);
    const after = await waitForPopover(({ clicks }) => clicks > before.clicks);
    assert.ok(after !== null, 'Electron did not deliver the status item click');
    assert.equal(after.shows, before.shows, 'the click showed the popover while its load was held');
    return after.clickTimes[before.clicks];
  }

  async function dismissFromMainWindow(main, mode) {
    const withEscape = mode === 'escape';
    const { bounds, windowNumber } = await main.evaluate((candidate, withEscape) => {
      candidate.show();
      candidate.focus();
      return {
        bounds: candidate.getContentBounds(),
        windowNumber: withEscape ? null : Number(candidate.getMediaSourceId().split(':')[1]),
      };
    }, withEscape);
    await window.waitForFunction(() => document.hasFocus(), undefined, {
      timeout: OPEN_TIMEOUT_MS,
    });
    const types = withEscape ? ['keydown'] : ['mousedown', 'click'];
    await window.evaluate((events) => {
      globalThis.__cairnSmokeMainInputs = [];
      for (const type of events) {
        document.addEventListener(
          type,
          (event) => {
            if (
              event.isTrusted &&
              (type === 'keydown' ? event.key === 'Escape' : event.button === 0)
            )
              globalThis.__cairnSmokeMainInputs.push(type);
          },
          { capture: true, once: true },
        );
      }
    }, types);
    const queuedAt = await clickWhileHidden();
    assert.equal(
      await window.evaluate(() => document.hasFocus()),
      true,
      'the main window lost focus after the status item click',
    );
    const input = await driver.send(
      withEscape
        ? { cmd: 'escape', pid: appPid }
        : mode === 'close'
          ? { cmd: 'clickCloseButton', pid: appPid, windowNumber }
          : {
              cmd: 'clickPoint',
              pid: appPid,
              windowNumber,
              x: bounds.x + bounds.width / 4,
              y: bounds.y + bounds.height * 0.75,
            },
    );
    assert.equal(
      input.ok,
      true,
      `the driver did not send main window input: ${JSON.stringify(input)}`,
    );
    if (mode === 'close') {
      const deadline = Date.now() + QUEUED_OPEN_MS;
      while (await main.evaluate((candidate) => candidate.isVisible())) {
        assert.ok(Date.now() < deadline, 'clicking the close button did not hide the main window');
        await new Promise((wake) => setTimeout(wake, 25));
      }
      assert.deepEqual(
        await window.evaluate(() => globalThis.__cairnSmokeMainInputs),
        [],
        'the close button click reached the main window document',
      );
    } else {
      await window.waitForFunction(
        (events) => events.every((type) => globalThis.__cairnSmokeMainInputs.includes(type)),
        types,
        { timeout: QUEUED_OPEN_MS },
      );
    }
    return queuedAt;
  }

  const expireQueuedOpen = () => driver.send({ cmd: 'sleep', ms: QUEUED_OPEN_EXPIRY_WAIT_MS });
  for (const [name, exercise, cleanup] of [
    [
      'a click inside the blur guard does not queue an open for the committed reload',
      async () => {
        await popoverWindow(({ BrowserWindow, webContents }) => {
          const cold = globalThis.__cairnColdTray;
          const popover = BrowserWindow.fromWebContents(webContents.fromId(cold.contentsId));
          cold.beforeClick = () => {
            cold.beforeClick = null;
            popover.emit('blur');
          };
        });
        try {
          await clickWhileHidden();
        } finally {
          await popoverWindow(() => {
            globalThis.__cairnColdTray.beforeClick = null;
          });
        }
      },
    ],
    [
      'an expired queued open leaves the finished reload in the background',
      async () => {
        await clickWhileHidden();
        await expireQueuedOpen();
      },
    ],
    [
      'a second click cancels a fresh queued open while the popover is still hidden',
      async () => {
        await clickWhileHidden();
        await expireQueuedOpen();
        const queuedAt = await clickWhileHidden();
        await clickWhileHidden();
        return queuedAt;
      },
    ],
    [
      'a native double-click cancels a queued open during a committed reload',
      () => clickWhileHidden(true),
    ],
    [
      'Escape reaches the main window and cancels a queued open during a committed reload',
      async () => dismissFromMainWindow(await app.browserWindow(window), 'escape'),
    ],
    [
      'a click reaches the main window and cancels a queued open during a committed reload',
      async () => {
        const main = await app.browserWindow(window);
        try {
          await main.evaluate((candidate) => candidate.setAlwaysOnTop(true, 'pop-up-menu'));
          return await dismissFromMainWindow(main, 'content');
        } finally {
          await main.evaluate((candidate) => candidate.setAlwaysOnTop(false));
        }
      },
    ],
    [
      'closing the main window cancels a queued open during a committed reload',
      async () => {
        const main = await app.browserWindow(window);
        await main.evaluate((candidate) => candidate.setAlwaysOnTop(true, 'pop-up-menu'));
        return dismissFromMainWindow(main, 'close');
      },
      async () => {
        const main = await app.browserWindow(window);
        await main.evaluate((candidate) => {
          candidate.setAlwaysOnTop(false);
          if (candidate.isMinimized()) candidate.restore();
          candidate.show();
          candidate.focus();
        });
      },
    ],
  ]) {
    const outcome = { name, result: 'red', detail: '' };
    outcomes.push(outcome);
    await mandatory(outcome, async () => {
      await dismiss();
      try {
        return await withHeldReload(async ({ assertHeld, release }) => {
          const { shows } = await assertHeld();
          const queuedAt = await exercise();
          await assertHeld();
          release();
          const finished = await waitForPopover(
            ({ reload, loading }) => reload.finished && loading === false,
          );
          assert.ok(finished !== null, 'the held reload did not finish after release');
          if (queuedAt !== undefined) {
            const elapsed = finished.reload.finishedAt - queuedAt;
            assert.ok(elapsed < QUEUED_OPEN_MS, `the reload finished after expiry (${elapsed} ms)`);
          }
          assert.equal(finished.shows, shows, 'the held reload showed the popover after release');
          assert.equal((await popoverOnScreen()).onScreen, false, 'the popover was on screen');
          return 'reload finished without showing';
        });
      } finally {
        await cleanup?.();
      }
    });
    console.log(`tray ${outcome.result}: ${outcome.name}: ${outcome.detail}`);
    await restoreTray();
  }

  const abortedRecovery = {
    name: 'a click retries after the held recovery load is aborted',
    result: 'red',
    detail: '',
  };
  outcomes.push(abortedRecovery);
  await mandatory(abortedRecovery, async () => {
    await crashPopover();
    await popoverWindow(({ session }, url) => {
      const recovery = { release: null };
      globalThis.__cairnSmokeRecovery = recovery;
      session.defaultSession.webRequest.onBeforeRequest(
        { urls: ['http://127.0.0.1/*'] },
        ({ webContentsId, resourceType, url: target }, callback) => {
          if (
            webContentsId === globalThis.__cairnColdTray.contentsId &&
            resourceType === 'mainFrame' &&
            target === url &&
            recovery.release === null
          ) {
            recovery.release = callback;
          } else {
            callback({});
          }
        },
      );
    }, trayUrl);
    try {
      await clickWhileHidden();
      const held = await waitForPopover(({ recoveryHeld, loading }) => recoveryHeld && loading);
      assert.ok(held !== null, 'the click did not start a held recovery load');
      await popoverWindow(({ webContents }) => {
        webContents.fromId(globalThis.__cairnColdTray.contentsId).stop();
      });
      const stopped = await waitForPopover(({ loading }) => loading === false);
      assert.ok(stopped !== null, 'the held recovery load did not stop');
      assert.equal(stopped.shows, held.shows, 'the aborted load showed the popover');
    } finally {
      await popoverWindow(({ session }) => {
        const recovery = globalThis.__cairnSmokeRecovery;
        session.defaultSession.webRequest.onBeforeRequest(null);
        recovery.release?.({});
        recovery.release = null;
      });
    }
    await clickStatusItem();
    const shown = await waitForScreen(true);
    assert.equal(shown.onScreen, true, `the next click did not recover the panel: ${shown.reason}`);
    await assertTrayRecovered();
    return JSON.stringify(shown.entry);
  });
  console.log(`tray ${abortedRecovery.result}: ${abortedRecovery.name}: ${abortedRecovery.detail}`);
  await restoreTray();

  await popoverWindow(({ BrowserWindow }, width) => {
    const contents = BrowserWindow.getAllWindows().find(
      (candidate) => candidate.getBounds().width === width,
    ).webContents;
    globalThis.__cairnSmokeWatch = { started: null, committed: null, finished: null, failed: null };
    contents.on('did-start-navigation', (event) => {
      if (event.isMainFrame && !event.isSameDocument)
        globalThis.__cairnSmokeWatch.started ??= event.url;
    });
    contents.on('did-navigate', (_event, url) => {
      globalThis.__cairnSmokeWatch.committed ??= url;
    });
    contents.on('did-finish-load', () => {
      globalThis.__cairnSmokeWatch.finished ??= contents.getURL();
    });
    contents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
      if (isMainFrame) globalThis.__cairnSmokeWatch.failed ??= { code, description, url };
    });
  });

  const armRecoveryWatch = () =>
    popoverWindow(() => {
      globalThis.__cairnSmokeWatch = {
        started: null,
        committed: null,
        finished: null,
        failed: null,
      };
    });

  async function assertClickRecovered(before) {
    const delivered = await waitForPopover(({ clicks }) => clicks > before.clicks);
    assert.ok(delivered !== null, 'the status item click never reached the tray');
    const navigated = await waitForPopover(({ watch }) => watch !== null && watch.started !== null);
    assert.ok(navigated !== null, 'the click never started the recovery navigation');
    const settled = await waitForPopover(
      ({ watch }) => watch !== null && (watch.finished !== null || watch.failed !== null),
    );
    assert.ok(settled !== null, 'the recovery navigation never settled');
    assert.equal(
      settled.watch.failed,
      null,
      `the recovery load failed: ${JSON.stringify(settled.watch.failed)}`,
    );
    assert.equal(
      settled.watch.committed === trayUrl && settled.watch.finished === trayUrl,
      true,
      `the click recovered ${JSON.stringify(settled.watch)} instead of the tray`,
    );
    assert.equal(
      settled.shows,
      before.shows + 1,
      'the recovery click did not show the popover exactly once',
    );
    await assertTrayRecovered();
  }

  const states = [
    {
      name: 'app in the background',
      async prepare() {
        const activated = await driver.send({ cmd: 'activateBundle', bundle: 'com.apple.finder' });
        assert.ok(
          activated.ok === true && activated.active === true,
          `Finder is not frontmost: ${JSON.stringify(activated)}`,
        );
      },
    },
    {
      name: 'app hidden',
      async prepare() {
        const hidden = await driver.send({ cmd: 'hide', pid: appPid });
        assert.equal(hidden.hidden, true, `the app did not hide: ${JSON.stringify(hidden)}`);
      },
      async restore() {
        const unhidden = await driver.send({ cmd: 'unhide', pid: appPid });
        assert.equal(unhidden.hidden, false, `the app did not unhide: ${JSON.stringify(unhidden)}`);
      },
    },
    {
      name: 'main window closed',
      async prepare() {
        const closed = await popoverWindow(({ BrowserWindow }) => {
          const mains = () =>
            BrowserWindow.getAllWindows().filter(
              (candidate) => !candidate.webContents.getURL().endsWith('/tray'),
            );
          const shown = mains().find((candidate) => candidate.isVisible());
          shown?.close();
          const after = mains();
          return {
            shown: shown !== undefined,
            windows: after.length,
            visible: after[0]?.isVisible() ?? false,
            same: after[0] === shown,
          };
        });
        assert.deepEqual(
          closed,
          { shown: true, windows: 1, visible: false, same: true },
          'closing the window did not leave the same main window hidden',
        );
        assert.equal(
          (await fetch(origin)).status,
          200,
          'the server stopped when the window closed',
        );
      },
    },
    {
      name: 'click after a click outside closed it',
      async prepare() {
        const target = await driver.send({ cmd: 'showFixture' });
        assert.equal(
          target.ok,
          true,
          `the outside fixture did not open: ${JSON.stringify(target)}`,
        );
        await clickStatusItem();
        const shown = await waitForScreen(true);
        assert.equal(shown.onScreen, true, `the popover did not open first: ${shown.reason}`);
        const clicked = await driver.send({
          cmd: 'clickOutside',
          pid: appPid,
          popoverNumber: shown.entry.number,
        });
        assert.ok(
          clicked.ok === true &&
            clicked.top.pid === driverInfo.pid &&
            clicked.top.number === target.number,
          `the outside click did not hit the fixture: ${JSON.stringify(clicked)}`,
        );
        step(`outside click hit the fixture: ${JSON.stringify(clicked)}`);
        const closed = await waitForScreen(false);
        assert.equal(closed.onScreen, false, `clicking outside did not close it: ${closed.reason}`);
        await driver.send({ cmd: 'sleep', ms: DISMISS_GAP_MS });
      },
      async restore() {
        await driver.send({ cmd: 'restoreFixture' });
      },
    },
    {
      name: 'click after Escape closed it',
      async prepare() {
        await clickStatusItem();
        const shown = await waitForScreen(true);
        assert.equal(shown.onScreen, true, `the popover did not open first: ${shown.reason}`);
        await assertTrayRecovered();
        assert.equal(
          (await popoverState()).focused,
          true,
          'the panel did not have focus before Escape',
        );
        const escaped = await driver.send({ cmd: 'escape', pid: appPid });
        assert.equal(
          escaped.ok,
          true,
          `the driver did not send Escape: ${JSON.stringify(escaped)}`,
        );
        const closed = await waitForScreen(false);
        assert.equal(closed.onScreen, false, `Escape did not close it: ${closed.reason}`);
        await driver.send({ cmd: 'sleep', ms: DISMISS_GAP_MS });
      },
    },
    { name: 'right click on the icon', button: 'right' },
    {
      name: 'click after the popover page reloaded',
      async prepare() {
        const reloaded = await popoverWindow(({ BrowserWindow }, width) => {
          const popover = BrowserWindow.getAllWindows().find(
            (candidate) => candidate.getBounds().width === width,
          );
          const contents = popover.webContents;
          return new Promise((done) => {
            const loaded = () => {
              if (contents.isLoading()) contents.once('did-stop-loading', loaded);
              else done(contents.getURL());
            };
            contents.once('did-finish-load', loaded);
            contents.reload();
          });
        });
        assert.equal(reloaded, trayUrl, 'the popover page did not reload');
      },
      atClick(state) {
        assert.equal(state.loading, false, 'the popover page was still loading at the click');
      },
    },
    {
      name: 'popover page failed to load',
      async prepare() {
        const failing = createServer((_request, response) => response.destroy());
        await new Promise((done) => failing.listen(0, '127.0.0.1', done));
        const url = `http://127.0.0.1:${failing.address().port}/tray`;
        try {
          const failed = await popoverWindow(
            async ({ BrowserWindow }, args) => {
              const popover = BrowserWindow.getAllWindows().find(
                (candidate) => candidate.getBounds().width === args.width,
              );
              const ended = new Promise((done) => {
                popover.webContents.once(
                  'did-fail-load',
                  (_event, code, description, failedUrl, isMainFrame) =>
                    done({ code, description, failedUrl, isMainFrame }),
                );
              });
              await popover.loadURL(args.url).catch(() => {});
              return Promise.race([
                ended,
                new Promise((done) => setTimeout(() => done(null), 10_000)),
              ]);
            },
            { width: TRAY_POPOVER_WIDTH, url },
          );
          assert.ok(failed !== null, 'the popover page load never reported a failure');
          assert.equal(
            failed.isMainFrame,
            true,
            `the load failure was not the main frame: ${JSON.stringify(failed)}`,
          );
          assert.equal(
            failed.failedUrl,
            url,
            `the load failure was not our URL: ${JSON.stringify(failed)}`,
          );
          assert.ok(
            failed.code < 0,
            `the load failure was not a network error: ${JSON.stringify(failed)}`,
          );
          console.log(`popover load failure: ${JSON.stringify(failed)}`);
        } finally {
          failing.close();
        }
      },
      atClick(state) {
        assert.equal(state.loading, false, 'the popover page was still loading at the click');
        assert.equal(state.crashed, false, 'the popover renderer was crashed at the click');
      },
      arm: armRecoveryWatch,
      openTimeout: GAP_TIMEOUT_MS,
      afterOpen: assertClickRecovered,
    },
    {
      name: 'popover renderer crashed',
      prepare: crashPopover,
      atClick(state) {
        assert.equal(state.crashed, true, 'the popover renderer was not crashed at the click');
      },
      arm: armRecoveryWatch,
      openTimeout: GAP_TIMEOUT_MS,
      afterOpen: assertClickRecovered,
    },
    {
      name: 'click recovers a renderer that crashed before its document finished',
      async prepare() {
        await withHeldReload(async () => {
          await crashPopover();
          assert.equal(
            (await popoverState()).reload.finished,
            false,
            'the fresh document finished before the renderer crashed',
          );
        });
      },
      atClick(state) {
        assert.equal(
          state.crashed,
          true,
          'the fresh document renderer was not crashed at the click',
        );
      },
      arm: armRecoveryWatch,
      openTimeout: GAP_TIMEOUT_MS,
      afterOpen: assertClickRecovered,
    },
    {
      name: 'another app full screen',
      optional: true,
      async prepare() {
        const fixture = await driver.send({ cmd: 'showFixture', fullScreen: true });
        if (fixture.ok !== true)
          throw new NotCovered(`the full-screen fixture did not open: ${JSON.stringify(fixture)}`);
        const state = await waitForFixtureMode(
          ({ mode, onScreen }) => mode === 'windowed' || (mode === 'fullScreen' && onScreen),
        );
        if (state.mode !== 'fullScreen' || !state.onScreen)
          throw new NotCovered(`the fixture did not enter full screen: ${JSON.stringify(state)}`);
        console.log(`another app full screen: ${JSON.stringify(fixture)}`);
      },
      async restore() {
        await driver.send({ cmd: 'restoreFixture' });
        const { mode } = await waitForFixtureMode(
          ({ mode }) => mode === 'windowed' || mode === 'exitFailed',
        );
        assert.equal(mode, 'windowed', 'the fixture did not restore its original window mode');
      },
    },
  ];

  for (const state of states) {
    const outcome = { name: state.name, result: 'red', detail: '' };
    outcomes.push(outcome);
    let preparing = false;
    try {
      step(`state ${state.name}: closing`);
      await dismiss();
      preparing = true;
      step(`state ${state.name}: preparing`);
      if (state.prepare !== undefined) await state.prepare();
      const before = await popoverState();
      outcome.loading = before.loading;
      if (state.atClick !== undefined) state.atClick(before);
      if (state.arm !== undefined) await state.arm();
      await clickStatusItem(state.button ?? 'left');
      const seen = await waitForScreen(true, state.openTimeout);
      if (seen.onScreen) {
        if (state.afterOpen !== undefined) await state.afterOpen(before);
        outcome.result = 'green';
        outcome.detail = JSON.stringify(seen.entry);
      } else {
        outcome.detail = seen.reason;
        if (state.arm !== undefined) {
          const { watch } = await popoverState();
          if (watch !== null) outcome.detail += ` recovery=${JSON.stringify(watch)}`;
        }
      }
    } catch (error) {
      if (error instanceof TrayDriverStopped) throw error;
      outcome.result =
        preparing && state.optional === true && error instanceof NotCovered ? 'not covered' : 'red';
      outcome.detail = error.message;
    }
    if (preparing && state.restore !== undefined) {
      try {
        await state.restore();
      } catch (error) {
        if (error instanceof TrayDriverStopped) throw error;
        outcome.result = 'red';
        outcome.detail = `${outcome.detail}; cleanup failed: ${error.message}`;
      }
    }
    console.log(
      `tray ${outcome.result}: ${outcome.name}: loading=${outcome.loading} focused=${(await popoverState()).focused} ${outcome.detail}`,
    );
  }
  await bounded(
    app.evaluate(
      ({ BrowserWindow }, args) => {
        const popover = BrowserWindow.getAllWindows().find(
          (candidate) => candidate.getBounds().width === args.width,
        );
        return popover.loadURL(args.url).catch(() => {});
      },
      { width: TRAY_POPOVER_WIDTH, url: trayUrl },
    ),
    'the app',
  );
  const verified = outcomes.filter((outcome) => outcome.result === 'green');
  const missed = outcomes.filter((outcome) => outcome.result === 'red');
  const skipped = outcomes.filter((outcome) => outcome.result === 'not covered');
  console.log(
    `tray checks: ${outcomes.map((outcome) => `${outcome.name}=${outcome.result}`).join(', ')}`,
  );
  assert.deepEqual(
    missed,
    [],
    `the popover did not open in these cases: ${JSON.stringify(missed)}`,
  );
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
  await bounded(
    app
      .evaluate(({ app: electronApp }) => {
        electronApp.quit();
      })
      .catch(() => {}),
    'the app',
  ).catch(() => {});
  const quit = await withDeadline(exited, QUIT_TIMEOUT_MS);
  assert.equal(
    quit,
    'done',
    `the app did not exit: exitCode=${child.exitCode} signal=${child.signalCode} servers=${serverPids(child.pid)}`,
  );
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
    const abruptOrigin = new URL((await mainWindow(abrupt, LAUNCH_TIMEOUT_MS)).url()).origin;
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
        if (
          serverProcesses().length === 0 &&
          unreachable &&
          matchingPids(`${appRoot}/${NATIVE_TRAY_HELPER}`).length === 0
        )
          return true;
        await new Promise((wake) => setTimeout(wake, 500));
      }
      return false;
    })();
    assert.equal(drained, true, 'the server or the native tray helper outlived a killed app');
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
    `desktop smoke passed: ${origin} signed in, no pairing gate, Runner online, the tray opened in ${verified.length} verified cases, not covered: ${skipped.map((outcome) => outcome.name).join(', ') || 'none'}, quit stops the server and Runner`,
  );
} finally {
  driver?.close();
  if (child.exitCode === null && child.signalCode === null) {
    await withDeadline(
      app.close().catch(() => {}),
      QUIT_TIMEOUT_MS,
    );
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }
}
