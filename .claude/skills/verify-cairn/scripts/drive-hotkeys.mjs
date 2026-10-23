#!/usr/bin/env node
// verify-cairn drive-hotkeys — 快捷键组全链真用户路径（#389 / #442 / #468）。
//
// 走真用户路径：侧栏「新任务」行（C 角标）点击开 dialog → Esc → C 热键开
// dialog → 填标题保存（board 面 live createTodo）→ FAB 的 ⌘J 悬浮提示
// （#468；XMON-14 起落在 components/ui 的 kbd 落点上）→ ⌘K 面板输入态负向
// （C 与 ⌘J 均不误触）→ ⌘J 呼出总管抽屉且焦点在草稿框（#442 起 ⌘J 取代
// Space）→ /app/schedules 非看板页 C 开全局 dialog 保存（AppSidebar 内面，
// live save 同路）。键位 N → C 见 XMON-41（`drive-newtask-key.mjs` 专测）。
//
// 真值：GET /api/todos 两行（board 面 + schedules 面各一）+ SQLite `todo`
// 表行。UI 面热键 + server 写路径，无需 daemon。
// 用法：node drive-hotkeys.mjs

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const SCRIPT_REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const REPO = process.env.VERIFY_REPO_ROOT ?? SCRIPT_REPO;
const RUN_DIR = process.env.VERIFY_RUN_DIR ?? join(REPO, '.claude/verify-run');
const ports = existsSync(join(RUN_DIR, 'ports.json'))
  ? JSON.parse(readFileSync(join(RUN_DIR, 'ports.json'), 'utf8'))
  : {};
const SERVER = `http://127.0.0.1:${ports.serverPort ?? process.env.VERIFY_PORT ?? 8791}`;
const WEB = `http://127.0.0.1:${ports.webPort ?? process.env.VERIFY_WEB_PORT ?? 5273}`;
const DB_PATH = join(RUN_DIR, 'home/server/server.db');
const ts = new Date().toISOString().replace(/[:.]/g, '-');
const EVIDENCE =
  process.env.VERIFY_EVIDENCE_DIR ?? join(SCRIPT_REPO, `.claude/verify-evidence/${ts}-hotkeys`);
mkdirSync(EVIDENCE, { recursive: true });

const require2 = createRequire(join(REPO, 'apps/server/package.json'));

