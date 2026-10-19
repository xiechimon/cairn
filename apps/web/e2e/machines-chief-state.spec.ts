// #895 机器页三态读标注（spec 21 A8）fixture 面钉。失败方式（先于实现
// 固化，仓测试纪律）：
// 1. 徽标缺位：设了主力机，machines 页看不出谁承载总管 → 「关电脑前确认
//    编排已落在常开机器上」没有观测面 → host 徽标必须钉在 defaultMachineId
//    命中行（fixture：chiefHost 行）。
// 2. 状态缺位：回合进行中 / 等待机器不可见 → running/waiting 两状态行
//    缺一即红。
// 3. 死钮纪律破坏：标注带了按钮/menu → 行内活控件面自 XMON-113 起 =
//    shell 闸恰一个 → 标注容器内必须零 button 零 role=menu。
// 4. 存量漂移：无标注数据的行（06 canon 面）不得长出任何标注节点
//    （capture 零漂移）。
// 5. 行高契约破坏：标注把 52px 设置行顶破 → 行高契约必须保持。
// live 全链真值（PATCH 设主力机 → 徽标 → 离线 → 等待 → 宽限失败）归
// verify 证据（docs/verify/865/，PR body raw 永久链）。
// #944/#910 载体：.res-grow → div[data-kind]；.mach-orchestration* →
// [data-orchestration] 状态属性（host/running/waiting，容器类退役）；
// .res-dot → [data-on]；行间分隔线由设置卡 divide-y 承载（无 data-divided）。

import { expect, test } from '@playwright/test';

const CHIEF_STATE = '/app/resources/machines?scenario=machines-chief-state';
const CANON = '/app/resources/machines?scenario=06';
const SHELL = '[data-route="/app/resources/machines"]';
const ROW = `${SHELL} div[data-kind]`;
const HOST_ROW = `${ROW}[data-kind="local"]`;
const ORCH = `${ROW} [data-orchestration]`;

test('总管主机徽标：钉在 host 行（data-orchestration=host + 文案）', async ({ page }) => {
  await page.goto(CHIEF_STATE);
  const host = page.locator(HOST_ROW).locator('[data-orchestration="host"]');
  await expect(host).toHaveText('总管主机');
  // 徽标只此一枚：其余行不长 host 标注。
  await expect(page.locator(`${ROW} [data-orchestration="host"]`)).toHaveCount(1);
});

test('总管回合进行中：running 状态行在在线远端行', async ({ page }) => {
  await page.goto(CHIEF_STATE);
  const running = page.locator(ROW).filter({ hasText: 'mea-wsl' }).locator('[data-orchestration="running"]');
  await expect(running).toHaveText('总管回合进行中');
});

test('总管等待机器：waiting 状态行在离线远端行（与离线灰点正交共存）', async ({ page }) => {
  await page.goto(CHIEF_STATE);
  const row = page.locator(ROW).filter({ hasText: 'vps-relay' });
  const waiting = row.locator('[data-orchestration="waiting"]');
  await expect(waiting).toHaveText('总管等待机器');
  // 同行的机器在线位仍由在线点承载（灰）——两事实正交，不互相顶替。
  await expect(row.locator('[data-on]')).toHaveAttribute('data-on', 'false');
});

test('读态零控件：标注容器内零 button / 零 menu 语义（死钮纪律保持）', async ({ page }) => {
  await page.goto(CHIEF_STATE);
  await expect(page.locator(ORCH).first()).toBeVisible();
  await expect(page.locator(`${ORCH} button`)).toHaveCount(0);
  await expect(page.locator(`${ORCH} [role="menu"]`)).toHaveCount(0);
  // 标注本体也不得是控件（容器类退役后按状态属性逐个钉）。
  await expect(page.locator(`${SHELL} [data-orchestration][role="button"]`)).toHaveCount(0);
  // 行内控件面仍 = shell 闸恰一个（XMON-113 律不被标注破坏）。
  await expect(page.locator(`${ROW} [role="switch"]`)).toHaveCount(3);
});

test('存量零漂移：无标注数据（06 canon 面）不长任何标注节点', async ({ page }) => {
  await page.goto(CANON);
  await expect(page.locator(ROW).first()).toBeVisible();
  await expect(page.locator(`${SHELL} [data-orchestration]`)).toHaveCount(0);
});

test('行高契约保持：标注行不破 Paper 设置行高（每行 52，含分隔线）', async ({ page }) => {
  await page.goto(CHIEF_STATE);
  const rows = page.locator(ROW);
  await expect(rows).toHaveCount(3);
  const heights = await rows.evaluateAll((els) =>
    els.map((el) => el.getBoundingClientRect().height),
  );
  expect(heights).toEqual([52, 52, 52]);
});
