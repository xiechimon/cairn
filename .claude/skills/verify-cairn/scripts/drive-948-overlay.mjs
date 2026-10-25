#!/usr/bin/env node

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
  join(SCRIPT_ROOT, '.claude', 'verify-evidence', `${stamp}-948-overlay`);
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

try {
  await gotoBoard();

  await page.locator('.sidebar-new-task').click();
  await dialog().waitFor({ state: 'visible', timeout: 10_000 });
  check(true, 'A1 新建任务 dialog 开面（role+name 载体）');
  const focused = await page.evaluate(
    () => document.activeElement?.getAttribute('data-testid') === 'new-task-spec',
  );
  check(focused, 'A2 开门 autofocus 落正文 textarea（testid 实物）');

  await dialog().evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
  const headBox = await page.getByTestId('new-task-head').boundingBox();
  const closeBox = await dialog().getByRole('button', { name: '关闭' }).boundingBox();
  check(
    headBox != null &&
      closeBox != null &&
      Math.abs(closeBox.width - 28) < 1 &&
      Math.abs(closeBox.height - 28) < 1,
    `B1 close 钮 28×28 实物（实测 ${closeBox?.width}×${closeBox?.height}）`,
  );
  check(
    headBox != null &&
      closeBox != null &&
      Math.abs(headBox.x + headBox.width - (closeBox.x + closeBox.width) - 4) < 1.5,
    'B2 close 钮贴 head 右缘 4px（#574 欠账回归钉的 live 面）',
  );
  await shot(page, '01-dialog-dark.png');

  await dialog().getByRole('button', { name: '关闭' }).click();
  await dialog().waitFor({ state: 'hidden', timeout: 10_000 });
  check(true, 'A3 净表单 X 直关（无确认层）');
  await page.locator('.sidebar-new-task').click();
  await specBox().fill('948 未保存探针');
  await dialog().getByRole('button', { name: '关闭' }).click();
  const discard = page.getByRole('alertdialog', {
    name: '放弃新建任务？未保存的内容将丢失。',
  });
  await discard.waitFor({ state: 'visible', timeout: 10_000 });
  check(true, 'A4 脏表单 X 先过未保存闸（r9 §3.4 copy 逐字）');
  await shot(page, '02-discard-gate-dark.png');
  await discard.getByRole('button', { name: '继续编辑' }).click();
  await discard.waitFor({ state: 'hidden', timeout: 10_000 });
  const kept = await specBox().inputValue();
  check(kept === '948 未保存探针', 'A5 继续编辑收闸留草稿');
  await dialog().getByRole('button', { name: '关闭' }).click();
  await discard.getByRole('button', { name: '放弃并关闭' }).click();
  await dialog().waitFor({ state: 'hidden', timeout: 10_000 });
  await page.locator('.sidebar-new-task').click();
  const afterReset = await specBox().inputValue();
  check(afterReset === '', 'A6 放弃并关闭 = 关面 + 重开净面');

  await specBox().fill('948 探针任务');
  await dialog().getByRole('button', { name: '保存', exact: true }).click();
  await dialog().waitFor({ state: 'hidden', timeout: 10_000 });
  await page.locator('[data-column="todo"] .todo-card', { hasText: '948 探针任务' }).first().waitFor({ state: 'visible', timeout: 10_000 });
  check(true, 'A7 保存 → 卡片上板');
  const todos = await getJson(`${API}/api/todos`);
  const row = todos.find((t) => t.title === '948 探针任务');
  extra.apiTodo = row ?? null;
  check(row != null, 'A8 GET /api/todos 行真值');
  const dbRow = dbQuery((db) => {
    const r = db
      .prepare('SELECT id, title, phase FROM todo WHERE title = ?')
      .get('948 探针任务');
    return { row: r ?? null };
  });
  extra.sqliteTodo = dbRow;
  check(dbRow.ok === true && dbRow.row != null, 'A9 SQLite todo 行真值');

  await page.locator('.sidebar-new-task').click();
  await dialog().waitFor({ state: 'visible', timeout: 10_000 });
  const chip = dialog().getByTestId('new-task-project-chip');
  await chip.click();
  const projectMenu = dialog().getByRole('listbox', { name: '项目' });
  await projectMenu.waitFor({ state: 'visible', timeout: 10_000 });
  const optionCount = await projectMenu.getByRole('option').count();
  check(optionCount >= 1, `C1 项目 popover 开行集（${optionCount} 行）`);

  const menuGeom = await projectMenu.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { width: cs.width, padding: cs.padding, zIndex: cs.zIndex, radius: cs.borderRadius };
  });
  check(
    menuGeom.width === '220px' && menuGeom.padding === '12px' && menuGeom.zIndex === '30',
    `C2 popover 壳实物 220/12px/z30（${JSON.stringify(menuGeom)}）`,
  );
  await shot(page, '03-project-popover-dark.png');
  await projectMenu.getByRole('option').first().click();
  await projectMenu.waitFor({ state: 'hidden', timeout: 10_000 });
  const chipText = await chip.textContent();
  check((chipText ?? '').length > 0, `C3 选行回填 chip（「${chipText}」）`);

  const chipFont = await chip
    .locator('.new-task-project-name')
    .evaluate((el) => getComputedStyle(el).fontSize);
  check(chipFont === '13px', `C4 chip 项目名 13px 字实物（${chipFont}）`);

  const machineChip = dialog().getByTestId('new-task-machine-chip');
  await machineChip.click();
  const machineMenu = dialog().getByRole('listbox', { name: '机器' });
  await machineMenu.waitFor({ state: 'visible', timeout: 10_000 });
  const autoRow = machineMenu.getByRole('option', { name: '自动' });
  check(await autoRow.isVisible(), 'C5 机器 popover 自动行（live 无机器降级面）');

  const menuBox = await machineMenu.boundingBox();
  const chipBox = await machineChip.boundingBox();
  check(
    menuBox != null &&
      chipBox != null &&
      menuBox.y + menuBox.height <= chipBox.y - 4,
    `C6 机器 popover 向上开实物（菜单底 ${menuBox?.y != null ? menuBox.y + menuBox.height : '?'} ≤ chip 顶 ${chipBox?.y}）`,
  );
  await shot(page, '04-machine-popover-dark.png');
  await autoRow.click();
  await machineMenu.waitFor({ state: 'hidden', timeout: 10_000 });

  await dialog().getByRole('button', { name: '提及' }).click();
  const picker = page.getByRole('dialog', { name: '提及' });
  await picker.waitFor({ state: 'visible', timeout: 10_000 });
  await page.waitForTimeout(300);
  const pickerGeom = await picker.evaluate((el) => {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return { width: r.width, x: r.x, transform: cs.transform, ml: cs.marginLeft };
  });
  check(
    Math.abs(pickerGeom.width - 400) < 0.5 &&
      Math.abs(pickerGeom.x - (1440 - pickerGeom.width) / 2) <= 1 &&
      pickerGeom.transform === 'none',
    `C7 picker 400 宽居中 + transform none（${JSON.stringify(pickerGeom)}）`,
  );

  const topRows = picker.getByRole('button', {
    name: /^(任务|技能|Agents|项目|机器) \(\d+\)$/,
  });
  const topCount = await topRows.count();
  check(topCount === 5, `C8 首层五类目行（${topCount}）`);
  await shot(page, '05-mention-picker-dark.png');
  await picker.getByRole('button', { name: /^项目 \(\d+\)$/ }).click();
  const search = picker.getByPlaceholder('搜索…');
  check(await search.isVisible(), 'C9 钻取层搜索输入在场');
  const drilled = await picker.locator('.mention-row--entry').count();
  check(drilled >= 1, `C10 钻取层实体行 ≥1（${drilled}，钩子类存活面）`);
  await shot(page, '06-mention-drill-dark.png');
  await page.keyboard.press('Escape');
  await picker.waitFor({ state: 'hidden', timeout: 10_000 });
  check(await dialog().isVisible(), 'C11 Esc 分层：只收 picker，dialog 留');
  await dialog().getByRole('button', { name: '关闭' }).click();
  await dialog().waitFor({ state: 'hidden', timeout: 10_000 });

  await page.locator('[data-column="todo"] .todo-card', { hasText: '948 探针任务' }).first().click();
  await page.waitForURL(/\/app\/todo\//, { timeout: 10_000 });
  await page.locator('.detail-head-icon--more').click();
  const menu = page.getByRole('menu', { name: '更多' });
  await menu.waitFor({ state: 'visible', timeout: 10_000 });

  await menu.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
  const moreGeom = await menu.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { top: cs.top, right: cs.right, width: cs.width };
  });
  check(
    moreGeom.top === '39.5px' && moreGeom.right === '96.5px' && moreGeom.width === '220px',
    `D1 more-menu frozen-anchor 实物（${JSON.stringify(moreGeom)}）`,
  );
  const bands = await menu.locator('.more-menu-item').evaluateAll((els) =>
    els.map((el) => Math.round(el.getBoundingClientRect().height)),
  );
  check(
    JSON.stringify(bands) === JSON.stringify([40, 37, 41, 45]),
    `D2 行带 40/37/41/45 实物（${JSON.stringify(bands)}）`,
  );
  check(
    await menu.getByRole('menuitem', { name: '完成' }).isDisabled(),
    'D3 todo 相位 完成 禁用（#318 相位闸）',
  );
  check(
    await menu.getByRole('menuitem', { name: '关闭' }).isEnabled(),
    'D4 todo→closed 现有边 关闭 放行',
  );
  await shot(page, '07-more-menu-dark.png');
  await menu.getByRole('menuitem', { name: '删除' }).click();
  const confirm = page.getByRole('alertdialog');
  await confirm.waitFor({ state: 'visible', timeout: 10_000 });
  check(
    (await confirm.textContent())?.includes('确定删除该任务') === true,
    'D5 删除确认层 canon 文案',
  );
  const backdropZ = await page
    .locator('.overlay-backdrop')
    .evaluate((el) => getComputedStyle(el).zIndex);
  check(backdropZ === '40', `D6 .overlay-backdrop z 档实物 = 40（app.css 机制残段，实测 ${backdropZ}）`);
  await shot(page, '08-delete-confirm-dark.png');
  await confirm.getByRole('button', { name: '取消' }).click();
  await confirm.waitFor({ state: 'hidden', timeout: 10_000 });
  check(true, 'D7 取消收层（卡片保留）');

  const cssFacts = await page.evaluate(() => {
    const tags = [...document.querySelectorAll('style[data-vite-dev-id]')].map((s) =>
      s.getAttribute('data-vite-dev-id'),
    );
    const retiredLoaded = tags.filter((id) =>
      /overlay\/(overlay|mention-picker|slash-menu|attachment-strip)\.css/.test(id ?? ''),
    );

    const retiredSel =
      /\.(more-menu|new-task-|mention-|slash-menu|slash-help|attachment-|delete-confirm-)/;
    const offenders = [];
    for (const sheet of document.styleSheets) {
      const ownerId = sheet.ownerNode?.getAttribute?.('data-vite-dev-id') ?? sheet.href ?? '?';
      const isCarrier = /styles\/(motion|app|tokens|shadcn|fonts)\.css/.test(ownerId);
      let rules;
      try {
        rules = [...sheet.cssRules];
      } catch {
        continue;
      }
      for (const rule of rules) {
        const sel = rule.selectorText ?? '';
        if (retiredSel.test(sel) && !isCarrier) offenders.push({ ownerId, sel });

        if (rule.cssRules) {
          for (const inner of rule.cssRules) {
            const isel = inner.selectorText ?? '';
            if (retiredSel.test(isel) && !isCarrier) offenders.push({ ownerId, sel: isel });
          }
        }
      }
    }
    return { retiredLoaded, offenders };
  });
  extra.cssFacts = cssFacts;
  check(
    cssFacts.retiredLoaded.length === 0,
    `E1 四张退役 CSS 从未加载（${JSON.stringify(cssFacts.retiredLoaded)}）`,
  );
  check(
    cssFacts.offenders.length === 0,
    `E2 退役选择器规则零驻留非 carrier 层（offenders ${cssFacts.offenders.length}）`,
  );

  await page.evaluate(() => localStorage.setItem('cairn-theme', 'light'));
  await gotoBoard();
  const lightRoot = await page.evaluate(() => document.documentElement.classList.contains('light'));
  check(lightRoot, 'F1 亮模根类落地');
  await page.locator('.sidebar-new-task').click();
  await dialog().waitFor({ state: 'visible', timeout: 10_000 });
  const hookAlive = await page.evaluate(
    () => document.querySelector('.new-task-dialog') != null,
  );
  check(hookAlive, 'E3 DOM 钩子类存活面（.new-task-dialog 别名残留合法，#910）');
  await shot(page, '09-dialog-light.png');
  await dialog().getByRole('button', { name: '提及' }).click();
  const pickerLight = page.getByRole('dialog', { name: '提及' });
  await pickerLight.waitFor({ state: 'visible', timeout: 10_000 });
  await page.waitForTimeout(300);
  await shot(page, '10-mention-picker-light.png');
  check(true, 'F2 亮模 dialog + picker 走查（截图为证）');
} catch (err) {
  check(false, `probe 异常：${String(err?.message ?? err)}`);
  try {
    await shot(page, 'error-context.png');
  } catch {

  }
} finally {
  const result = {
    probe: 'drive-948-overlay',
    ticket: '#948',
    stack: { API, WEB },
    checks,
    passed: checks.filter((c) => c.ok).length,
    total: checks.length,
    artifacts,
    extra,
  };
  writeFileSync(join(EVIDENCE, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
  await browser.close();
  console.log(`\n${result.passed}/${result.total} PASS — evidence: ${EVIDENCE}`);
  process.exit(failures > 0 ? 1 : 0);
}
