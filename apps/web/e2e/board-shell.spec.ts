import { expect, test } from '@playwright/test';

test('a project filter keeps home and marks the project; an unknown project shows the not-found page', async ({
  page,
}) => {
  const workbench = page
    .getByRole('complementary')
    .locator('[data-slot="sidebar-nav-row"]', { hasText: 'Coordinator' });
  await page.goto('/app?scenario=home-c&project=ZAQczKCu0MOAzC1ZqcFlX');
  await expect(page.getByTestId('project-home')).toBeVisible();
  await expect(workbench).not.toHaveAttribute('aria-current', 'page');
  await expect(
    page.locator('[data-slot="sidebar-project-row"][aria-current="page"]'),
  ).toContainText('cairn');

  await page.goto('/app?scenario=home-c&project=no-such-project');
  await expect(page.getByTestId('project-not-found')).toBeVisible();
  await expect(page.getByTestId('home-c')).toHaveCount(0);
  await expect(workbench).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('[data-slot="sidebar-project-row"][aria-current="page"]')).toHaveCount(0);
});

for (const viewport of [{ width: 1440, height: 732 }, { width: 390, height: 844 }]) {
  for (const theme of ['light', 'dark']) {
    test(`the composer block sits 16px above the sheet bottom on home and detail (home 20px above the phone tab bar, the phone task view covers it) at ${viewport.width}px in ${theme}`, async ({ page }, testInfo) => {
      await page.setViewportSize(viewport);
      await page.addInitScript((value) => localStorage.setItem('cairn-theme', value), theme);
      const gaps: number[] = [];
      for (const route of [
        { name: 'home', url: '/app?scenario=board-inbox', selector: '[data-testid="home-c"] .chief-composer' },
        { name: 'detail', url: '/app/todo/7ve0iOkQ-JBpSL98zSiGc?scenario=17b', selector: '[data-testid="composer-card"]' },
      ]) {
        await page.goto(route.url);
        const composer = page.locator(route.selector);
        await expect(composer).toBeVisible();
        await page.evaluate(() => document.fonts.ready);
        const gap = await composer.evaluate((element) => {
          const sheet = element.closest('.board-sheet, .group\\/detail-main');
          const tabs = element.closest('.side-panel') ? null : sheet?.querySelector('[data-slot="phone-tabs"]');
          const floor = tabs
            ? tabs.getBoundingClientRect().top
            : sheet
              ? sheet.getBoundingClientRect().bottom - Number.parseFloat(getComputedStyle(sheet).borderBottomWidth)
              : window.innerHeight;
          const block = element.parentElement ?? element;
          return floor - block.getBoundingClientRect().bottom;
        });
        gaps.push(gap);
        console.log(`${viewport.width}px ${theme} ${route.name}: ${gap}px`);
        const screenshot = testInfo.outputPath(`${route.name}-${viewport.width}-${theme}.png`);
        await page.screenshot({ path: screenshot });
        await testInfo.attach(route.name, { path: screenshot, contentType: 'image/png' });
      }
      const phone = viewport.width <= 640;
      expect.soft(gaps[0]).toBeCloseTo(phone ? 20 : 16, 0);
      expect.soft(gaps[1]).toBeCloseTo(16, 0);
    });
  }
}
