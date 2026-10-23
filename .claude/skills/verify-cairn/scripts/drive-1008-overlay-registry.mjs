#!/usr/bin/env node
// verify-cairn 定制 probe（#1008 overlay+overlays 域 registry 族拆）— live 栈
// 真用户路径 + registry 载体实物断言。栈必须已在跑（launch.mjs；坐标取
// VERIFY_RUN_DIR/ports.json，worktree 车道传 VERIFY_REPO_ROOT）。
//
// 前置：全新库（launch 即清）。probe 自己走 保存 建第一张卡（无项目时
// server 自动建「默认项目」，drive-948 同律）。
//
// 检查面（#983 判决 + 2026-10-08 原型实审三裁决的运行时实物）：
//   A. 新建任务 dialog：项目/机器 popover = registry Popover（slot 载体、
//      portal 落 body、Positioner 锚定几何、机器面向上开）、Tab 提示 =
//      TooltipTrigger→PopoverTrigger→Button 三层复合上的 Tooltip+Kbd、
//      discard 闸 = registry AlertDialog（overlay/content slot、keep 送焦）、
//      提及 picker = registry Dialog（400 宽、视口居中、无自带 X）
//   B. detail：chip popover = Popover；外点穿透 = 裁决 1 实物（开着 popover
//      点 更多，同击双效：popover 关 + dropdown 开）；more-menu =
//      DropdownMenu 锚定 更多 钮（跨组件 anchor）
//   C. account 语言盘 = Popover listbox（选行即关）
//   D. schedules 新建定时 = registry Dialog（overlay slot + registry X）
//   E. tooltip 三消费点（FAB ⌘J / rail ⌘K / 抽屉 新主题 N）
//   F. 亮模一遍主面（主题持久化 localStorage）
//   G. 保存链 API + SQLite 双真值（数据面零回归）
// 证据（截图 + result.json）落 VERIFY_EVIDENCE_DIR；任一断言失败退出码 1。
// 口径与 apps/web/playwright.config.ts 一致：1440×732。

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const SCRIPT_ROOT = fileURLToPath(new URL('../../../..', import.meta.url));
const ROOT = process.env.VERIFY_REPO_ROOT
  ? resolve(process.env.VERIFY_REPO_ROOT)
  : SCRIPT_ROOT;
const RUN_DIR = process.env.VERIFY_RUN_DIR ?? join(ROOT, '.claude', 'verify-run');

const portsFile = join(RUN_DIR, 'ports.json');
let stack;
try {
  stack = JSON.parse(readFileSync(portsFile, 'utf8'));
} catch {
  console.error(`无栈：${portsFile} 不存在或损坏。先跑 launch.mjs`);
  process.exit(1);
}
const API = `http://127.0.0.1:${stack.serverPort}`;
const WEB = `http://127.0.0.1:${stack.webPort}`;
const DB_PATH = join(stack.homeDir, 'server', 'server.db');

const now = new Date();
const pad = (n) => String(n).padStart(2, '0');
const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
const EVIDENCE =
  process.env.VERIFY_EVIDENCE_DIR ??
  join(SCRIPT_ROOT, '.claude', 'verify-evidence', `${stamp}-1008-overlay-registry`);
mkdirSync(EVIDENCE, { recursive: true });

const checks = [];
const artifacts = [];
const extra = {};
let failures = 0;
const check = (ok, label) => {
  checks.push({ ok, label });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) failures += 1;
};
const shot = async (page, name) => {
  await page.screenshot({ path: join(EVIDENCE, name) });
  artifacts.push(name);
  console.log(`shot  ${name}`);
};
const getJson = async (url) => {
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
  return res.json();
};
const dbQuery = (fn) => {
  try {
    const requireServer = createRequire(join(ROOT, 'apps', 'server', 'package.json'));
    const Database = requireServer('better-sqlite3');
    const db = new Database(DB_PATH, { readonly: true });
    try {
      return { ok: true, ...fn(db) };
    } finally {
      db.close();
    }
  } catch (err) {
    return { ok: false, skipped: true, reason: String(err?.message ?? err) };
  }
};

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1440, height: 732 },
  colorScheme: 'dark',
});

