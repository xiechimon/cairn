import { expect, test } from '@playwright/test';
import { bootLiveServer, type LiveServer } from './live-server';

let live: LiveServer;

test.beforeAll(async () => {
  live = await bootLiveServer('loopback-browser-test-secret');
});

test.afterAll(async () => {
  await live?.dispose();
});

test('the owner browser on the server machine opens /app without a token', async ({ page }, testInfo) => {
  test.skip(process.platform !== 'linux', 'loopback owner trust reads /proc/net/tcp');
  await page.addInitScript(() => {
    localStorage.setItem('cairn.locale', 'en');
    localStorage.setItem('cairn-locale', 'en');
  });
  const teams = page.waitForResponse(
    (res) => new URL(res.url()).pathname === '/api/teams' && res.status() === 200,
  );
  await page.goto(`${live.base}/app/settings/remote`);
  expect((await teams).status()).toBe(200);
  await expect(page.locator('.token-gate')).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('cairn.token'))).toBeNull();
  const identity = await page.evaluate(async () => (await fetch('/api/remote/identity')).json());
  expect(identity).toEqual({ login: null, via: null });
  const pairing = await page.evaluate(async () => (await fetch('/api/remote/pairing', { method: 'POST' })).status);
  expect(pairing).toBe(201);
  await page.screenshot({ path: testInfo.outputPath('loopback-owner.png'), fullPage: true });
});

