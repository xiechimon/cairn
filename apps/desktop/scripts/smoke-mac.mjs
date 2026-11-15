import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { _electron as electron } from '@playwright/test';

const LAUNCH_TIMEOUT_MS = 120_000;
const GATE_SETTLE_MS = 5_000;
const PAIRING_INPUT = '#cairn-pair-input';

const [appPath, screenshotPath] = process.argv.slice(2);
if (appPath === undefined || screenshotPath === undefined) {
  console.error('usage: node scripts/smoke-mac.mjs <Cairn.app> <screenshot.png>');
  process.exit(2);
}

const app = await electron.launch({
  executablePath: join(resolve(appPath), 'Contents', 'MacOS', 'Cairn'),
  timeout: LAUNCH_TIMEOUT_MS,
});
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

  await window.screenshot({ path: screenshotPath });
  console.log(`desktop smoke passed: ${window.url()} signed in, no pairing gate`);
} finally {
  await app.close();
}
