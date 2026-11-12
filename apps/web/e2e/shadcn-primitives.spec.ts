import { expect, type Page, test } from '@playwright/test';

test('avatar landing: the account portrait goes to the components/ui landing', async ({ page }) => {
  await page.goto('/app/account?scenario=22d');
  await expect(page.locator('.account-avatar [data-slot="avatar-initial"]')).toHaveCount(1);
});

test('avatar landing fixed-size box (#983/#1003): Root renders a real box carrying the upstream hairline ring, the initial fills it', async ({
  page,
}) => {
  await page.goto('/app/account?scenario=22d');
  await expect(page.locator('.account-avatar [data-slot="avatar-initial"]')).toBeVisible();
  const probe = await page.evaluate(() => {
    const root = document.querySelector('.account-avatar [data-slot="avatar"]')!;
    const face = document.querySelector('.account-avatar [data-slot="avatar-initial"]')!;
    const box = (el: Element) => {
      const r = el.getBoundingClientRect();
      return { w: r.width, h: r.height };
    };
    return { display: getComputedStyle(root).display, rootBox: box(root), faceBox: box(face) };
  });
  expect(probe.display).not.toBe('contents');
  expect(probe.rootBox.w).toBeGreaterThan(0);
  expect(probe.faceBox).toEqual(probe.rootBox);
});

test('kbd landing: floating hint = registry Tooltip+Kbd combo, not mounted at rest / floats on hover', async ({ page }) => {
  await page.goto('/app/schedules?scenario=01');

  const search = page.locator('.board-sidebar').getByRole('button', { name: '搜索', exact: true });
  const hint = page.locator('[data-slot="tooltip-content"] [data-slot="kbd"]');
  await expect(hint).toHaveCount(0);
  await search.hover();
  await expect(hint).toBeVisible();
  await expect(hint).toHaveAttribute('data-slot', 'kbd');
  await expect(hint).toHaveText('⌘K');
});