const gotoBoard = async () => {
  await page.goto(`${WEB}/app`);
  await page.waitForSelector('[data-route="board"]', { timeout: 15_000 });
};
const dialog = () => page.getByRole('dialog', { name: '新建任务' });
const specBox = () => dialog().getByRole('textbox');
const popover = () => page.locator('[data-slot="popover-content"]');
const tooltip = () => page.locator('[data-slot="tooltip-content"]');

try {
  await gotoBoard();

  // ---- A. 新建任务 dialog：registry 壳族实物 ----
  await page.locator('.sidebar-new-task').click();
  await dialog().waitFor({ state: 'visible', timeout: 10_000 });
  check(true, 'A1 新建任务 dialog 开面');
  await shot(page, '01-dialog-dark.png');

  // A2-A4 项目 popover = registry Popover
  const chip = dialog().getByTestId('new-task-project-chip');
  await chip.hover();
  await tooltip().waitFor({ state: 'visible', timeout: 5_000 });
  const tipKbd = await tooltip().locator('[data-slot="kbd"]').textContent();
  check(tipKbd === 'Tab', `A2 chip hover = Tooltip+Kbd 组合（kbd 实物 "${tipKbd}"）`);
  await shot(page, '02-tab-tooltip-dark.png');
  await page.mouse.move(5, 5);
  await tooltip().waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => {});
  // 项目 popover 检查组移到首卡保存之后：全新库 projects=[] → rows 空集，
  // 空集不开面是 #176 设计律（live 无项目时提交走建默认项目路径）。
  // A3 机器 popover 向上开
  const machChip = dialog().getByTestId('new-task-machine-chip');
  await machChip.click();
  const machMenu = page.getByRole('listbox', { name: '机器' });
  await machMenu.waitFor({ state: 'visible', timeout: 5_000 });
  const machBox = await machMenu.boundingBox();
  const machChipBox = await machChip.boundingBox();
  check(
    machBox && machChipBox && machBox.y + machBox.height <= machChipBox.y + 2,
    'A7 机器 popover side=top 向上开（底栏面不出对话框）',
  );
  check(
    (await machMenu.getByRole('option', { name: '自动' }).count()) === 1,
    'A8 机器行集含 自动 行（首行恒在）',
  );
  await shot(page, '04-machine-popover-dark.png');
  await page.keyboard.press('Escape');
  await machMenu.waitFor({ state: 'hidden', timeout: 5_000 });
  const dialogAlive = await dialog().isVisible();
  check(dialogAlive, 'A9 Esc 分层：只收机器 popover，dialog 存留（Base UI layer 栈）');

  // A10-A12 discard 闸 = registry AlertDialog
  await specBox().fill('1008 未保存探针');
  await dialog().getByRole('button', { name: '关闭' }).click();
  const discard = page.getByRole('alertdialog', { name: '放弃新建任务？未保存的内容将丢失。' });
  await discard.waitFor({ state: 'visible', timeout: 10_000 });
  const alertSlots = await page.evaluate(() => ({
    content: document.querySelector('[data-slot="alert-dialog-content"]') != null,
    overlay: document.querySelector('[data-slot="alert-dialog-overlay"]') != null,
  }));
  check(alertSlots.content && alertSlots.overlay, 'A10 discard 闸 = registry AlertDialog（content+overlay slot 实物）');
  const keepFocused = await page.evaluate(
    () => document.activeElement?.className?.includes('new-task-discard-keep') === true,
  );
  check(keepFocused, 'A11 开闸焦点显式落 继续编辑（#723 契约保留）');
  await shot(page, '05-discard-alertdialog-dark.png');
  await discard.getByRole('button', { name: '继续编辑' }).click();
  await discard.waitFor({ state: 'hidden', timeout: 5_000 });
  check((await specBox().inputValue()) === '1008 未保存探针', 'A12 继续编辑收闸留草稿');

  // A13-A15 提及 picker = registry Dialog
  await dialog().getByRole('button', { name: '提及' }).click();
  const picker = page.getByRole('dialog', { name: '提及' });
  await picker.waitFor({ state: 'visible', timeout: 5_000 });
  // 进场动画落定再量（registry zoom-in-95：动画中 boundingRect 是 0.95 缩放
  // 值，400 宽会量成 380——run2 实测坑）。
  await picker.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
  const pickerRect = await picker.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x, width: r.width };
  });
  check(
    Math.abs(pickerRect.width - 400) <= 1 && Math.abs(pickerRect.x - (1440 - pickerRect.width) / 2) <= 1,
    `A13 提及 picker = 400 宽视口居中（实测 w=${pickerRect.width.toFixed(1)} x=${pickerRect.x.toFixed(1)}；registry translate 居中，#448「transform 不承载位移」字面照旧成立）`,
  );
  const noBuiltinX = await picker.evaluate(
    (el) => el.querySelector(':scope > [data-slot="dialog-close"]') == null,
  );
  check(noBuiltinX, 'A14 picker 无 registry 自带 X（自带 head 关闭钮，双 X 防重）');
  // 宿主 new-task DialogShell 自带一张背板（同 data-slot）——取末位 =
  // picker 自己的 registry overlay（后开层后挂）。
  const overlayVisible = await page.locator('[data-slot="dialog-overlay"]').last().isVisible();
  check(overlayVisible, 'A15 picker 自带 registry 可见背板在场（实审裁决 3 接受的形态）');
  await shot(page, '06-mention-picker-dark.png');
  await page.keyboard.press('Escape');
  await picker.waitFor({ state: 'hidden', timeout: 5_000 });
  check(await dialog().isVisible(), 'A16 Esc 分层：只收 picker，dialog 存留');

  // A17-A19 保存链双真值
  await dialog().getByRole('button', { name: '保存', exact: true }).click();
  await dialog().waitFor({ state: 'hidden', timeout: 10_000 });
  await page
    .locator('[data-column="todo"] .todo-card', { hasText: '1008 未保存探针' })
    .first()
    .waitFor({ state: 'visible', timeout: 10_000 });
  check(true, 'A17 保存 → 卡片上板');
  const todos = await getJson(`${API}/api/todos`);
  const row = todos.find((t) => t.title === '1008 未保存探针');
  extra.apiTodo = row ?? null;
  check(row != null, 'A18 GET /api/todos 行真值');
  const dbRow = dbQuery((db) => ({
    row: db.prepare('SELECT id, title, phase FROM todo WHERE title = ?').get('1008 未保存探针') ?? null,
  }));
  extra.sqliteTodo = dbRow;
  check(dbRow.ok === true && dbRow.row != null, 'A19 SQLite todo 行真值');

  // A20-A23 项目 popover = registry Popover（保存后行集非空）
  await page.locator('.sidebar-new-task').click();
  await dialog().waitFor({ state: 'visible', timeout: 10_000 });
  const chip2 = dialog().getByTestId('new-task-project-chip');
  await chip2.click();
  const projMenu = page.getByRole('listbox', { name: '项目' });
  await projMenu.waitFor({ state: 'visible', timeout: 5_000 });
  check(true, 'A20 项目 popover 开面（role=listbox 一级载体）');
  const portaled = await projMenu.evaluate(
    (el) => el.closest('[data-slot="popover-content"]') != null && el.closest('[role="dialog"]') == null,
  );
  check(portaled, 'A21 面板 = popover-content slot 且 portal 落 body（不嵌 dialog DOM）');
  const chipBox = await chip2.boundingBox();
  const menuBox = await projMenu.boundingBox();
  check(
    chipBox && menuBox && menuBox.y >= chipBox.y + chipBox.height - 2 && menuBox.y - (chipBox.y + chipBox.height) < 24 && Math.abs(menuBox.x - chipBox.x) < 24,
    `A22 Positioner 锚定实物（menu@${menuBox?.x?.toFixed(0)},${menuBox?.y?.toFixed(0)} vs chip 底缘 ${(chipBox?.y + chipBox?.height)?.toFixed(0)}）`,
  );
  await shot(page, '03-project-popover-dark.png');
  const firstOption = projMenu.getByRole('option').first();
  const firstName = (await firstOption.textContent())?.trim() ?? '';
  await firstOption.click();
  await projMenu.waitFor({ state: 'hidden', timeout: 5_000 });
  const chipText = await chip2.textContent();
  check(chipText?.includes(firstName.slice(0, 4)) === true, `A23 选行回填 chip（"${firstName}" → chip）`);
  await dialog().getByRole('button', { name: '关闭' }).click();
  await dialog().waitFor({ state: 'hidden', timeout: 10_000 });

  // ---- B. detail：chip popover + 穿透裁决实物 + more-menu 锚定 ----
  await page.locator('[data-column="todo"] .todo-card', { hasText: '1008 未保存探针' }).first().click();
  await page.waitForSelector('[data-testid="detail-head"]', { timeout: 10_000 });
  const phaseChip = page.getByTestId('phase-chip');
  await phaseChip.click();
  const chipPop = page.getByRole('dialog', { name: '任务分配' });
  await chipPop.waitFor({ state: 'visible', timeout: 5_000 });
  check(true, 'B1 detail chip popover = registry Popover 开面（role=dialog 任务分配）');
  await shot(page, '07-chip-popover-dark.png');
  // 裁决 1 实物：popover 开着点 更多 —— 穿透 = 同击双效
  const more = page.locator('.detail-head-icon--more');
  await more.click();
  await page.waitForTimeout(400);
  const moreMenu = page.locator('[data-slot="dropdown-menu-content"]');
  const popoverGone = !(await chipPop.isVisible().catch(() => false));
  const menuOpen = await moreMenu.first().isVisible().catch(() => false);
  check(popoverGone && menuOpen, 'B2 外点穿透 = 裁决 1 实物：同击既关 chip popover 又开 more-menu');
  const moreBox = await more.boundingBox();
  const menuBox2 = await moreMenu.first().boundingBox();
  check(
    moreBox && menuBox2 && menuBox2.y >= moreBox.y + moreBox.height - 2 &&
      Math.abs(menuBox2.x + menuBox2.width - (moreBox.x + moreBox.width)) < 40,
    'B3 more-menu = DropdownMenu 锚定 更多 钮（跨组件 anchor，右缘对齐、钮下开）',
  );
  const deleteRow = moreMenu.first().locator('[data-action="delete"]');
  check(
    (await deleteRow.count()) === 1 &&
      ((await deleteRow.getAttribute('data-variant')) === 'destructive'),
    'B4 删除行 = DropdownMenuItem destructive 档（data-action 载体保留）',
  );
  await shot(page, '08-more-menu-dark.png');
  await page.keyboard.press('Escape');
  await moreMenu.first().waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => {});
  check(await page.locator('[data-testid="detail-head"]').isVisible(), 'B5 Esc 收菜单、页面存留');

  // ---- C. account 语言盘 ----
  await page.goto(`${WEB}/app/account`);
  await page.waitForSelector('.account-card', { timeout: 10_000 });
  const langTrigger = page.getByRole('button', { name: /简体中文|English/ }).first();
  await langTrigger.click();
  const langMenu = page.getByRole('listbox', { name: '语言' });
  await langMenu.waitFor({ state: 'visible', timeout: 5_000 });
  const langPortaled = await langMenu.evaluate(
    (el) => el.closest('[data-slot="popover-content"]') != null,
  );
  check(langPortaled, 'C1 语言盘 = registry Popover（slot 实物）');
  await shot(page, '09-lang-popover-dark.png');
  await langMenu.getByRole('option').first().click();
  await langMenu.waitFor({ state: 'hidden', timeout: 5_000 });
  check(true, 'C2 选行即关（select-and-close 家族律）');

  // ---- D. schedules 新建定时 = registry Dialog ----
  await page.goto(`${WEB}/app/schedules`);
  await page.getByRole('button', { name: '新建' }).first().click();
  const sched = page.getByRole('dialog', { name: '新建定时' });
  await sched.waitFor({ state: 'visible', timeout: 5_000 });
  const schedSlots = await page.evaluate(() => ({
    overlay: document.querySelector('[data-slot="dialog-overlay"]') != null,
    close: document.querySelector('[data-slot="dialog-content"] [data-slot="dialog-close"]') != null,
  }));
  check(schedSlots.overlay && schedSlots.close, 'D1 新建定时 = registry Dialog（overlay + 自带 X slot 实物）');
  await shot(page, '10-sched-dialog-dark.png');
  await page.locator('[data-slot="dialog-content"] [data-slot="dialog-close"]').click();
  await sched.waitFor({ state: 'hidden', timeout: 5_000 });
  check(true, 'D2 registry X 关面可用（旧 .sched-form-close 退役后继任）');

  // ---- E. tooltip 三消费点 ----
  await gotoBoard();
  const fab = page.getByRole('button', { name: '总管' }).first();
  await fab.hover();
  await tooltip().waitFor({ state: 'visible', timeout: 5_000 });
  check(
    (await tooltip().locator('[data-slot="kbd"]').textContent()) === '⌘J',
    'E1 FAB ⌘J tooltip（registry Tooltip+Kbd）',
  );
  await shot(page, '11-tooltip-fab-dark.png');
  await page.mouse.move(5, 5);
  await tooltip().waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => {});
  await page.locator('button[aria-label="收起侧边栏"]').click();
  const railSearch = page.getByRole('button', { name: '搜索' });
  await railSearch.hover();
  await tooltip().waitFor({ state: 'visible', timeout: 5_000 });
  check(
    (await tooltip().locator('[data-slot="kbd"]').textContent()) === '⌘K',
    'E2 rail 搜索 ⌘K tooltip（side=right）',
  );
  await shot(page, '12-tooltip-rail-dark.png');
  await page.mouse.move(700, 400);
  await tooltip().waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => {});
  await fab.click();
  const newThread = page.locator('.chief-drawer button[aria-label="新主题"]');
  await newThread.waitFor({ state: 'visible', timeout: 10_000 });
  await newThread.hover();
  await tooltip().waitFor({ state: 'visible', timeout: 5_000 });
  check(
    (await tooltip().locator('[data-slot="kbd"]').textContent()) === 'N',
    'E3 抽屉 新主题 N tooltip（side=bottom）',
  );
  await shot(page, '13-tooltip-drawer-dark.png');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  // ---- F. 亮模一遍主面 ----
  await page.evaluate(() => localStorage.setItem('cairn-theme', 'light'));
  await gotoBoard();
  // E2 收起了侧栏（rail 态无 .sidebar-new-task）——开面走 c 热键。
  for (let i = 0; i < 10; i++) {
    if (await dialog().isVisible().catch(() => false)) break;
    await page.keyboard.press('c');
    await page.waitForTimeout(250);
  }
  await dialog().waitFor({ state: 'visible', timeout: 10_000 });
  const chipL = dialog().getByTestId('new-task-project-chip');
  await chipL.hover();
  await tooltip().waitFor({ state: 'visible', timeout: 5_000 });
  await shot(page, '14-tooltip-light.png');
  await page.mouse.move(5, 5);
  await tooltip().waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => {});
  await chipL.click();
  await page.getByRole('listbox', { name: '项目' }).waitFor({ state: 'visible', timeout: 5_000 });
  await shot(page, '15-project-popover-light.png');
  check(true, 'F1 亮模 popover+tooltip 主面走查（截图证据）');

  extra.checks = checks;
  extra.artifacts = artifacts;
  writeFileSync(join(EVIDENCE, 'result.json'), JSON.stringify({ checks, artifacts, extra }, null, 2));
  console.log(`---\n${checks.length - failures}/${checks.length} PASS · 证据 ${EVIDENCE}`);
} catch (err) {
  console.error('PROBE CRASH:', err);
  await shot(page, 'crash.png').catch(() => {});
  writeFileSync(join(EVIDENCE, 'result.json'), JSON.stringify({ checks, artifacts, crash: String(err) }, null, 2));
  failures += 1;
} finally {
  await browser.close();
}
process.exit(failures === 0 ? 0 : 1);
