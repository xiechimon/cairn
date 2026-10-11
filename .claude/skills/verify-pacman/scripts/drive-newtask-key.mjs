#!/usr/bin/env node
// verify-pacman drive-newtask-key — 「新任务」快捷键键位验证（XMON-41）。
//
// 验收标准原文（XMON-41）：把 Pacman 中「新任务」的快捷键改成 `c`。
// 判定：在看板页面、原本新任务快捷键生效的同等场景下，按 `c` 弹出新任务创建
// 入口；旧快捷键不再触发新任务。
//
// 本 probe 只按该标准判读，不引用实现：正向（c 开）与负向（旧键 n 不开）在
// 同一批场景上各跑一遍，场景集 = 快捷键原本生效的三条渲染路径（看板本页 /
// 项目页本页 / 非看板页的 AppSidebar 全局面），外加输入态守卫与侧栏行动作入
// 口（同一 opener 的另一入口）。真值三件套：截图 + `GET /api/todos` 行 +
// SQLite `todo` 表行。
//
// 用法：node drive-newtask-key.mjs [旧键]         # 旧键默认 n
//   基线对照：在旧提交的栈上跑 `node drive-newtask-key.mjs n --expect=old`
//   ——旧栈上 c 不开、n 开，用于证明「同等场景」这一集合在两版之间没有漂移。

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

const NEW_KEY = 'c';
const OLD_KEY = process.argv[2] ?? 'n';
// 基线模式：期望反转（c 不开、旧键开），用于在旧提交上取「同等场景」对照。
const BASELINE = process.argv.includes('--expect=old');

const ts = new Date().toISOString().replace(/[:.]/g, '-');
const EVIDENCE =
  process.env.VERIFY_EVIDENCE_DIR ??
  join(SCRIPT_REPO, `.claude/verify-evidence/${ts}-newtask-key${BASELINE ? '-baseline' : ''}`);
mkdirSync(EVIDENCE, { recursive: true });

const require2 = createRequire(join(REPO, 'apps/server/package.json'));

const checks = [];
function check(name, ok, detail) {
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
const postJson = async (url, body) => {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`POST ${url} → ${res.status}`);
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

const DIALOG = '.new-task-dialog';
const SPEC = '.new-task-spec';

const dialogVisible = async (page) => {
  if ((await page.locator(DIALOG).count()) === 0) return false;
  return page
    .locator(DIALOG)
    .first()
    .isVisible()
    .catch(() => false);
};

/** 热键监听在被动 effect 注册（hydration 后）；丢键重按，目标可见即停。 */
async function pressUntilOpen(page, key, attempts = 8) {
  for (let i = 0; i < attempts; i += 1) {
    await page.keyboard.press(key);
    if (await dialogVisible(page)) return true;
    await page.waitForTimeout(120);
  }
  return false;
}

/** 负向：反复按同一键，弹层**一次都不许出现**（丢键重按不能掩盖真开）。 */
async function pressExpectClosed(page, key, attempts = 5) {
  for (let i = 0; i < attempts; i += 1) {
    await page.keyboard.press(key);
    if (await dialogVisible(page)) return { closed: false, atAttempt: i + 1 };
    await page.waitForTimeout(200);
  }
  return { closed: true, atAttempt: null };
}

async function closeDialog(page) {
  if (await dialogVisible(page)) await page.keyboard.press('Escape');
  await page
    .waitForSelector(DIALOG, { state: 'hidden', timeout: 5000 })
    .catch(() => {});
  await page.waitForTimeout(200);
}

/** 一个场景 = 一次「新键开 / 旧键不开」的正负对，跑在同一页面状态下。 */
async function scenario(page, label, { positive = !BASELINE } = {}) {
  const openKey = positive ? NEW_KEY : OLD_KEY;
  const closedKey = positive ? OLD_KEY : NEW_KEY;
  const tag = positive ? 'new-key' : 'old-key';

  const opened = await pressUntilOpen(page, openKey);
  check(`${label}-${tag}-opens`, opened, `${JSON.stringify(openKey)} → ${DIALOG}=${opened}`);
  if (opened) {
    const focused = await page.evaluate(
      (sel) => document.activeElement?.classList.contains(sel.slice(1)) ?? false,
      SPEC,
    );
    check(`${label}-${tag}-focus`, focused, `${JSON.stringify(openKey)} 开面后正文框持焦=${focused}`);
    await shot(page, `${label}-${tag}-open.png`);
  }
  await closeDialog(page);

  // 负向必须紧跟正向、在同一页面状态下做（否则页面状态不同，结论不可比）。
  const negTag = positive ? 'old-key' : 'new-key';
  const neg = await pressExpectClosed(page, closedKey);
  check(
    `${label}-${negTag}-stays-closed`,
    neg.closed,
    `${JSON.stringify(closedKey)} ×5 → 弹层出现=${!neg.closed}${neg.atAttempt ? `(第 ${neg.atAttempt} 次)` : ''}`,
  );
  await closeDialog(page);
}

const stamp = Date.now() % 100000;
const titleBoard = `热键改键验证-board ${stamp}`;

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1440, height: 732 },
  colorScheme: 'dark',
});

