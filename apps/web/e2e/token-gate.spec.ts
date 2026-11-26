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

async function environmentId(request: APIRequestContext, base: string): Promise<string> {
  const res = await request.get(`${base}/api/remote/descriptor`);
  expect(res.status()).toBe(200);
  return ((await res.json()) as { environmentId: string }).environmentId;
}

async function redeemViaLink(page: Page, request: APIRequestContext, base: string): Promise<void> {
  const [code, env] = await Promise.all([
    issuePairingCode(request, base),
    environmentId(request, base),
  ]);
  await page.goto('about:blank');
  await page.goto(`${base}/app#pair=${encodeURIComponent(code)}&env=${encodeURIComponent(env)}`);
}

async function seedExistingInstall(
  request: APIRequestContext,
  base: string,
  token: string | null,
): Promise<void> {
  const headers: Record<string, string> = {};
  if (token !== null) headers.authorization = `Bearer ${token}`;
  const res = await request.post(`${base}/api/projects`, {
    data: { name: 'Token gate existing install' },
    headers,
  });
  expect(res.status()).toBe(201);
}

let authed: LiveServer;
let openServer: LiveServer;

test.beforeAll(async ({ request }) => {
  authed = await bootLiveServer(GATE_TOKEN);
  openServer = await bootLiveServer(null);
  await Promise.all([
    seedExistingInstall(request, authed.base, GATE_TOKEN),
    seedExistingInstall(request, openServer.base, null),
  ]);
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

  await redeemViaLink(page, request, authed.base);

  await expect(page.locator('.token-gate')).toHaveCount(0);
  await expect(
    page.locator('.board-sidebar, [data-testid="first-run-setup"]'),
  ).toBeVisible();
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

  await redeemViaLink(page, request, authed.base);
  await expect(
    page.locator('.board-sidebar, [data-testid="first-run-setup"]'),
  ).toBeVisible();
  for (const url of await streamUrls(page)) expect(url).not.toContain('stale-bad-token');
});

test('auth off: zero gate page, zero token attached, behavior unchanged', async ({ page }) => {
  await recordEventSourceUrls(page);
  const firstLoad = page.waitForResponse((res) => res.url().endsWith('/api/teams'));
  await page.goto(`${openServer.base}/app`);

  await expect(
    page.locator('.board-sidebar, [data-testid="first-run-setup"]'),
  ).toBeVisible();
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

for (const secondTab of ['is closed', 'stays open'] as const) {
  test(`signing in leaves no pairing request pending when the tab that asked ${secondTab}`, async ({
    context,
    request,
  }) => {
    const openSignIn = async (path: string) => {
      const page = await context.newPage();
      const issued = page.waitForResponse((res) => res.url().endsWith('/api/remote/pair/request'));
      await page.goto(`${authed.base}${path}`);
      return { page, id: ((await (await issued).json()) as { id: string }).id };
    };
    const first = await openSignIn('/app');
    const second = await openSignIn('/tray');
    const pendingFromThisBrowser = async () => {
      const res = await request.get(`${authed.base}/api/remote/pairing-requests`, {
        headers: { authorization: `Bearer ${GATE_TOKEN}` },
      });
      const pending = (await res.json()) as { id: string }[];
      return [first.id, second.id].filter((id) => pending.some((entry) => entry.id === id));
    };
    expect(await pendingFromThisBrowser()).toEqual([second.id]);
    if (secondTab === 'is closed') await second.page.close();

    await first.page.getByTestId('owner-token-toggle').click();
    await first.page.getByTestId('owner-token-input').fill(GATE_TOKEN);
    await first.page.getByTestId('owner-token-submit').click();
    await expect(first.page.locator('.token-gate')).toHaveCount(0);

    await expect.poll(pendingFromThisBrowser).toEqual([]);
    await expect(first.page.getByTestId('pairing-request-banner')).toHaveCount(0);
    if (secondTab === 'stays open') {
      await expect(second.page.locator('.token-gate')).toHaveCount(0);
    }
  });
}
