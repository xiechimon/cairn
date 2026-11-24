import { expect, type APIRequestContext, type Page, test } from '@playwright/test';
import { bootLiveServer, type LiveServer } from './live-server';

const GATE_TOKEN = 'cairn-e2e-pair-request-token-0123456789abcdef';

async function pendingRequests(request: APIRequestContext, base: string) {
  const res = await request.get(`${base}/api/remote/pairing-requests`, {
    headers: { authorization: `Bearer ${GATE_TOKEN}` },
  });
  expect(res.status()).toBe(200);
  return (await res.json()) as { id: string; code: string; name: string; source: string }[];
}

async function gateCode(page: Page): Promise<string> {
  const code = page.getByTestId('pair-request-code');
  await expect(code).toBeVisible();
  return ((await code.textContent()) ?? '').replace('-', '');
}

async function expectGateAlone(page: Page): Promise<void> {
  const { alpha, leaks } = await page.evaluate(() => {
    const overlay = document.querySelector('.token-gate')?.closest('.fixed');
    if (!(overlay instanceof HTMLElement)) return { alpha: -1, leaks: ['gate overlay missing'] };
    const channels = getComputedStyle(overlay).backgroundColor.match(/[\d.]+%?/g) ?? [];
    const raw = channels[3];
    const alpha =
      raw === undefined ? 1 : raw.endsWith('%') ? Number(raw.slice(0, -1)) / 100 : Number(raw);
    const leaks: string[] = [];
    for (let x = 1; x < innerWidth; x += Math.max(1, Math.floor(innerWidth / 24))) {
      for (let y = 1; y < innerHeight; y += Math.max(1, Math.floor(innerHeight / 18))) {
        const el = document.elementFromPoint(x, y);
        if (el === null || el === overlay || overlay.contains(el) || el.contains(overlay)) {
          continue;
        }
        leaks.push(`${x},${y} → ${el.tagName.toLowerCase()}`);
      }
    }
    return { alpha, leaks };
  });
  expect(alpha, 'the gate veils the app with an opaque background').toBe(1);
  expect(leaks, 'nothing outside the gate is hit-testable while unpaired').toEqual([]);
}

async function ownerDecision(
  request: APIRequestContext,
  base: string,
  code: string,
  decision: 'approve' | 'deny',
): Promise<void> {
  const pending = await pendingRequests(request, base);
  const match = pending.find((row) => row.code === code);
  expect(match, `a pending pairing request with code ${code}`).toBeDefined();
  const res = await request.post(`${base}/api/remote/pairing-requests/${match?.id}/${decision}`, {
    headers: { authorization: `Bearer ${GATE_TOKEN}` },
  });
  expect(res.status()).toBe(200);
}

let server: LiveServer;

test.beforeAll(async () => {
  server = await bootLiveServer(GATE_TOKEN);
});

test.afterAll(async () => {
  await server?.dispose();
});

test('an unpaired browser requests pairing, the owner approves, and the board opens', async ({
  page,
  request,
}) => {
  await page.goto(`${server.base}/app`);
  await expect(page.locator('.token-gate')).toBeVisible();
  await expectGateAlone(page);
  const code = await gateCode(page);
  await ownerDecision(request, server.base, code, 'approve');
  await expect(page.locator('.token-gate')).toHaveCount(0);
  await expect
    .poll(async () =>
      (await page.context().cookies(server.base)).some(
        (cookie) => cookie.name === 'cairn_auth' && cookie.value !== '',
      ),
    )
    .toBe(true);
  await expect(
    page.locator(
      '.board-sidebar, [data-testid="first-run-setup"], [data-testid="first-run-frame"]',
    ),
  ).toBeVisible();
});

test('a denied requester sees the refusal and can request again', async ({ page, request }) => {
  await page.goto(`${server.base}/app`);
  const code = await gateCode(page);
  await ownerDecision(request, server.base, code, 'deny');
  await expect(page.getByTestId('pair-request-denied')).toBeVisible();
  await page.getByTestId('pair-request-retry').click();
  const next = await gateCode(page);
  const pending = await pendingRequests(request, server.base);
  expect(pending.some((row) => row.code === next)).toBe(true);
});

test('an expired request shows the retry card', async ({ page }) => {
  await page.route('**/api/remote/pair/request', (route) =>
    route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 'e2e-expired',
        secret: 'e2e-secret',
        code: 'K7QM4XPR',
        expiresAt: Date.now() + 60_000,
      }),
    }),
  );
  await page.route('**/api/remote/pair/claim', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'expired' }),
    }),
  );
  await page.goto(`${server.base}/app`);
  await expect(page.getByTestId('pair-request-code')).toHaveText('K7QM-4XPR');
  await expect(page.getByTestId('pair-request-expired')).toBeVisible();
  await expect(page.getByTestId('pair-request-retry')).toBeVisible();
});

test('the pairing-off note explains the grant fallback only when no request waits', async ({
  browser,
}) => {
  const owner = await browser.newContext({
    extraHTTPHeaders: { authorization: `Bearer ${GATE_TOKEN}` },
  });
  const page = await owner.newPage();
  await page.route('**/api/remote/routes', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        environmentId: 'e2e-env',
        routes: [],
        tailnet: {
          enabled: false,
          state: 'off',
          dnsName: null,
          ips: [],
          authUrl: null,
          error: null,
        },
      }),
    }),
  );
  let requests: unknown[] = [
    {
      id: 'e2e-pending-request',
      code: '5Y9E233D',
      name: 'macOS',
      detail: 'Chrome 153',
      source: 'loopback',
      createdAt: Date.now(),
      expiresAt: Date.now() + 300_000,
    },
  ];
  await page.route('**/api/remote/pairing-requests', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(requests),
    }),
  );
  try {
    await page.goto(`${server.base}/app/settings/remote`);
    await expect(page.getByTestId('pair-request')).toBeVisible();
    await expect(page.getByTestId('pairing-blocked')).toHaveCount(0);

    requests = [];
    await expect(page.getByTestId('pair-request')).toHaveCount(0);
    await expect(page.getByTestId('pairing-blocked')).toBeVisible();
  } finally {
    await owner.close();
  }
});
