import { expect, test } from '@playwright/test';

// Issue #919 seam 4（前端腿，fixture 面）：技能路由事件的可见面。该面的实现
// 由并行票 #918 先合入 main（shared 分类器 + activity 活行披露 + 持久汇总
// 行），本 spec 是 #919 验收对那张脸的 CI 钉扎。fixture 面只钉**持久**汇总
// 行——活行披露面按 #873/918 设计仅 live 态渲染（liveStep 在位才挂面板），
// 它的钉扎归 #918 的 unit（activity-live-row）与 live 探针（docs/verify/918）：
//   1. 持久汇总行缺列 / 名字错（read / denied 两列失真）
//   2. 被 deny 挡下的事实与命中不可区分（deny 面失明）
//   3. 零技能事件的运行长出技能行（对照组零噪声律）
// live 真值面另由 docs/verify/919/ 的行为腿截图钉（真派发 + 真用户路径）。

const ROUTE = '/app/todo/7ve0iOkQ-JBpSL98zSiGc?scenario=skills-routing';
/** 零技能事件的对照面（r7 27 review 捕获，build 载荷在场）。 */
const ROUTE_NO_SKILLS = '/app/todo/7ve0iOkQ-JBpSL98zSiGc?scenario=27';

test('the durable summary row names reads and denials in two columns', async ({ page }) => {
  // 2026-10-12 重钉（#1268 行为批）：汇总行换 dsh ContextInjectionRow 形——
  // 图标 + 标题「技能注入」+ 点隔 + 名单副题，居中灰通知退役。两列事实
  // （read / denied）的钉扎不变。
  await page.goto(ROUTE);
  const summary = page.getByTestId('skills-summary');
  await expect(summary).toBeVisible();
  await expect(summary).toContainText('技能注入');
  await expect(summary).toContainText('haiku-helper');
  await expect(summary).toContainText('挡下：secret-local');
});

test('a run without skill events grows no summary row (control zero-noise)', async ({
  page,
}) => {
  await page.goto(ROUTE_NO_SKILLS);
  await expect(page.getByTestId('skills-summary')).toHaveCount(0);
});
