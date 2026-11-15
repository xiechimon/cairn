import { expect, type Page, test } from '@playwright/test';
import { stubLiveApiKeys } from './helpers.js';

const light = async (page: Page, url: string) => {
  await page.addInitScript(() => localStorage.setItem('cairn-theme', 'light'));
  await page.goto(url);
};

for (const [name, url] of [
  ['secrets', '/app/resources/secrets?scenario=01'],
  ['api-keys', '/app/api-keys'],
] as const) {
  test(`${name} empty state: bare ink-3 icon, no tile`, async ({ page }) => {
    if (name === 'api-keys') await stubLiveApiKeys(page);
    await light(page, url);
    const empty = page.locator('.empty-state');
    await expect(empty).toBeVisible();
    const face = await empty.evaluate((el) => {
      const svg = el.querySelector('svg');
      const media = svg?.parentElement;
      return {
        mediaBg: media ? getComputedStyle(media).backgroundColor : null,
        iconSize: svg?.getBoundingClientRect().width ?? null,
      };
    });
    expect(face.mediaBg).toBe('rgba(0, 0, 0, 0)');
    expect(face.iconSize).toBe(32);
  });
}

for (const [name, url] of [['api-keys', '/app/api-keys?scenario=api-keys-created']] as const) {
  test(`${name} list: one settings card of 52px rows, 14px corner`, async ({ page }) => {
    await light(page, url);
    const cards = page.locator('[data-testid="page-col"] .settings-card');
    await expect(cards).toHaveCount(1);
    await expect(cards).toHaveCSS('border-top-left-radius', '12px');
    const heights = await cards.evaluate((el) =>
      [...el.children].map((row) => row.getBoundingClientRect().height),
    );
    expect(heights).toEqual([52]);
  });
}

const NEW_SCHEDULE = '/app?scenario=home-c&pane=tasks&tab=scheduled';

test('`新建定时` hour and minute selects sit side by side', async ({ page }) => {
  await light(page, NEW_SCHEDULE);
  await page.getByTestId('schedule-new').click();
  const popover = page.getByTestId('schedule-popover');
  await expect(popover).toContainText('新建定时');
  await popover.evaluate((el) =>
    Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)),
  );
  const [hour, minute] = await Promise.all([
    popover.getByRole('combobox', { name: '时' }).boundingBox(),
    popover.getByRole('combobox', { name: '分' }).boundingBox(),
  ]);
  expect(minute!.x - (hour!.x + hour!.width)).toBeLessThanOrEqual(12);
  expect(minute!.y).toBe(hour!.y);
});

test('new schedule editor: a pointer open shows no focus ring, a keyboard open moves a ringed focus inside', async ({
  page,
}) => {
  await light(page, NEW_SCHEDULE);
  const open = page.getByTestId('schedule-new');
  const popover = page.getByTestId('schedule-popover');
  const ringed = () =>
    page.evaluate(() => document.activeElement?.matches(':focus-visible') ?? false);

  await open.click();
  await expect(popover).toBeVisible();
  await expect(popover.getByText('频率', { exact: true })).toBeVisible();
  await expect.poll(ringed).toBe(false);

  await page.keyboard.press('Escape');
  await expect(popover).toBeHidden();
  await open.focus();
  await page.keyboard.press('Enter');
  await expect(popover).toBeVisible();
  await expect
    .poll(() => popover.evaluate((el) => el.contains(document.activeElement)))
    .toBe(true);
  await expect.poll(ringed).toBe(true);
});
