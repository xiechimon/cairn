import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { _electron as electron } from '@playwright/test';

const LAUNCH_TIMEOUT_MS = 120_000;
const GATE_SETTLE_MS = 5_000;
const PAIRING_INPUT = '#cairn-pair-input';
const UPDATE_BUTTON = '[data-testid="desktop-update"]';

const [appPath, screenshotPath] = process.argv.slice(2);
if (appPath === undefined || screenshotPath === undefined) {
  console.error('usage: node scripts/smoke-mac.mjs <Cairn.app> <screenshot.png>');
  process.exit(2);
}

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

  await window.locator(UPDATE_BUTTON).waitFor({ timeout: GATE_SETTLE_MS });
  const update = await window.evaluate(async () => {
    const bridge = window.cairnDesktop.update;
    await bridge.check();
    return bridge.state();
  });
  assert.ok(
    ['current', 'available', 'error'].includes(update?.status),
    `the update check ended in ${JSON.stringify(update)}`,
  );
  console.log(`update check: ${JSON.stringify(update)}`);

  await window.screenshot({ path: screenshotPath });
  const origin = new URL(window.url()).origin;

  const closed = await app.evaluate(({ BrowserWindow }) => {
    const [shown] = BrowserWindow.getAllWindows();
    shown?.close();
    return { windows: BrowserWindow.getAllWindows().length, visible: shown?.isVisible() ?? false };
  });
  assert.deepEqual(closed, { windows: 1, visible: false }, 'closing the window did not hide it');
  assert.equal((await fetch(origin)).status, 200, 'the server stopped when the window closed');

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

  console.log(
    `desktop smoke passed: ${origin} signed in, no pairing gate, close hides, quit stops the server`,
  );
} finally {
  if (child.exitCode === null && child.signalCode === null) await app.close();
}
