import { expect, test } from '@playwright/test';

const REVIEW = '/app/todo/7ve0iOkQ-JBpSL98zSiGc?scenario=28';

async function readClipboard(page: import('@playwright/test').Page): Promise<string> {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  return page.evaluate(() => navigator.clipboard.readText());
}

test('C1: robot row copy puts the row text on the clipboard', async ({ page }) => {
  await page.goto(REVIEW);
  await readClipboard(page);
  await page.locator('.chat-row--agent .chat-copy').first().click();
  const clip = await readClipboard(page);
  expect(clip.length).toBeGreaterThan(20);
  expect(clip).toContain('README.md');
});

test('C2: plan card copy puts title + preview on the clipboard', async ({ page }) => {
  await page.goto(REVIEW);
  await readClipboard(page);
  await page.locator('.chat-preview + .chat-row-icons .chat-copy').first().click();
  const clip = await readClipboard(page);
  expect(clip.startsWith('方案 · v')).toBe(true);
  expect(clip).toContain('Context: 仓库根目录');
});

test('C3: work block copy puts calls and outputs on the clipboard', async ({ page }) => {
  await page.goto(REVIEW);
  await readClipboard(page);
  await page.getByTestId('work-block').last().getByRole('button', { name: '复制' }).click();
  const clip = await readClipboard(page);
  expect(clip).toContain('README.md');
});

test('C4: no footer chevron on agent rows; the work summary carries the only disclosure', async ({
  page,
}) => {
  await page.goto(REVIEW);
  await expect(page.locator('.chat-preview + .chat-row-icons .chat-foot-chevron')).toHaveCount(0);
  await expect(page.locator('.chat-row--agent .chat-row-icons .chat-foot-chevron')).toHaveCount(0);
  await expect(page.getByTestId('work-summary').last()).toHaveAttribute('aria-expanded', 'true');
});

for (const phone of [false, true]) {
  for (const theme of ['light', 'dark'] as const) {
    test.describe(`completion footer ${phone ? 'phone' : 'desktop'} ${theme}`, () => {
      test.use({ viewport: { width: phone ? 390 : 1440, height: phone ? 844 : 900 }, hasTouch: phone });

      test('completion stays aligned before copy through hover and focus', async ({ page }) => {
        await page.addInitScript((value) => localStorage.setItem('cairn-theme', value), theme);
        await page.goto(REVIEW);
        const row = page.locator('[data-slot="message-scroller-item"]').filter({ has: page.locator('.chat-preview') }).first();
        const label = row.locator('.chat-row-icons > span');
        const copy = row.locator('.chat-copy');
        await label.scrollIntoViewIfNeeded();
        await page.mouse.move(0, 0);
        if (process.env.FOOTER_SCREENSHOT_PHASE) {
          await page.screenshot({ path: `../../docs/verify/2423/${process.env.FOOTER_SCREENSHOT_PHASE}-${phone ? 'phone' : 'desktop'}-${theme}.png` });
        }
        const textBox = await row.locator('.chat-preview').boundingBox();
        const labelBox = await label.boundingBox();
        const copyBox = await copy.boundingBox();
        expect(textBox).not.toBeNull();
        expect(labelBox).not.toBeNull();
        expect(copyBox).not.toBeNull();
        expect.soft(Math.abs(labelBox!.x - textBox!.x)).toBeLessThanOrEqual(1);
        expect.soft(copyBox!.x).toBeGreaterThanOrEqual(labelBox!.x + labelBox!.width);
        await expect.soft(label).toHaveCSS('border-left-width', '0px');
        await expect.soft(label).toHaveCSS('padding-left', '0px');
        await expect(copy).toHaveCSS('opacity', phone ? '1' : '0');
        if (!phone) await row.hover();
        await expect(copy).toHaveCSS('opacity', '1');
        await copy.focus();
        await expect(copy).toBeFocused();
        expect((await label.boundingBox())!.x).toBe(labelBox!.x);
      });
    });
  }
}
