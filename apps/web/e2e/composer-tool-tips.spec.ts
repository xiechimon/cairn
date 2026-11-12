import { expect, type Locator, type Page, test } from '@playwright/test';

const DETAIL = '/app/todo/7ve0iOkQ-JBpSL98zSiGc?scenario=16';
const CHIEF = '/app?scenario=chief-question';

async function expectTip(page: Page, button: Locator, label: string) {
  await button.hover();
  await expect(page.locator('[data-slot="tooltip-content"]')).toHaveText(label);
  await page.mouse.move(0, 0);
  await expect(page.locator('[data-slot="tooltip-content"]')).toHaveCount(0);
}

test('detail composer tools name themselves on hover', async ({ page }) => {
  await page.goto(DETAIL);
  const toolbar = page.getByTestId('composer-toolbar');
  const plus = page.locator('.side-panel [data-testid="composer-plus"]');
  await expectTip(page, plus, '更多');
  await expectTip(page, toolbar.getByRole('button', { name: '发送' }), '发送');
  await plus.click();
  await expect(page.getByRole('menuitem', { name: '添加附件' })).toBeVisible();
});

test('chief composer tools name themselves on hover', async ({ page }) => {
  await page.goto(CHIEF);
  await expectTip(page, page.locator('[data-testid="composer-plus"]:visible'), '更多');
});