const checks = [];
function check(name, ok, detail) {
  // 断言位必须真是 boolean（本文件与 drive.mjs 的参数序相反）——写反会恒真。
  if (typeof ok !== 'boolean') {
    throw new TypeError(`check(${JSON.stringify(name)}) 的 ok 位须为 boolean，收到 ${typeof ok}`);
  }
  checks.push({ name, ok, detail: detail ?? null });
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}\n`);
}
const artifacts = [];
const shot = async (page, name) => {
  await page.screenshot({ path: join(EVIDENCE, name) });
  artifacts.push(name);
  process.stdout.write(`shot  ${name}\n`);
};

const getJson = async (url) => {
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
  return res.json();
};

const dbQuery = (fn) => {
  try {
    const Database = require2('better-sqlite3');
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

/** 热键监听注册在被动 effect（hydration 后）——丢键重按，目标可见即停
 *  （e2e search-focus/hotkeys 同配方；open-only 热键重按幂等）。
 *  target 接受 CSS 串或语义 Locator（#1181 起两类并存：search 面板迁
 *  role 载体后传 getByRole('dialog')；串形态走 .first() 保持原
 *  waitForSelector 的首匹配语义，不受 strict mode 拘束）。 */
async function pressUntil(page, key, target) {
  const loc = (typeof target === 'string' ? page.locator(target) : target).first();
  for (let attempt = 0; attempt < 8; attempt += 1) {
    await page.keyboard.press(key);
    const opened = await loc
      .waitFor({ state: 'visible', timeout: 1000 })
      .then(() => true)
      .catch(() => false);
    if (opened) return;
  }
  throw new Error(`${key} never opened ${String(target)}`);
}

const stamp = Date.now() % 100000;
const titleBoard = `热键验证任务-board ${stamp}`;
const titleSched = `热键验证任务-sched ${stamp}`;

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1440, height: 732 },
  colorScheme: 'dark',
});

try {
  await page.goto(`${WEB}/app`);
  await page.waitForSelector('[data-route="board"]', { timeout: 15_000 });
  check('board-ready', true, '看板 shell 就绪');

  // 1. 侧栏「新任务」行 + C 角标（上游 todos.dev 形态，sidebar-kbd 同款）
  const row = page.locator('.sidebar-row', { hasText: '新任务' });
  await row.waitFor({ state: 'visible', timeout: 8000 });
  const kbdText = await row.locator('.sidebar-kbd').textContent();
  check('sidebar-row-badge', kbdText?.trim() === 'C', `侧栏新任务行角标=${kbdText?.trim() ?? '无'}`);
  await shot(page, '01-sidebar-row.png');

  // 2. 行点击开 dialog → Esc 关
  await row.click();
  await page.waitForSelector('.new-task-dialog', { timeout: 5000 });
  check('row-click-opens', true, '行点击开 dialog');
  await page.keyboard.press('Escape');
  await page.waitForSelector('.new-task-dialog', { state: 'hidden', timeout: 5000 });

  // 3. C 热键开 dialog（焦点落标题框，dialog 家族 autofocus 律）→ 保存
  await pressUntil(page, 'c', '.new-task-dialog');
  const titleFocused = await page.evaluate(
    () => document.activeElement?.classList.contains('new-task-spec') ?? false,
  );
  check('c-opens-focused', titleFocused, 'C 开 dialog 且正文框持焦（#394 单字段面）');
  // #394 单字段面：正文单行 = 占位标题派生源（首行截断律）
  await page.fill('.new-task-spec', titleBoard);
  await page.click('.new-task-save');
  await page.waitForSelector('.new-task-dialog', { state: 'hidden', timeout: 5000 });
  check('board-save', true, 'board 面 C 开 → 保存');
  await shot(page, '02-board-saved.png');

  // 3b. FAB 的 ⌘J 悬浮提示（#468）随 #983/#1004/#1008 退役 .kbd-hint
  // 类名，改 registry Tooltip + Kbd 组合承载——探法与 drive-1008 E1 同律：
  // trigger = aria-label 总管 钮，tooltip 壳 = [data-slot="tooltip-content"]，
  // 键帽 = 壳内 [data-slot="kbd"]。静息隐藏（tooltip 未挂载）与悬浮浮出
  // （hover 后可见、键帽 ⌘J）两条可见性律不变。
  const fab = page.getByRole('button', { name: '总管' });
  const tooltip = page.locator('[data-slot="tooltip-content"]');
  const restCount = await tooltip.count();
  check(
    'fab-tooltip-rest-hidden',
    restCount === 0,
    `静息 tooltip 数=${restCount}（未挂载=隐藏）`,
  );
  await fab.hover();
  await tooltip.waitFor({ state: 'visible', timeout: 5000 });
  const tipKbd = await tooltip.locator('[data-slot="kbd"]').textContent();
  check(
    'fab-tooltip-hover-reveals',
    tipKbd?.trim() === '⌘J',
    `悬浮浮出，键帽=${JSON.stringify(tipKbd?.trim() ?? '缺失')}（registry Tooltip+Kbd）`,
  );
  await shot(page, '02b-fab-tooltip.png');
  await page.mouse.move(0, 0);
  await tooltip.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});

  // 4. 输入态负向：⌘K 面板输入框持焦时 C / ⌘J 均不误触，字符照常入框
  // #1166/#1181 载体（#949/#910 裁定后类名退役，与 e2e search-focus.spec.ts
  // 同律）：面板 = role dialog + 可及名「搜索」，输入 = 面板 scope 的 textbox。
  await pressUntil(page, 'Meta+k', page.getByRole('dialog', { name: '搜索' }));
  const searchField = page.getByRole('dialog', { name: '搜索' }).getByRole('textbox');
  await page.keyboard.press('c');
  await page.keyboard.press(' ');
  // ⌘J 的守卫同律：输入态吞键（#442 editable-only guard）
  await page.keyboard.press('Meta+j');
  const dialogCount = await page.locator('.new-task-dialog').count();
  // ADR 0013 D6：抽屉随根 layout 单实例常驻挂载（关态 hidden-but-mounted），
  // 开态判据 = 可见性不是计数——e2e hotkeys.spec「swallows C and ⌘J」同律。
  const drawerOpen = await page.locator('.chief-drawer').first().isVisible();
  const typed = await searchField.inputValue();
  check(
    'editable-guard',
    dialogCount === 0 && !drawerOpen && typed === 'c ',
    `输入态:dialog=${dialogCount} drawer开=${drawerOpen} 入框=${JSON.stringify(typed)}`,
  );
  await page.keyboard.press('Escape');

  // 5. ⌘J 呼出总管抽屉，焦点在草稿框；⌘J toggle 收起（#442 起 ⌘J 取代 Space；
  // ADR 0013 D3：Esc 不收窗，收起走 ⌘J toggle，e2e 同律）
  await pressUntil(page, 'Meta+j', '.chief-drawer');
  // #950 载体：草稿框焦点判定改 data-testid（旧 chief-composer-input 类退役，
  // Textarea 件上只有 data-testid="chief-composer-input"）。
  const composerFocused = await page.evaluate(
    () => document.activeElement?.getAttribute('data-testid') === 'chief-composer-input',
  );
  check('cmdj-wakes-focused', composerFocused, '⌘J 开抽屉且草稿框持焦');
  await shot(page, '03-chief-drawer.png');
  await page.keyboard.press('Meta+j');
  await page.locator('.chief-drawer').first().waitFor({ state: 'hidden', timeout: 5000 });

  // 6. 非看板页（/app/schedules）C 开全局 dialog（AppSidebar 内面）→ 保存
  await page.goto(`${WEB}/app/schedules`);
  await page.waitForSelector('.page-shell', { timeout: 15_000 });
  await pressUntil(page, 'c', '.new-task-dialog');
  check('schedules-c-opens', page.url().includes('/app/schedules'), 'schedules 页原地开 dialog');
  await page.fill('.new-task-spec', titleSched);
  await page.click('.new-task-save');
  await page.waitForSelector('.new-task-dialog', { state: 'hidden', timeout: 5000 });
  await shot(page, '04-schedules-saved.png');

  // 真值 1：API 面两条任务（board 面 + schedules 全局面各一）
  const todos = await getJson(`${SERVER}/api/todos`);
  const apiBoard = Array.isArray(todos) ? todos.find((t) => t.title === titleBoard) : undefined;
  const apiSched = Array.isArray(todos) ? todos.find((t) => t.title === titleSched) : undefined;
  check('api-todo-board', apiBoard != null, `board 面 todo 入 API(id=${apiBoard?.id ?? '缺失'})`);
  check(
    'api-todo-schedules',
    apiSched != null,
    `schedules 全局面 todo 入 API(id=${apiSched?.id ?? '缺失'})`,
  );

  // 真值 2：SQLite 两行
  const dbTruth = dbQuery((db) => ({
    board: db.prepare('SELECT id, title FROM todo WHERE title = ?').get(titleBoard),
    sched: db.prepare('SELECT id, title FROM todo WHERE title = ?').get(titleSched),
  }));
  check('db-todo-board', dbTruth.board != null, 'SQLite todo 表有 board 面行');
  check('db-todo-schedules', dbTruth.sched != null, 'SQLite todo 表有 schedules 面行');
} finally {
  await browser.close();
}

const ok = checks.every((c) => c.ok);
const result = {
  probe: 'hotkeys',
  ok,
  at: new Date().toISOString(),
  stack: { api: SERVER, web: WEB, homeDir: join(RUN_DIR, 'home') },
  checks,
  artifacts,
  titles: { board: titleBoard, schedules: titleSched },
};
writeFileSync(join(EVIDENCE, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
process.stdout.write(
  `\nevidence: ${EVIDENCE}\nallOk=${ok}\n${ok ? 'drive hotkeys:PASS' : 'drive hotkeys:FAIL'}\n`,
);
process.exit(ok ? 0 : 1);
