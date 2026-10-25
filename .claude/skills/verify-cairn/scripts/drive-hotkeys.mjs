#!/usr/bin/env node

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

  const row = page.locator('.sidebar-row', { hasText: '新任务' });
  await row.waitFor({ state: 'visible', timeout: 8000 });
  const kbdText = await row.locator('.sidebar-kbd').textContent();
  check('sidebar-row-badge', kbdText?.trim() === 'C', `侧栏新任务行角标=${kbdText?.trim() ?? '无'}`);
  await shot(page, '01-sidebar-row.png');

  await row.click();
  await page.waitForSelector('.new-task-dialog', { timeout: 5000 });
  check('row-click-opens', true, '行点击开 dialog');
  await page.keyboard.press('Escape');
  await page.waitForSelector('.new-task-dialog', { state: 'hidden', timeout: 5000 });

  await pressUntil(page, 'c', '.new-task-dialog');
  const titleFocused = await page.evaluate(
    () => document.activeElement?.classList.contains('new-task-spec') ?? false,
  );
  check('c-opens-focused', titleFocused, 'C 开 dialog 且正文框持焦（#394 单字段面）');

  await page.fill('.new-task-spec', titleBoard);
  await page.click('.new-task-save');
  await page.waitForSelector('.new-task-dialog', { state: 'hidden', timeout: 5000 });
  check('board-save', true, 'board 面 C 开 → 保存');
  await shot(page, '02-board-saved.png');

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

  await pressUntil(page, 'Meta+k', page.getByRole('dialog', { name: '搜索' }));
  const searchField = page.getByRole('dialog', { name: '搜索' }).getByRole('textbox');
  await page.keyboard.press('c');
  await page.keyboard.press(' ');

  await page.keyboard.press('Meta+j');
  const dialogCount = await page.locator('.new-task-dialog').count();

  const drawerOpen = await page.locator('.chief-drawer').first().isVisible();
  const typed = await searchField.inputValue();
  check(
    'editable-guard',
    dialogCount === 0 && !drawerOpen && typed === 'c ',
    `输入态:dialog=${dialogCount} drawer开=${drawerOpen} 入框=${JSON.stringify(typed)}`,
  );
  await page.keyboard.press('Escape');

  await pressUntil(page, 'Meta+j', '.chief-drawer');

  const composerFocused = await page.evaluate(
    () => document.activeElement?.getAttribute('data-testid') === 'chief-composer-input',
  );
  check('cmdj-wakes-focused', composerFocused, '⌘J 开抽屉且草稿框持焦');
  await shot(page, '03-chief-drawer.png');
  await page.keyboard.press('Meta+j');
  await page.locator('.chief-drawer').first().waitFor({ state: 'hidden', timeout: 5000 });

  await page.goto(`${WEB}/app/schedules`);
  await page.waitForSelector('.page-shell', { timeout: 15_000 });
  await pressUntil(page, 'c', '.new-task-dialog');
  check('schedules-c-opens', page.url().includes('/app/schedules'), 'schedules 页原地开 dialog');
  await page.fill('.new-task-spec', titleSched);
  await page.click('.new-task-save');
  await page.waitForSelector('.new-task-dialog', { state: 'hidden', timeout: 5000 });
  await shot(page, '04-schedules-saved.png');

  const todos = await getJson(`${SERVER}/api/todos`);
  const apiBoard = Array.isArray(todos) ? todos.find((t) => t.title === titleBoard) : undefined;
  const apiSched = Array.isArray(todos) ? todos.find((t) => t.title === titleSched) : undefined;
  check('api-todo-board', apiBoard != null, `board 面 todo 入 API(id=${apiBoard?.id ?? '缺失'})`);
  check(
    'api-todo-schedules',
    apiSched != null,
    `schedules 全局面 todo 入 API(id=${apiSched?.id ?? '缺失'})`,
  );

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
