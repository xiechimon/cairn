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
