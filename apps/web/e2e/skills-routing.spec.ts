import { expect, test } from '@playwright/test';

const ROUTE = '/app/todo/7ve0iOkQ-JBpSL98zSiGc?scenario=skills-routing';

const ROUTE_NO_SKILLS = '/app/todo/7ve0iOkQ-JBpSL98zSiGc?scenario=27';

test('the durable summary row names reads and denials in two columns', async ({ page }) => {
  await page.goto(ROUTE);
  const summary = page.getByTestId('skills-summary');
  await expect(summary).toBeVisible();
  await expect(summary).toContainText('技能：haiku-helper');
  await expect(summary).toContainText('挡下：secret-local');
});

test('a run without skill events grows no summary row (control zero-noise)', async ({
  page,
}) => {
  await page.goto(ROUTE_NO_SKILLS);
  await expect(page.getByTestId('skills-summary')).toHaveCount(0);
});
