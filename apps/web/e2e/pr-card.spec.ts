import { expect, type Locator, type Page, test } from '@playwright/test';

const THEMES = ['light', 'dark'] as const;

async function openGallery(page: Page, theme: (typeof THEMES)[number]) {
  await page.addInitScript((value) => localStorage.setItem('cairn-theme', value), theme);
  await page.goto('/design.html#pr-card');
  await expect(page.locator('[data-pr-card-grid]')).toBeVisible();
}

const cardOf = (page: Page, label: string): Locator =>
  page.locator(`[data-pr-card-case="${label}"] [data-slot="pr-card"]`);

for (const theme of THEMES) {
  test.describe(`${theme}`, () => {
    test('a stale verdict asks for a re-review and shows both heads', async ({ page }) => {
      await openGallery(page, theme);
      const card = cardOf(page, 'Stale verdict');
      await expect(card).toHaveAttribute('data-stale', '');
      await expect(card.locator('[data-slot="pr-card-state"]')).toHaveText('Needs re-review');
      await expect(card).not.toContainText('Ready to merge');
      await expect(card).toContainText('a1b2c3d');
      await expect(card).toContainText('e4f5a6b');
      await card.getByRole('button', { name: 'Details' }).click();
      await expect(card.getByText('Judged head')).toBeVisible();
      await expect(card.getByText('a1b2c3d → e4f5a6b')).toBeVisible();
    });

    test('a queued PR shows its position and the merged PR drops the queue', async ({ page }) => {
      await openGallery(page, theme);
      await expect(cardOf(page, 'Queued').locator('[data-slot="pr-card-state"]')).toHaveText(
        'Queue position 2',
      );
      const merged = cardOf(page, 'Merged');
      await expect(merged.locator('[data-slot="pr-card-state"]')).toHaveText('Merged');
      await expect(merged).not.toContainText('queue');
      await expect(merged.getByRole('button', { name: 'Resolve' })).toHaveCount(0);
    });

    test('Resolve shows only for conflicts, failed checks and a blocking review', async ({
      page,
    }) => {
      await openGallery(page, theme);
      const withResolve = ['Conflicts', 'Checks failed', 'Review BLOCK'];
      const grid = page.locator('[data-pr-card-case]');
      const total = await grid.count();
      for (let i = 0; i < total; i += 1) {
        const label = (await grid.nth(i).getAttribute('data-pr-card-case')) ?? '';
        await expect(
          cardOf(page, label).getByRole('button', { name: 'Resolve' }),
          label,
        ).toHaveCount(withResolve.includes(label) ? 1 : 0);
      }
    });
  });
}

test('the card keeps inside a 420px column', async ({ page }) => {
  await page.setViewportSize({ width: 420, height: 900 });
  await openGallery(page, 'light');
  const cards = page.locator('[data-slot="pr-card"]');
  const total = await cards.count();
  expect(total).toBeGreaterThanOrEqual(10);
  for (let i = 0; i < total; i += 1) {
    const card = cards.nth(i);
    await card.getByRole('button', { name: 'Details' }).click();
    const overflow = await card.evaluate((el) => ({
      card: el.scrollWidth - el.clientWidth,
      page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }));
    expect(overflow.card).toBeLessThanOrEqual(0);
    expect(overflow.page).toBeLessThanOrEqual(0);
  }
});
