import { expect, test } from '@playwright/test';

const ROUTE = '/app/todo/7ve0iOkQ-JBpSL98zSiGc?scenario=verify-verdict';


const verifyRow = (page: import('@playwright/test').Page, chip: string) =>
  page.locator('[data-row="agent"]').filter({ has: page.getByText(chip, { exact: true }) });

test('verify verdict rows render all three chip states with their conclusions', async ({
  page,
}) => {
  await page.goto(ROUTE);
  await expect(verifyRow(page, '验证通过')).toContainText('e2e 与单测全绿');
  await expect(verifyRow(page, '验证未通过')).toContainText('两条失败用例需修复后复验');
  await expect(verifyRow(page, '判定提取失败')).toContainText('终轮输出不含合法 JSON');
});

test('evidence entries render as path blocks, notes included', async ({ page }) => {
  await page.goto(ROUTE);
  const evidence = page.getByTestId('verify-evidence');

  await expect(evidence).toHaveCount(3);
  await expect(evidence.filter({ hasText: 'docs/verify/1250/e2e.json' })).toContainText(
    '923 条全过',
  );
  await expect(evidence.filter({ hasText: 'docs/verify/1250/failures.txt' })).toContainText(
    '第 3/41 条',
  );
});

