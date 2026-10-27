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
