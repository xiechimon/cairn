import { expect, type Page, test } from '@playwright/test';

const ROUTE = '/app/todo/7ve0iOkQ-JBpSL98zSiGc?scenario=md-toolout';
const summary = (page: Page) => page.getByTestId('work-summary');
const block = (page: Page) => page.getByTestId('work-block');

async function readClipboard(page: Page): Promise<string> {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  return page.evaluate(() => navigator.clipboard.readText());
}

test('I1: the summary names the work performed and ends in a triangle', async ({ page }) => {
  await page.goto(ROUTE);
  await expect(summary(page)).toContainText('跑了 2 条命令');
  await expect(summary(page)).not.toContainText('19s');
  await expect(summary(page).locator('svg').first()).toBeVisible();
});

test('I2: work activity has no copy action in either disclosure state', async ({ page }) => {
  await page.goto(ROUTE);
  await expect(summary(page)).toHaveAttribute('aria-expanded', 'true');
  await expect(block(page).getByRole('button', { name: '复制', exact: true })).toHaveCount(0);
  await summary(page).click();
  await expect(page.getByTestId('work-call')).toHaveCount(0);
  await expect(block(page).getByRole('button', { name: '复制', exact: true })).toHaveCount(0);
  await summary(page).click();
  await expect(page.getByTestId('work-call')).toHaveCount(2);
});

test('I3: assistant message copy stays available', async ({ page }) => {
  await page.goto(ROUTE);
  await readClipboard(page);
  const reply = page.locator('[data-row="agent"]').filter({ has: page.locator('.chat-copy') }).first();
  const heading = await reply.locator('h2').innerText();
  await reply.hover();
  await reply.getByTestId('msg-actions').getByRole('button', { name: '复制', exact: true }).click();
  const clipboard = await readClipboard(page);
  expect(clipboard).toContain(`## ${heading}`);
  expect(clipboard).toContain('`ls -la`');
  expect(clipboard).toContain('total 16');
});

test('I4: call rows sit flush in a hairline card at 36px', async ({ page }) => {
  await page.goto(ROUTE);
  const geometry = await block(page).evaluate((el) => {
    const row = el.querySelector('[data-testid="work-call"]')!;
    return { inset: getComputedStyle(el).paddingLeft, height: row.getBoundingClientRect().height };
  });
  expect(geometry.inset).toBe('0px');
  expect(geometry.height).toBe(36);
});

test('I5: work summaries keep the transcript boundary free of horizontal rules', async ({ page }) => {
  await page.goto(ROUTE);
  const borders = await summary(page).evaluate((el) => {
    const style = getComputedStyle(el);
    return [style.borderTopWidth, style.borderBottomWidth];
  });
  expect(borders).toEqual(['0px', '0px']);
});
