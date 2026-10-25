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
