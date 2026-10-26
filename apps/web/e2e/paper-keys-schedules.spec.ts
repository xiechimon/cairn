import { expect, type Page, test } from '@playwright/test';

const light = async (page: Page, url: string) => {
  await page.addInitScript(() => localStorage.setItem('cairn-theme', 'light'));
  await page.goto(url);
};

for (const [name, url] of [
  ['schedules', '/app/schedules?scenario=11'],
  ['api-keys', '/app/api-keys'],
] as const) {
  test(`${name} empty state: bare ink-3 icon, no tile`, async ({ page }) => {
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
    expect(face.iconSize).toBe(24);
  });
}

for (const [name, url] of [
  ['schedules', '/app/schedules?scenario=r3-93'],
  ['api-keys', '/app/api-keys?scenario=api-keys-created'],
] as const) {
  test(`${name} list: one settings card of 52px rows, 20px corner`, async ({ page }) => {
    await light(page, url);
    const cards = page.locator('[data-testid="page-col"] .settings-card');
    await expect(cards).toHaveCount(1);
    await expect(cards).toHaveCSS('border-top-left-radius', '20px');
    const heights = await cards.evaluate((el) =>
      [...el.children].map((row) => row.getBoundingClientRect().height),
    );
    expect(heights).toEqual([52]);
  });
}

test('`新建定时` footer: text `取消` left of a 32px primary `保存`, no outline button', async ({
  page,
}) => {
  await light(page, '/app/schedules?scenario=r3-92');
  const foot = page.getByRole('dialog', { name: '新建定时' }).getByTestId('dialog-foot');
  const cancel = foot.getByRole('button', { name: '取消' });
  const save = foot.getByRole('button', { name: '保存' });
  await expect(save).toHaveCSS('height', '32px');
  await expect(cancel).toHaveAttribute('data-variant', 'ghost');
  const [c, s] = await Promise.all([cancel.boundingBox(), save.boundingBox()]);
  expect(c!.x + c!.width).toBeLessThanOrEqual(s!.x);
});

test('`新建定时` hour and minute selects sit side by side', async ({ page }) => {
  await light(page, '/app/schedules?scenario=r3-92');
  const dialog = page.getByRole('dialog', { name: '新建定时' });
  const [hour, minute] = await Promise.all([
    dialog.getByRole('combobox', { name: '时' }).boundingBox(),
    dialog.getByRole('combobox', { name: '分' }).boundingBox(),
  ]);
  expect(minute!.x - (hour!.x + hour!.width)).toBeLessThanOrEqual(12);
  expect(minute!.y).toBe(hour!.y);
});

test('new schedule form: a pointer open shows no focus ring, a keyboard open lands on the frequency radio', async ({
  page,
}) => {
  await light(page, '/app/schedules?scenario=01');
  const open = page.locator('.sched-empty').getByRole('button', { name: '新建定时' });
  const dialog = page.getByRole('dialog', { name: '新建定时' });
  const ringed = () =>
    page.evaluate(() => document.activeElement?.matches(':focus-visible') ?? false);

  await open.click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('频率', { exact: true })).toBeVisible();
  await expect.poll(ringed).toBe(false);

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await open.focus();
  await page.keyboard.press('Enter');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('radio', { checked: true })).toBeFocused();
  await expect.poll(ringed).toBe(true);
});
