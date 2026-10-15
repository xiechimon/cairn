// dialog-body 环房回归闸（2026-10-12 实踩）：body 是滚动容器（overflow-y
// auto ⇒ 两轴都裁），w-full 控件贴齐裁切缘时，其 focus 环被左右各裁一刀。
// 修复 = 壳层负边距外扩到 DialogContent 的 p-4 垫层（内容零漂移）。
// #1244 起环是 2px outline + offset 2。本用例钉不变量：聚焦的 w-full
// 输入框，环的两缘都落在滚动容器裁切缘之内。所有 registry 弹窗共用一个壳
//（dialog-shell.tsx），取创建 agent 弹窗（最密 w-full 控件面）作正典场景。

import { expect, test } from '@playwright/test';

test('聚焦的 w-full 输入框 focus 环不被弹窗裁切（环房不变量）', async ({ page }) => {
  await page.goto('/app/resources/machines/Kd8fG2hJ4mN9pQ1rStUvWx3?scenario=06');
  await page.getByRole('button', { name: '创建 Agent' }).click();
  const dlg = page.getByRole('dialog', { name: '创建 agent' });
  await expect(dlg).toBeVisible();
  const input = dlg.locator('#dlg-agent-name');
  // 打开即自动聚焦（环在场的形态）。
  await expect(input).toBeFocused();
  const m = await page.evaluate(() => {
    const el = document.querySelector('#dlg-agent-name');
    const body = document.querySelector('[data-testid="dialog-body"]');
    if (!el || !body) return null;
    const ir = el.getBoundingClientRect();
    const br = body.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const width = Number.parseFloat(cs.outlineWidth);
    const offset = Number.parseFloat(cs.outlineOffset);
    return {
      inputL: ir.left,
      inputR: ir.right,
      bodyL: br.left,
      bodyR: br.right,
      spread: width + offset,
    };
  });
  expect(m).not.toBeNull();
  // 环的左右外沿都在滚动容器的裁切盒内。
  expect(m!.inputL - m!.spread).toBeGreaterThanOrEqual(m!.bodyL);
  expect(m!.inputR + m!.spread).toBeLessThanOrEqual(m!.bodyR);
});
