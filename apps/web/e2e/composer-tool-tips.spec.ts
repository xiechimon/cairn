import { expect, type Locator, type Page, test } from '@playwright/test';

const DETAIL = '/app/todo/7ve0iOkQ-JBpSL98zSiGc?scenario=16';
const CHIEF = '/app?view=board&scenario=chief-question';

async function expectTip(page: Page, button: Locator, label: string) {
  await button.hover();
  await expect(page.locator('[data-slot="tooltip-content"]')).toHaveText(label);
  await page.mouse.move(0, 0);
  await expect(page.locator('[data-slot="tooltip-content"]')).toHaveCount(0);
}

test('detail composer tools name themselves on hover', async ({ page }) => {
  await page.goto(DETAIL);
  const toolbar = page.getByTestId('composer-toolbar');
  for (const label of ['添加附件', '提及']) {
    await expectTip(page, toolbar.getByRole('button', { name: label }), label);
  }
});

test('chief composer tools name themselves on hover', async ({ page }) => {
  await page.goto(CHIEF);
  const chief = page.locator('.chief-drawer');
  await expect(chief).toBeVisible();
  await expectTip(page, chief.getByRole('button', { name: '提及' }), '提及');
});

test('light: chief composer is the same white field as the workbench new-task bar', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto(CHIEF);
  const bar = await page
    .getByTestId('board-new-task-bar')
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  const composer = await page
    .locator('.chief-composer')
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(composer).toBe(bar);
});
