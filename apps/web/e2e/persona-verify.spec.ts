import { expect, test } from '@playwright/test';

// Issue #1250（ADR 0018 层 1）fixture 面：verify verdict 行三态 + fan-out 行
// 的 fixture 零变化律。失败方式先于实现固化：
//   1. 三态徽标错档——passed=false 走了错误态、extractionError 在位仍报
//      「验证未通过」（应报「判定提取失败」）
//   2. 证据清单缺条目 / 丢注记（evidence 是验证面的核心交付）
//   3. fixture 面长出 fan-out 行（fanoutAvailable 只该由 live members 的
//      persona 行点亮，fixture 面 undefined = 行绝不渲染）
// live 真值面（fan-out 真点击三步入队 + 验证中 chip + verdict 截图）归
// docs/verify/1250/ 的 live 探针钉，本 spec 只钉 fixture 回归面。

const ROUTE = '/app/todo/7ve0iOkQ-JBpSL98zSiGc?scenario=verify-verdict';
/** review 弹层 frozen overlay 面（fixture 不点开——onReview 仅 live 接线）。 */
const ROUTE_DIALOG = '/app/todo/7ve0iOkQ-JBpSL98zSiGc?scenario=review-dialog-fanout';

/** 以徽标 chip 的精确文本锚定 verdict 行（conclusion 文本里的泛词不算数）。 */
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
  // passed 行 1 条 + failed 行 2 条 = 3 条证据；提取失败行零证据。
  await expect(evidence).toHaveCount(3);
  await expect(evidence.filter({ hasText: 'docs/verify/1250/e2e.json' })).toContainText(
    '923 条全过',
  );
  await expect(evidence.filter({ hasText: 'docs/verify/1250/failures.txt' })).toContainText(
    '第 3/41 条',
  );
});

test('the review dialog grows no fan-out row on the fixture face', async ({ page }) => {
  await page.goto(ROUTE_DIALOG);
  await page.locator('[role="dialog"][aria-label="AI 审核"]').waitFor({ state: 'visible' });
  // fixture 面零变化律：单选人列表健在，fan-out 行绝不渲染。
  await expect(page.getByTestId('review-fanout-toggle')).toHaveCount(0);
  await expect(page.locator('[role="dialog"][aria-label="AI 审核"] [role="option"]')).toHaveCount(
    1,
  );
  await expect(
    page.locator('[role="dialog"][aria-label="AI 审核"]').getByRole('button', { name: '开始审核' }),
  ).toBeVisible();
});
