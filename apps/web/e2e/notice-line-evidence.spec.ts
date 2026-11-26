import { expect, test } from '@playwright/test';

const SHOTS = process.env.CAIRN_NOTICE_SHOTS;

test.describe.configure({ mode: 'serial' });

for (const theme of ['light', 'dark'] as const) {
  test(`${theme}: shared notice lines and message bodies`, async ({ page }, testInfo) => {
    const dir = SHOTS ?? testInfo.outputPath();
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    await page.addInitScript(
      ([key, value]) => localStorage.setItem(key, value),
      ['cairn-theme', theme],
    );

    await page.goto('/app?scenario=chief-md-ref');
    await expect(page.getByTestId('chief-bubble').first()).toBeVisible();
    await expect(page.getByTestId('chief-reply').first()).toBeVisible();
    const python = page.getByTestId('md-code').filter({ hasText: 'from collections' }).first();
    await expect(python.locator('span[style]').filter({ hasText: 'from' }).first()).toBeVisible();
    await expect(python.locator('span[style]').filter({ hasText: 'import' }).first()).toBeVisible();
    await page.screenshot({ path: `${dir}/chief-messages-${theme}.png`, fullPage: true });

    await page.goto('/app/todo/home-c-retry-waiting?scenario=home-c-retry');
    await expect(page.getByTestId('transcript-fail')).toBeVisible();
    await page.screenshot({ path: `${dir}/task-retry-notice-${theme}.png`, fullPage: true });

    await page.goto('/app/todo/home-c-quota-wait?scenario=home-c-retry');
    await expect(page.getByTestId('transcript-quota-wait')).toBeVisible();
    await page.screenshot({ path: `${dir}/task-quota-notice-${theme}.png`, fullPage: true });

    await page.goto('/app?scenario=quota-wait');
    await expect(page.locator('[data-quota-banner]')).toBeVisible();
    await page.screenshot({ path: `${dir}/board-quota-notice-${theme}.png`, fullPage: true });
  });
}
