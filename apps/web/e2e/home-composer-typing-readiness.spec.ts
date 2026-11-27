import { expect, type Page, test } from '@playwright/test';
import { composerInput, expectTypedInFull, PAGES } from './audit-pages.js';

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});

const HOME = '/app?scenario=01&pane=tasks&tab=scheduled';

const openHome = async (page: Page) => {
  await page.goto(HOME);
  await page.getByTestId('sidebar-reopen').click();
  await page.mouse.move(700, 400);
  await page
    .getByRole('complementary')
    .locator('[data-slot="sidebar-nav-row"]', { hasText: 'Coordinator' })
    .click();
};

const throttle = async (page: Page, rate: number) => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate });
  return () => cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
};

test('the composer capture types into a focused field and keeps the whole word', async ({
  page,
}) => {
  const capture = PAGES.find((entry) => entry.name === 'new task home composer filled');
  if (capture === undefined) throw new Error('the composer capture page is missing');

  await page.goto(capture.url);
  await capture.open?.(page);

  await expect(composerInput(page)).toBeFocused();
  await expect(composerInput(page)).toHaveValue('probe');
});

test('typing as soon as the home appears keeps every character under CPU throttling', async ({
  page,
}) => {
  const restore = await throttle(page, 20);
  await openHome(page);
  await expect(composerInput(page)).toBeVisible();

  await page.keyboard.type('probe');

  await expect(composerInput(page)).toBeFocused();
  await expect(composerInput(page)).toHaveValue('probe');
  await restore();
});

test('a field that lost characters fails the capture instead of becoming a comparison image', async ({
  page,
}) => {
  await page.route('**/assets/*.js', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 3_000));
    await route.continue();
  });
  await page.goto(HOME, { waitUntil: 'commit' });
  await page.keyboard.type('probe');
  await expect(composerInput(page)).toBeVisible({ timeout: 30_000 });

  const rejected = await expectTypedInFull(composerInput(page), 'probe').then(
    () => {
      throw new Error('the capture accepted a composer holding less than the typed word');
    },
    (error: Error) => error,
  );

  expect(rejected.message).toContain('probe');
  expect(await composerInput(page).inputValue()).not.toBe('probe');
});
