// #1261 等额度板面（fixture 面 quota-wait 场景）：relay 配额挂起 = 显性态
// 三件套的板面两件——横幅 + 卡态；通知面由 server 集成测试（quota-wait.test）
// 钉住，详情行标签由 live verify 栈证据承载。失败方式先于实现固化：
//   1. 横幅缺席：挂起不可见（票面原文「板面 building 假象零反馈」）——
//      data-quota-banner 必须在、且指名 relay lane 与探测时刻。
//   2. 卡态缺席/误染：挂起卡无「等额度」芯片 = 执行中列里静默断粮；普通
//      执行中卡染芯片 = 假警报（误报面）。两卡各钉一边。
//   3. 头 chip 谎报：详情头仍说「执行中」而不说「等额度」。
//   4. 基线漂移：无挂起场景（01）板面零横幅零芯片（存量零回归）。

import { expect, test } from '@playwright/test';

const QUOTA = '/app?scenario=quota-wait';

test('挂起卡带「等额度」芯片，普通执行中卡不带（卡态两钉）', async ({ page }) => {
  await page.goto(QUOTA);
  const waiting = page.locator('[data-todo-id="quota-waiting-1"]');
  await expect(waiting).toBeVisible();
  // 失败方式 2 正钉：挂起卡芯片在位（attention 底，data-todo-quota 载体）。
  await expect(waiting.locator('[data-todo-quota="quota"]')).toHaveText('等额度');
  // 失败方式 2 误报钉：同场景的普通执行中卡无芯片。
  const plain = page.locator('[data-todo-id="quota-plain-1"]');
  await expect(plain).toBeVisible();
  await expect(plain.locator('[data-todo-quota]')).toHaveCount(0);
});

test('板面横幅指名 relay lane 与事件类型（横幅半）', async ({ page }) => {
  await page.goto(QUOTA);
  const banner = page.locator('[data-quota-banner]');
  // 失败方式 1：横幅缺席即挂起不可见。
  await expect(banner).toBeVisible();
  await expect(banner).toContainText('Relay 186');
  await expect(banner).toContainText('额度空');
  // 探测时刻进文案（13:56 = fixture probeAt 整刻）。
  await expect(banner).toContainText('13:56');
});

test('详情头 chip 说「等额度」不说「执行中」（卡态的头半）', async ({ page }) => {
  await page.goto(QUOTA);
  await page.locator('[data-todo-id="quota-waiting-1"] .todo-card-link').click();
  await expect(page.getByTestId('phase-chip')).toContainText('等额度');
});

test('无挂起基线：01 场景板面零横幅零芯片（存量零回归）', async ({ page }) => {
  await page.goto('/app?scenario=01');
  await expect(page.locator('[data-quota-banner]')).toHaveCount(0);
  await expect(page.locator('[data-todo-quota]')).toHaveCount(0);
});
