import { expect, type Page, test } from '@playwright/test';

const ROUTE = '/app/todo/7ve0iOkQ-JBpSL98zSiGc?scenario=md-toolout';
const summary = (page: Page) => page.getByTestId('work-summary');
const block = (page: Page) => page.getByTestId('work-block');

async function readClipboard(page: Page): Promise<string> {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  return page.evaluate(() => navigator.clipboard.readText());
}

test('I1: the summary names the work performed and its duration', async ({ page }) => {
  await page.goto(ROUTE);
  await expect(summary(page)).toContainText('跑了 2 条命令');
  await expect(summary(page)).toContainText('19s');
  await expect(summary(page).locator('svg').first()).toBeVisible();
});

test('I2: copy is available only while the work block is expanded', async ({ page }) => {
  await page.goto(ROUTE);
  await expect(summary(page)).toHaveAttribute('aria-expanded', 'true');
  await expect(block(page).getByRole('button', { name: '复制', exact: true })).toHaveCount(1);
  await summary(page).click();
  await expect(page.getByTestId('work-call')).toHaveCount(0);
  await expect(block(page).getByRole('button', { name: '复制', exact: true })).toHaveCount(0);
  await summary(page).click();
  await expect(page.getByTestId('work-call')).toHaveCount(2);
});

test('I3: copying work includes commands and outputs', async ({ page }) => {
  await page.goto(ROUTE);
  await readClipboard(page);
  await block(page).getByRole('button', { name: '复制', exact: true }).click();
  const clip = await readClipboard(page);
  expect(clip).toContain('ls -la');
  expect(clip).toContain('total 16');
  expect(clip).toContain('hello from cairn');
});

test('I4: call rows keep the agent column inset and compact height', async ({ page }) => {
  await page.goto(ROUTE);
  const geometry = await block(page).evaluate((el) => {
    const row = el.querySelector('[data-testid="work-call"]')!;
    return { inset: getComputedStyle(el).paddingLeft, height: row.getBoundingClientRect().height };
  });
  expect(geometry.inset).toBe('32px');
  expect(geometry.height).toBeGreaterThanOrEqual(26);
  expect(geometry.height).toBeLessThanOrEqual(28);
});

test('I5: work summaries keep the transcript boundary free of horizontal rules', async ({ page }) => {
  await page.goto(ROUTE);
  const borders = await summary(page).evaluate((el) => {
    const style = getComputedStyle(el);
    return [style.borderTopWidth, style.borderBottomWidth];
  });
  expect(borders).toEqual(['0px', '0px']);
});
