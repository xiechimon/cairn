import { expect, test } from '@playwright/test';
import { bootLiveServer, type LiveServer } from './live-server';

const TOKEN = 'owner-link-browser-test-secret';
let live: LiveServer;

test.beforeAll(async () => {
  live = await bootLiveServer(TOKEN, { CAIRN_REQUIRE_TOKEN: '1' });
});

test.afterAll(async () => {
  await live?.dispose();
});

test('without loopback proof, the owner link from `token --link` signs the browser in as the owner', async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => {
    localStorage.setItem('cairn.locale', 'en');
  });
  await page.goto(`${live.base}/app`);
  await expect(page.locator('.token-gate')).toBeVisible();
  await expect(page.locator('.token-gate-owner-link')).toContainText('token --link');
  await page.screenshot({ path: testInfo.outputPath('owner-link-gate.png') });

  const minted = await fetch(`${live.base}/api/auth/owner-link`, {
    method: 'POST',
    headers: { authorization: `Bearer ${TOKEN}` },
  });
  expect(minted.status).toBe(201);
  const { code } = (await minted.json()) as { code: string };

  await page.goto(`${live.base}/app#owner=${code}`);
  await expect(page.locator('.token-gate')).toHaveCount(0);
  expect(await page.evaluate(() => location.hash)).toBe('');
  const pairing = await page.evaluate(
    async () => (await fetch('/api/remote/pairing', { method: 'POST' })).status,
  );
  expect(pairing).toBe(201);
  await page.screenshot({ path: testInfo.outputPath('owner-link-signed-in.png') });
});
