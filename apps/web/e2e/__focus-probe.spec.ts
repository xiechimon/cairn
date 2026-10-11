import { expect, type Page, test } from '@playwright/test';

const drawer = (page: Page) => page.locator('.chief-drawer');

test('probe: does chief-body carry data-pending-scroll at the reopen frame', async ({ page }) => {
  await page.goto('/app?scenario=01');
  await expect(page.getByRole('complementary')).toBeVisible();
  await page.keyboard.press('Meta+j');
  await expect(drawer(page)).toBeVisible();
  await page.keyboard.press('Meta+j');
  await expect(drawer(page)).toBeHidden();
  const cap = await page.evaluate(async () => {
    const w = window as any;
    w.__frames = [];
    const d = document.querySelector('.chief-drawer')!;
    const mo = new MutationObserver(() => {
      if (d.hasAttribute('data-open')) {
        mo.disconnect();
        let n = 0;
        const snap = () => {
          const b = document.querySelector('[data-testid="chief-body"]');
          w.__frames.push({
            n,
            pending: b?.hasAttribute('data-pending-scroll') ?? null,
            vis: b ? getComputedStyle(b).visibility : null,
          });
          n += 1;
          if (n < 12) requestAnimationFrame(snap);
        };
        requestAnimationFrame(snap);
      }
    });
    mo.observe(d, { attributes: true });
  });
  await page.keyboard.press('Meta+j');
  await expect(drawer(page)).toBeVisible();
  await page.waitForTimeout(600);
  const out = await page.evaluate(() => (window as any).__frames);
  console.log(JSON.stringify(out, null, 1));
});
