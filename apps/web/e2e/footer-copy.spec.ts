import { expect, test } from '@playwright/test';
import { copyFromRowTools } from './helpers.js';

const REVIEW = '/app/todo/7ve0iOkQ-JBpSL98zSiGc?scenario=28';
const DONE = '/app/todo/7ve0iOkQ-JBpSL98zSiGc?scenario=36';

async function readClipboard(page: import('@playwright/test').Page): Promise<string> {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  return page.evaluate(() => navigator.clipboard.readText());
}

test('C1: robot row copy puts the row text on the clipboard', async ({ page }) => {
  await page.goto(REVIEW);
  await readClipboard(page);
  await copyFromRowTools(page, page.locator('.chat-row--agent [data-slot="reply-block"]').first());
  const clip = await readClipboard(page);
  expect(clip.length).toBeGreaterThan(20);
  expect(clip).toContain('README.md');
});

test('C3: work blocks have no copy action while assistant copy remains', async ({ page }) => {
  await page.goto(REVIEW);
  await expect(page.getByTestId('work-block').last().getByRole('button', { name: '复制' })).toHaveCount(0);
  await expect(page.locator('.chat-row--agent [data-testid="msg-tools"]').first()).toBeAttached();
});

test('C4: no footer chevron on agent rows; the work summary carries the only disclosure', async ({
  page,
}) => {
  await page.goto(REVIEW);
  await expect(page.locator('.chat-row--agent .chat-row-icons .chat-foot-chevron')).toHaveCount(0);
  await expect(page.getByTestId('work-summary').last()).toHaveAttribute('aria-expanded', 'true');
});

test('C5: a finished reply carries no completion footer and copies from its row tools', async ({ page }) => {
  await page.goto(DONE);
  await readClipboard(page);
  const reply = page.locator('.chat-row--agent [data-slot="reply-block"]').last();
  await expect(reply).toBeVisible();
  await expect(page.locator('.chat-row--agent .chat-row-icons')).toHaveCount(0);
  await expect(page.getByTestId('worked-for-rule')).toHaveCount(0);
  await copyFromRowTools(page, reply);
  expect((await readClipboard(page)).length).toBeGreaterThan(0);
});
