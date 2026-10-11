// machines 本地化 fixture 面钉（spec 11 A7/A8/A9，#357；#503 开关 → 品牌 mark；
// XMON-113 行内接回一个活控件 = 机器层 shell 开关）。
// live 面全链真值 = .claude/skills/verify-pacman/scripts/drive-machines-local.mjs
// （API+SQLite+UI 三向对照）；本 spec 钉 fixture canon 展示形：
// 1. 本机行钉列表首（data-kind="local" + data-machine-id + hostname canon）
// 2. 「Pacman 托管机器」facade 行已除（负向）
// 3. per-runtime 品牌 mark 在位（data-runtime），亮度分态 = fixture enabledRuntimes canon；
//    #887 图标独形——文字名不上屏，可读名走 aria-label + title
// 4. 行内恰一个控件 = shell 开关（XMON-113）；button / per-runtime switch 仍无（负向）
// 5. 副行 hint 摘除 → 开关簇 tooltip（#1175；#503 的 id 尾巴 / 并发上限仍负向）
// 6. 本机行不可删（行内无删除类控件，负向）
// 7. 行无 chevron 可点感装饰（A7 负向）
// 开关的读写/回滚行为面（live 打桩）在 machines-shell-switch.spec.ts。
// #944/#910 载体：.res-grow → div[data-kind]（行 div 的既有契约句柄；
// Switch 也带 data-machine-id，元素名限定防串）；.mach-runtime →
// [data-runtime]；.mach-mark → 其内 svg；.mach-runtime--on 状态类 →
// data-enabled 属性（裁定 3：状态断言载体走 data-*）；.mach-shell-switch →
// role=switch；.res-row-title/-desc → 文案一级；.res-row-more/-chev 负向 →
// 行内 menu 触发/可点语义计数 0。.res-main = chief docking 跨域句柄（#950）。

import { expect, test } from '@playwright/test';

const MACHINES = '/app/resources/machines?scenario=06';
const SHELL = '[data-route="/app/resources/machines"]';
const ROW = `${SHELL} div[data-kind]`;
const LOCAL_ROW = `${ROW}[data-kind="local"]`;
// fixture canon（fixtures.ts RESOURCES.machines）：本机行 = MACHINE_NAME /
// MACHINE_ID，enabledRuntimes ['pi']（pi 开 / Claude Code 关两态展示）。
const LOCAL_NAME = 'xmonsMac-3574.local';
const LOCAL_ID = 'TlZ2sSD4EJCxjNJqVhdo_';

test('本机行钉列表首：data-kind=local + id 句柄 + hostname canon', async ({ page }) => {
  await page.goto(MACHINES);
  const first = page.locator(ROW).first();
  await expect(first).toBeVisible();
  await expect(first).toHaveAttribute('data-kind', 'local');
  await expect(first).toHaveAttribute('data-machine-id', LOCAL_ID);
  await expect(first.getByText(LOCAL_NAME)).toHaveText(LOCAL_NAME);
});

test('托管 facade 行已除（spec 11 A8 负向）', async ({ page }) => {
  await page.goto(MACHINES);
  await expect(page.locator(LOCAL_ROW)).toBeVisible();
  await expect(page.locator(`${SHELL} .res-main`)).not.toContainText('Pacman 托管机器');
});

// #887 图标独形：文字名撤下，可辨识性走容器 role="img" + aria-label（读屏）
// 与 title（悬停提示）——三者一个都不许缺，否则等于把名字删没了。
test('per-runtime 品牌 mark：两个在位 + 亮度分态 = enabledRuntimes canon', async ({ page }) => {
  await page.goto(MACHINES);
  const pi = page.locator(`${LOCAL_ROW} [data-runtime="pi"]`);
  const cc = page.locator(`${LOCAL_ROW} [data-runtime="claude-code"]`);
  await expect(pi).toBeVisible();
  await expect(cc).toBeVisible();
  await expect(pi.locator('svg')).toBeVisible();
  await expect(cc.locator('svg')).toBeVisible();
  // 文字名不再上屏（容器文本为空）；可读名走无障碍面（引擎真值，不是属性复读）。
  await expect(pi).toHaveText('');
  await expect(cc).toHaveText('');
  await expect(pi).toHaveAccessibleName('pi');
  await expect(cc).toHaveAccessibleName('Claude Code');
  await expect(pi).toHaveAttribute('title', 'pi');
  await expect(cc).toHaveAttribute('title', 'Claude Code');
  // 亮度分态 canon：pi 开（实色）/ Claude Code 关（35% 透明）。
  await expect(pi).toHaveAttribute('data-enabled', 'true');
  await expect(cc).toHaveAttribute('data-enabled', 'false');
});

