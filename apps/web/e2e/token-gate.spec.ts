import { ENV_VARS } from '@cairn/shared';
import { expect, type Page, test } from '@playwright/test';
import { bootLiveServer, type LiveServer } from './live-server';

declare global {
  interface Window {

    __esUrls?: string[];
  }
}

const GATE_TOKEN = 'cairn-e2e-gate-token-0123456789abcdef';

async function recordEventSourceUrls(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const urls: string[] = [];
    (window as Window).__esUrls = urls;
    const Native = window.EventSource;
    const Patched = function (url: string | URL, init?: EventSourceInit) {
      urls.push(String(url));
      return new Native(url, init);
    } as unknown as typeof EventSource;
    window.EventSource = Patched;
  });
}

async function streamUrls(page: Page): Promise<string[]> {
  return page.evaluate(() => window.__esUrls ?? []);
}

let authed: LiveServer;
let openServer: LiveServer;

test.beforeAll(async () => {
  authed = await bootLiveServer(GATE_TOKEN);
  openServer = await bootLiveServer(null);
});

test.afterAll(async () => {
  await Promise.all([authed, openServer].map((server) => server?.dispose()));
});

test('auth on: first visit lands the gate page; wrong token stays without persisting; right token enters the UI and SSE carries ?token=', async ({
  page,
}) => {
  await recordEventSourceUrls(page);
  await page.goto(`${authed.base}/app`);

  await expect(page.locator('.token-gate')).toBeVisible();
  await expect(page.locator('.token-gate-title')).toHaveText('需要访问令牌');

  await page.locator('.token-gate-input').fill('wrong-token');
  await page.locator('.token-gate-submit').click();
  await expect(page.locator('.token-gate-error')).toHaveText('令牌无效，请重试。');
  await expect(page.locator('.token-gate')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('cairn.token'))).toBeNull();

  expect(await page.locator('.token-gate').innerText()).not.toContain('Unauthorized');

  const retryLands = page.waitForResponse(
    (res) => res.url().endsWith('/api/teams') && res.status() === 200,
  );
  await page.locator('.token-gate-input').fill(GATE_TOKEN);
  await page.locator('.token-gate-submit').click();
  await expect(page.locator('.token-gate')).toHaveCount(0);
  await expect(page.locator('.board-sidebar')).toBeVisible();
  const retried = await retryLands;
  expect(retried.request().headers().authorization).toBe(`Bearer ${GATE_TOKEN}`);
  expect(await page.evaluate(() => localStorage.getItem('cairn.token'))).toBe(GATE_TOKEN);

  await expect
    .poll(async () =>
      (await streamUrls(page)).some(
        (url) => url.includes('/stream?') && new URL(url, authed.base).searchParams.get('token') === GATE_TOKEN,
      ),
    )
    .toBe(true);
});

test('auth on: a stale bad token lands the gate page on first visit and the bad value is cleared', async ({ page }) => {
  await recordEventSourceUrls(page);
  await page.addInitScript(() => localStorage.setItem('cairn.token', 'stale-bad-token'));
  await page.goto(`${authed.base}/app`);

  await expect(page.locator('.token-gate')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('cairn.token'))).toBeNull();
  for (const url of await streamUrls(page)) {
    expect(url).not.toContain('stale-bad-token');
  }
});

test('auth on: a good token already in localStorage → first visit reaches the UI directly, zero gate page', async ({ page }) => {
  await recordEventSourceUrls(page);
  await page.addInitScript(
    (token: string) => localStorage.setItem('cairn.token', token),
    GATE_TOKEN,
  );
  const firstLoad = page.waitForResponse(
    (res) => res.url().endsWith('/api/teams') && res.status() === 200,
  );
  await page.goto(`${authed.base}/app`);

  await expect(page.locator('.board-sidebar')).toBeVisible();
  await expect(page.locator('.token-gate')).toHaveCount(0);
  expect((await firstLoad).request().headers().authorization).toBe(`Bearer ${GATE_TOKEN}`);
  await expect
    .poll(async () => (await streamUrls(page)).some((url) => url.includes('/stream?token=')))
    .toBe(true);
});

test('auth off: zero gate page, zero token attached, behavior unchanged', async ({ page }) => {
  await recordEventSourceUrls(page);
  const firstLoad = page.waitForResponse((res) => res.url().endsWith('/api/teams'));
  await page.goto(`${openServer.base}/app`);

  await expect(page.locator('.board-sidebar')).toBeVisible();
  await expect(page.locator('.token-gate')).toHaveCount(0);
  const res = await firstLoad;
  expect(res.status()).toBe(200);
  expect(res.request().headers().authorization).toBeUndefined();
  await expect
    .poll(async () => (await streamUrls(page)).some((url) => url.includes('/stream')))
    .toBe(true);
  for (const url of await streamUrls(page)) {
    expect(url).not.toContain('token=');
  }
});

test('#1048 gate page guide: the zh face tells where the token comes from (variable name / EnvironmentFile / restart to disable)', async ({
  page,
}) => {
  await page.goto(`${authed.base}/app`);
  const help = page.locator('.token-gate-help');
  await expect(help).toBeVisible();

  await expect(help).toContainText(ENV_VARS.token);

  await expect(help).toContainText('EnvironmentFile');

  await expect(help).toContainText('重启');

  expect(await help.innerText()).not.toMatch(new RegExp(`${ENV_VARS.token}\\s*=`));
});

test('#1048 gate page guide: the en face keeps the same facts undistorted (variable name interpolated through the dictionary template)', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('cairn.locale', 'en');
    localStorage.setItem('cairn-locale', 'en');
  });
  await page.goto(`${authed.base}/app`);
  const help = page.locator('.token-gate-help');
  await expect(help).toBeVisible();

  await expect(help).toContainText(ENV_VARS.token);
  await expect(help).toContainText('EnvironmentFile');
  await expect(help).toContainText(/restart/i);
  expect(await help.innerText()).not.toMatch(new RegExp(`${ENV_VARS.token}\\s*=`));
});
