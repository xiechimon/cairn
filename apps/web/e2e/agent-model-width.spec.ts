import { expect, test } from '@playwright/test';

// #1301：Agent 概览 tab 二级模型弹层宽度不足——弹层宽钉死在触发钮宽
// （--anchor-width），行文本 nowrap，长 id（`deepseek-v4-pro[1M]` 一类）右侧
// 被 overflow-x-hidden 吃掉。修后弹层随内容放宽：下限仍是触发钮宽，上限是
// 视口可用宽，全名可读。
//
// 每条断言钉一个失败方式：
// 1. 弹层横向溢出（scrollWidth > clientWidth = 右侧被裁）
// 2. 某一行的文本右缘越过行盒右缘（行内被裁）
// 3. 放宽后弹层越出视口
// 4. 放宽成比触发钮还窄（下限丢了）
//
// fixture 场景 = 'agent-detail-long-models'：r3-builder 绑 claude-code，该段
// 模型换成长 id（src/fixtures/agents.ts AGENT_LONG_MODEL_IDS）。
const DETAIL_LONG_MODELS = '/app/resources/agents/r3-builder?scenario=agent-detail-long-models';
const LONG_IDS = [
  'deepseek-v4-pro[1M]',
  'qwen3.8-max-0902[1M]',
  'vendor/very-long-model-id-for-clipping-check-2026-10[1M]',
];

test('长模型 id：概览 tab 模型弹层不横向裁切，最长 id 全名可见（#1301）', async ({ page }) => {
  await page.goto(DETAIL_LONG_MODELS);
  const detail = page.locator('.agent-detail');
  const trigger = detail.locator('.agent-model-select');
  await expect(trigger).toContainText('qwen3.8-max-0902[1M]');
  await trigger.click();
  const menu = page.locator('.agent-model-menu');
  await expect(menu).toBeVisible();
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished)));

  const m = await menu.evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth }));
  expect(m.sw).toBeLessThanOrEqual(m.cw);

  for (const id of LONG_IDS) {
    const row = menu.locator('.agent-model-row', { hasText: id });
    await expect(row).toHaveCount(1);
    const fit = await row.evaluate((el) => {
      const text = el.querySelector(':scope > *:first-child') as HTMLElement;
      return {
        textRight: text.getBoundingClientRect().right,
        rowRight: el.getBoundingClientRect().right,
        textSw: text.scrollWidth,
        textCw: text.clientWidth,
      };
    });
    expect(fit.textRight).toBeLessThanOrEqual(fit.rowRight + 0.5);
    expect(fit.textSw).toBeLessThanOrEqual(fit.textCw);
  }

  const viewport = page.viewportSize();
  const mb = await menu.boundingBox();
  const tb = await trigger.boundingBox();
  if (viewport === null || mb === null || tb === null) throw new Error('missing geometry');
  expect(mb.x).toBeGreaterThanOrEqual(-0.5);
  expect(mb.x + mb.width).toBeLessThanOrEqual(viewport.width + 0.5);
  expect(mb.width).toBeGreaterThanOrEqual(tb.width - 0.5);
});