try {
  // —— 场景 1：看板页（AC 点名的「在看板页面」）
  await page.goto(`${WEB}/app`);
  await page.waitForSelector('[data-route="board"]', { timeout: 15_000 });
  check('board-ready', true, '看板 shell 就绪');
  await shot(page, '01-board.png');

  const row = page.locator('.sidebar-row', { hasText: '新任务' });
  await row.first().waitFor({ state: 'visible', timeout: 8000 });

  if (!BASELINE) {
    // 侧栏角标与热键同源（改键应同步）；只作为观测量，AC 未点名，不参与判读基调。
    const badge = (await row.first().locator('.sidebar-kbd').textContent())?.trim();
    check('sidebar-badge-key', badge === 'C', `侧栏「新任务」行角标=${JSON.stringify(badge)}`);
    // 侧栏行点击是同一 opener 的另一入口——改键不该动它。
    await row.first().click();
    const rowOpened = await dialogVisible(page);
    check('sidebar-row-click-opens', rowOpened, `行点击开 ${DIALOG}=${rowOpened}`);
    await closeDialog(page);
  }

  await scenario(page, 'board');

  // —— 场景 2：看板页输入态守卫（原热键在输入态本就不触发，改键须保持）
  // #1166/#1181 载体（#949/#910 裁定后类名退役，与 e2e search-focus.spec.ts
  // 同律）：面板 = role dialog + 可及名「搜索」，输入 = 面板 scope 的 textbox。
  await page.keyboard.press('Meta+k');
  const searchPanel = page.getByRole('dialog', { name: '搜索' });
  await searchPanel.waitFor({ state: 'visible', timeout: 5000 });
  const field = searchPanel.getByRole('textbox');
  await field.click();
  await page.keyboard.press(NEW_KEY);
  const typed = await field.inputValue();
  const guardClosed = !(await dialogVisible(page));
  check(
    'board-input-state-guard',
    typed.includes(NEW_KEY) && guardClosed,
    `输入态按 ${JSON.stringify(NEW_KEY)}：入框=${JSON.stringify(typed)} 弹层=${!guardClosed}`,
  );
  await page.keyboard.press('Escape');
  await searchPanel.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});

  // —— 场景 3：非看板页（AppSidebar 全局面）
  await page.goto(`${WEB}/app/schedules`);
  await page.waitForSelector('.page-shell', { timeout: 15_000 });
  await scenario(page, 'schedules');

  // —— 场景 4：项目页（本页 dialog）
  const teamId = (await getJson(`${SERVER}/api/teams`))[0]?.id;
  const project = await postJson(`${SERVER}/api/projects`, {
    name: `快捷键验证项目 ${stamp}`,
    teamId,
  });
  await page.goto(`${WEB}/app/project/${project.id}`);
  await page.waitForSelector('.page-shell', { timeout: 15_000 });
  check('project-page-ready', page.url().includes(`/app/project/${project.id}`), `项目页=${page.url()}`);
  await scenario(page, 'project');

  if (!BASELINE) {
    // —— 全链真值：新键开面 → 落标题 → 保存 → API + SQLite 双行
    await page.goto(`${WEB}/app`);
    await page.waitForSelector('[data-route="board"]', { timeout: 15_000 });
    const opened = await pressUntilOpen(page, NEW_KEY);
    check('chain-open', opened, `${JSON.stringify(NEW_KEY)} 开面=${opened}`);
    await page.fill(SPEC, titleBoard);
    await page.click('.new-task-save');
    await page
      .waitForSelector(DIALOG, { state: 'hidden', timeout: 8000 })
      .catch(() => {});
    check('chain-saved-closed', !(await dialogVisible(page)), '保存后弹层收起');
    await shot(page, '05-board-saved.png');

    const todos = await getJson(`${SERVER}/api/todos`);
    const hit = Array.isArray(todos) ? todos.find((t) => t.title === titleBoard) : undefined;
    check('api-todo-created', hit != null, `GET /api/todos 命中新任务(id=${hit?.id ?? '缺失'})`);
    const dbTruth = dbQuery((db) => ({
      row: db.prepare('SELECT id, title FROM todo WHERE title = ?').get(titleBoard),
    }));
    check('db-todo-created', dbTruth.row != null, `SQLite todo 表命中=${dbTruth.row != null}`);
  }
} finally {
  await browser.close();
}

const ok = checks.every((c) => c.ok);
const result = {
  probe: 'newtask-key',
  mode: BASELINE ? 'baseline(old-commit)' : 'subject(branch)',
  ok,
  at: new Date().toISOString(),
  stack: { api: SERVER, web: WEB, homeDir: join(RUN_DIR, 'home') },
  keys: { new: NEW_KEY, old: OLD_KEY },
  checks,
  artifacts,
  titles: { board: titleBoard },
};
writeFileSync(join(EVIDENCE, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
process.stdout.write(
  `\nevidence: ${EVIDENCE}\nallOk=${ok}\n${ok ? 'drive newtask-key:PASS' : 'drive newtask-key:FAIL'}\n`,
);
process.exit(ok ? 0 : 1);