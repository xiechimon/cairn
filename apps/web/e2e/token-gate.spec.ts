import { expect, type Page, test } from '@playwright/test';
import { bootLiveServer, type LiveServer } from './live-server';

declare global {
  interface Window {

    __esUrls?: string[];
  }
}

const GATE_TOKEN = 'cairn-e2e-gate-token-0123456789abcdef';
const FORGED_TAILSCALE_LOGIN = 'xiechimon@github';

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

test('auth on, loopback: bootstrap session opens the board and SSE uses a ticket, not the owner token', async ({
  page,
}) => {
  test.skip(process.platform !== 'linux', 'loopback bootstrap reads /proc/net/tcp');
  await recordEventSourceUrls(page);
  await page.goto(`${authed.base}/app`);
  await expect(page.locator('.board-sidebar')).toBeVisible();
  await expect(page.locator('.token-gate')).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('cairn.token'))).toBeNull();
  await expect
    .poll(async () =>
      (await streamUrls(page)).some((url) => url.includes('/stream?') && url.includes('ticket=')),
    )
    .toBe(true);
  for (const url of await streamUrls(page)) expect(url).not.toContain('token=');
});

test('auth on: a stored owner token is cleared and is not sent', async ({ page }) => {
  test.skip(process.platform !== 'linux', 'loopback bootstrap reads /proc/net/tcp');
  await recordEventSourceUrls(page);
  await page.addInitScript(() => localStorage.setItem('cairn.token', 'stale-bad-token'));
  await page.goto(`${authed.base}/app`);
  await expect(page.locator('.board-sidebar')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('cairn.token'))).toBeNull();
  for (const url of await streamUrls(page)) expect(url).not.toContain('stale-bad-token');
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

test('a forged Tailscale-User-Login header is not required on loopback', async ({ page }) => {
  test.skip(process.platform !== 'linux', 'loopback bootstrap reads /proc/net/tcp');
  await page.setExtraHTTPHeaders({ 'Tailscale-User-Login': FORGED_TAILSCALE_LOGIN });
  const loaded = page.waitForResponse(
    (res) => res.url().endsWith('/api/teams') && res.status() === 200,
  );
  await page.goto(`${authed.base}/app`);
  await loaded;
  await expect(page.locator('.token-gate')).toHaveCount(0);
});
