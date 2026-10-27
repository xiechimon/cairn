import { expect, type Page, test } from '@playwright/test';

test('avatar landing: sidebar portrait goes to the components/ui landing', async ({ page }) => {
  await page.goto('/app?scenario=22d&view=board');
  const faces = [page.locator('.sidebar-user')];
  for (const face of faces) {
    await expect(face.locator('[data-slot="avatar"]')).toHaveCount(1);
    await expect(face.locator('[data-slot="avatar-image"]')).toHaveCount(1);

    await expect(face.locator('[data-slot="avatar-fallback"]')).toHaveCount(0);
  }

  await page.evaluate(() => localStorage.setItem('cairn.sidebar-collapsed', '1'));
  await page.reload();
  await expect(page.locator('.rail-user [data-slot="avatar-image"]')).toHaveCount(1);
});

test('avatar landing fixed-size box (#983/#1003): Root renders a real box carrying the upstream hairline ring, img geometry unchanged', async ({
  page,
}) => {
  await page.goto('/app?scenario=22d&view=board');
  const probe = await page.evaluate(() => {
    const root = document.querySelector('.sidebar-user [data-slot="avatar"]')!;
    const img = document.querySelector('.sidebar-user [data-slot="avatar-image"]')!;
    const chip = document.querySelector('.sidebar-user')!;
    const box = (el: Element) => {
      const r = el.getBoundingClientRect();
      return { w: r.width, h: r.height };
    };
    return {
      display: getComputedStyle(root).display,
      rootBox: box(root),
      imgBox: box(img),
      chipBox: box(chip),
    };
  });

  expect(probe.display).not.toBe('contents');

  expect(probe.rootBox.w).toBe(24);
  expect(probe.rootBox.h).toBe(24);
  expect(probe.imgBox.w).toBe(24);
  expect(probe.imgBox.h).toBe(24);

  expect(probe.chipBox.h).toBe(52);
});

test('kbd landing: floating hint = registry Tooltip+Kbd combo, not mounted at rest / floats on hover', async ({ page }) => {
  await page.goto('/app?scenario=01&view=board');

  const fab = page.getByRole('button', { name: '总管', exact: true });
  const hint = page.locator('[data-slot="tooltip-content"] [data-slot="kbd"]');
  await expect(hint).toHaveCount(0);
  await fab.hover();
  await expect(hint).toBeVisible();
  await expect(hint).toHaveAttribute('data-slot', 'kbd');
  await expect(hint).toHaveText('⌘J');
});

test('tag-chip landing: lands on the registry Badge, single 20px tier canon', async ({ page }) => {
  await page.goto('/app?scenario=board-tags&view=board');
  await expect(page.locator('.todo-card-tag')).toHaveCount(0);
  await page.locator('.board-type-filter').click();
  const option = page.locator('.type-filter-option[data-tag="bug"]');
  await option.click();
  const picked = option.locator('.tag-chip');
  await expect(picked).toBeVisible();
  await expect(picked).toHaveAttribute('data-slot', 'badge');
  const ph = await picked.evaluate((el) => el.getBoundingClientRect().height);
  expect(ph).toBeCloseTo(20, 2);
});