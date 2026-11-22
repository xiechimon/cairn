import { expect, type APIRequestContext, type Page, test } from '@playwright/test';
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

async function issuePairingCode(request: APIRequestContext, base: string): Promise<string> {
  const res = await request.post(`${base}/api/remote/pairing`, {
    headers: { authorization: `Bearer ${GATE_TOKEN}` },
  });
  expect(res.status()).toBe(201);
  return ((await res.json()) as { code: string }).code;
}

async function redeemAtGate(page: Page, code: string): Promise<void> {
  await page.locator('#cairn-pair-input').fill(code);
  await page.locator('#cairn-pair-input').press('Enter');
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

test('auth on, loopback: the gate blocks the board until a pairing code opens it as a device', async ({
  page,
  request,
}) => {
  await recordEventSourceUrls(page);
  await page.goto(`${authed.base}/app`);
  await expect(page.locator('.token-gate')).toBeVisible();

  const code = await issuePairingCode(request, authed.base);
  await redeemAtGate(page, code);

  await expect(page.locator('.token-gate')).toHaveCount(0);
  await expect(page.locator('.board-sidebar')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('cairn.token'))).toBeNull();
  await expect
    .poll(async () =>
      (await streamUrls(page)).some((url) => url.includes('/stream?') && url.includes('ticket=')),
    )
    .toBe(true);
  for (const url of await streamUrls(page)) expect(url).not.toContain('token=');
});

test('auth on: a stored owner token is cleared and is not sent', async ({ page, request }) => {
  await recordEventSourceUrls(page);
  await page.addInitScript(() => localStorage.setItem('cairn.token', 'stale-bad-token'));
  await page.goto(`${authed.base}/app`);
  await expect(page.locator('.token-gate')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('cairn.token'))).toBeNull();

  const code = await issuePairingCode(request, authed.base);
  await redeemAtGate(page, code);
  await expect(page.locator('.board-sidebar')).toBeVisible();
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

test('a forged Tailscale-User-Login header does not open the board', async ({ page }) => {
  await page.setExtraHTTPHeaders({ 'Tailscale-User-Login': FORGED_TAILSCALE_LOGIN });
  await page.goto(`${authed.base}/app`);
  await expect(page.locator('.token-gate')).toBeVisible();
});
