import { expect, type Locator, type Page, test } from '@playwright/test';

const CHIEF_ROUTE = '/app?scenario=code-highlight';
const TASK_ROUTE = '/app/todo/7ve0iOkQ-JBpSL98zSiGc?scenario=code-highlight';

async function expectHighlightedPython(scope: Locator) {
  const code = scope.getByTestId('md-code').first();
  await expect(code).toBeVisible();
  await expect(code.locator('span[style]').filter({ hasText: 'from' }).first()).toBeVisible();
  await expect(code.locator('span[style]').filter({ hasText: 'import' }).first()).toBeVisible();
}

async function expectChiefRoles(page: Page) {
  await page.goto(CHIEF_ROUTE);
  await expectHighlightedPython(page.getByTestId('chief-bubble').first());
  await expectHighlightedPython(page.getByTestId('chief-reply').first());
}

async function expectTaskRoles(page: Page) {
  await page.goto(TASK_ROUTE);
  await expectHighlightedPython(page.getByTestId('user-bubble').first());
  await expectHighlightedPython(page.getByTestId('agent-text').first());
}

test('C31: Coordinator user and assistant code fences render highlight token nodes', async ({
  page,
}) => {
  await expectChiefRoles(page);
});

test('C31: task user and assistant code fences render highlight token nodes', async ({ page }) => {
  await expectTaskRoles(page);
});