// XMON-113：行内控件面自 #503 的「零控件」改成「恰一个活控件」= 机器层 shell
// 开关。判据不是「行内不许有控件」，而是「不许有死控件」——#503 摘除的
// per-runtime 开关全仓只写不读（PR #507），shell 开关有真实消费方（XMON-108
// R1 双闸 + 每命令预检）。#1108 起行内活控件 = 两个：shell 开关 + 并发上限
// 选择器（machine.maxConcurrent，消费方 = server claim 闸 + daemon 本地闸
// ——「并发上限不许回来」的 #503 负向随用户 2026-10-10 要求数旋钮翻案：
// 摘除理由是死字段，现在是活控件）。死钮纪律保持：除这两个活控件外无
// button，per-runtime 的 switch 不许回来。
test('行内控件面 = shell 开关 + 并发选择器两个（XMON-113 + #1108；死钮仍无）', async ({
  page,
}) => {
  await page.goto(MACHINES);
  await expect(page.locator(`${LOCAL_ROW} [role="switch"]`)).toHaveCount(1);
  // 并发选择器（Popover 触发钮；aria-label = e2e 一级载体）。
  await expect(page.locator(`${LOCAL_ROW} button[aria-label="并发上限"]`)).toHaveCount(1);
  // 死钮纪律：除并发触发钮外零 button（删除 / chevron / 菜单全无）。
  await expect(page.locator(`${LOCAL_ROW} button`)).toHaveCount(1);
  // per-runtime 位仍是 mark 展示面，不是控件（#503 负向）。
  await expect(page.locator(`${LOCAL_ROW} [data-runtime] [role="switch"]`)).toHaveCount(0);
});

// 副行已摘（#1175）：hint 句不再常驻，改挂 shell 开关簇的 tooltip（hover
// 弹出）；#503 摘掉的 id 尾巴 / · max 死显示负向原样保留。断言两面：
// 静息 = 常驻文本不在（tooltip 只在 hover 后挂 body 级 portal）；触发 =
// hover 开关簇后 portal 里出现成品句（{tool} 插值后的串）。
test('副行 hint 摘除，改挂 shell 开关簇 tooltip（#1175）', async ({ page }) => {
  await page.goto(MACHINES);
  const hint = page.locator('[data-slot="tooltip-content"]');
  // 静息：行内无该句常驻（#503 的 id 尾巴 / · max 死显示负向保留）。
  await expect(page.locator(LOCAL_ROW)).not.toContainText(
    '已授权「远程 shell」的 Agent 可在该机器上执行命令。',
  );
  await expect(hint).toHaveCount(0);
  await expect(page.locator(LOCAL_ROW)).not.toContainText('· max');
  // 触发：hover 开关簇（词 + 开关整体）→ tooltip 弹出成品句。
  await page.locator(`${LOCAL_ROW} [data-slot="tooltip-trigger"]`).hover();
  await expect(hint).toBeVisible();
  await expect(hint).toHaveText('已授权「远程 shell」的 Agent 可在该机器上执行命令。');
});

test('本机行不可删：行内无删除类控件（负向）', async ({ page }) => {
  await page.goto(MACHINES);
  await expect(page.locator(`${LOCAL_ROW} button[aria-label*="删除"]`)).toHaveCount(0);
  await expect(page.locator(`${LOCAL_ROW} [aria-haspopup="menu"]`)).toHaveCount(0);
});

test('行无 chevron 可点感装饰（spec 11 A7 负向）', async ({ page }) => {
  await page.goto(MACHINES);
  await expect(page.locator(LOCAL_ROW)).toBeVisible();
  // A7 语义 = 行不可点：行本体无 button 语义/链接（chevron 装饰类已退役，
  // 断言从「装饰不在」改钉「可点语义不在」）。
  await expect(page.locator(`${SHELL} [data-kind][role="button"]`)).toHaveCount(0);
  await expect(page.locator(`${SHELL} [data-kind] a`)).toHaveCount(0);
});

// 钉扎四面之视觉几何断言面：mach-runtime 族硬契约（16×16 官方 mark；on/off
// 透明度分离 1 / 0.35；fixture canon pi=on cc=off 一次取齐）。#887 图标独形
// 后 label 字号档撤下，改钉「多 runtime 同屏排布不塌」：两 mark 间距 16px、
// 行高契约 60px 不破。
test('mark 几何：16×16 mark，on/off 透明度分离，行高契约不破', async ({ page }) => {
  await page.goto(MACHINES);
  const m = await page.evaluate(
    ({ sel }) => {
      const read = (runtime: string) => {
        const wrap = document.querySelector(`${sel} [data-runtime="${runtime}"]`);
        if (!wrap) throw new Error(`runtime missing: ${runtime}`);
        const mark = wrap.querySelector('svg');
        if (!mark) throw new Error('mark missing');
        const r = mark.getBoundingClientRect();
        const wr = wrap.getBoundingClientRect();
        return {
          markW: r.width,
          markH: r.height,
          opacity: getComputedStyle(mark).opacity,
          wrapLeft: wr.x,
          wrapRight: wr.right,
        };
      };
      const row = document.querySelector(sel)?.getBoundingClientRect();
      return {
        on: read('pi'),
        off: read('claude-code'),
        rowHeight: row?.height ?? null,
      };
    },
    { sel: LOCAL_ROW },
  );
  for (const s of [m.on, m.off]) {
    expect(s.markW).toBe(16);
    expect(s.markH).toBe(16);
  }
  expect(m.on.opacity).toBe('1'); // on：品牌原色
  expect(m.off.opacity).toBe('0.35'); // off：35% 透明
  expect(m.off.wrapLeft - m.on.wrapRight).toBe(16); // 同屏两图标间距不塌
  expect(m.rowHeight).toBe(60); // 行高契约不破（div[data-kind] 行盒）
});