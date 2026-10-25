import { expect, type Page, test } from '@playwright/test';

type SentinelWindow = Window & { __spaSentinel?: string };

async function expectBackIsSpaNavigation(
  page: Page,
  route: string,
  backTo: string,
  landedMarker: string,
) {
  await page.goto(route);

  let documentRequests = 0;
  page.on('request', (request) => {
    if (request.resourceType() === 'document') documentRequests += 1;
  });
  const sentinel = await page.evaluate(() => {
    const w = window as SentinelWindow;
    w.__spaSentinel = crypto.randomUUID();
    return w.__spaSentinel;
  });
  await page.locator('[aria-label="返回"]').click();

  await expect(page).toHaveURL(backTo);
  await expect(page.locator(landedMarker)).toBeVisible();

  expect
    .soft(await page.evaluate(() => (window as SentinelWindow).__spaSentinel))
    .toBe(sentinel);
  expect.soft(documentRequests).toBe(0);
}

test('agent detail back is an in-SPA navigation, not a document reload', async ({ page }) => {
  await expectBackIsSpaNavigation(
    page,
    '/app/resources/agents/r3-builder?scenario=agent-detail',
    '/app/team',
    '[data-route="team"]',
  );
});

// Paper page shell (PR 6): sidebar destinations (skills) carry no back arrow
// any more; the second detail face is machine detail → the machines list.
test('machine detail back is an in-SPA navigation, not a document reload', async ({ page }) => {
  await expectBackIsSpaNavigation(
    page,
    '/app/resources/machines/Kd8fG2hJ4mN9pQ1rStUvWx3?scenario=06',
    '/app/resources/machines',
    '[data-route="/app/resources/machines"] h1:text-is("机器")',
  );
});
