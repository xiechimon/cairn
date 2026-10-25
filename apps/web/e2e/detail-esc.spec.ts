import { expect, test } from '@playwright/test';

const DETAIL = '/app/todo/7ve0iOkQ-JBpSL98zSiGc?scenario=27';
const BOARD = /\/app\?scenario=27$/;

const head = (page: import('@playwright/test').Page) => page.getByTestId('detail-head');
const chip = (page: import('@playwright/test').Page) =>
  head(page).locator('button[aria-expanded]');

const popover = (page: import('@playwright/test').Page) =>
  page.getByRole('dialog', { name: '任务分配' });
const confirmDialog = (page: import('@playwright/test').Page) => page.locator('.delete-confirm');

test('E1: clean ESC leaves the detail, carrying the search home', async ({ page }) => {
  await page.goto(DETAIL);
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(BOARD);
});

test('E2: ESC with the chip popover open closes the popover first', async ({ page }) => {
  await page.goto(DETAIL);
  await chip(page).click();
  await expect(popover(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(popover(page)).toBeHidden();
  await expect(page).toHaveURL(/\/todo\//);
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(BOARD);
});

test('E3: ESC with a modal overlay open closes the overlay first', async ({ page }) => {
  await page.goto(DETAIL);
  await page.getByRole('button', { name: '更多' }).click();
  await page.locator('.more-menu-item[data-action="delete"]').click();
  await expect(confirmDialog(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(confirmDialog(page)).toBeHidden();
  await expect(page).toHaveURL(/\/todo\//);
});
