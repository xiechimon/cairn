import { expect, test } from '@playwright/test';

const ROUTE = '/app/todo/7ve0iOkQ-JBpSL98zSiGc?scenario=skill-inject';
const ROUTE_ZERO = '/app/todo/7ve0iOkQ-JBpSL98zSiGc?scenario=skill-inject-zero';

const ROUTE_NO_SKILLS = '/app/todo/7ve0iOkQ-JBpSL98zSiGc?scenario=27';

test('the injected-skills row names each skill with its hit reason', async ({ page }) => {
  await page.goto(ROUTE);
  const row = page.getByTestId('injected-skills');
  await expect(row).toBeVisible();
  await expect(row).toContainText('注入技能：');
  await expect(row).toContainText('better-typography');
  await expect(row).toContainText('同域「前端界面」');
  await expect(row).toContainText('tdd');
  await expect(row).toContainText('显式点名');
});

test('a computed zero-hit run shows the no-skills placeholder, not absence', async ({ page }) => {
  await page.goto(ROUTE_ZERO);
  const row = page.getByTestId('injected-skills');
  await expect(row).toBeVisible();
  await expect(row).toContainText('未注入技能');
});

test('a run without an injection record grows no row (control zero-noise)', async ({ page }) => {
  await page.goto(ROUTE_NO_SKILLS);
  await expect(page.getByTestId('injected-skills')).toHaveCount(0);
});
