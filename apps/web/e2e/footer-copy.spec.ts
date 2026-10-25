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

test('C3: tools row copy puts pills and outputs on the clipboard', async ({ page }) => {
  await page.goto(REVIEW);
  await readClipboard(page);
  await page.locator('.chat-row-icons:has(.chat-row-icons--toggle) > .chat-copy').click();
  const clip = await readClipboard(page);
  expect(clip).toContain('edit README.md');
});

test('C4: chevron renders only where it expands the tool group', async ({ page }) => {
  await page.goto(REVIEW);
  await expect(page.locator('.chat-preview + .chat-row-icons .chat-foot-chevron')).toHaveCount(0);
  await expect(page.locator('.chat-row--agent .chat-row-icons .chat-foot-chevron')).toHaveCount(0);
  await expect(page.locator('button.chat-row-icons--toggle .chat-foot-chevron')).toHaveCount(1);
});
