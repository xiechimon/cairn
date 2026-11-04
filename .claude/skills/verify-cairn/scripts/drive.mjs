#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { chromium } from '@playwright/test';

const SCRIPT_ROOT = fileURLToPath(new URL('../../../..', import.meta.url));
const ROOT = process.env.VERIFY_REPO_ROOT
  ? resolve(process.env.VERIFY_REPO_ROOT)
  : SCRIPT_ROOT;
const RUN_DIR = process.env.VERIFY_RUN_DIR ?? join(ROOT, '.claude', 'verify-run');

const PROBES = ['board', 'new-task', 'api-key', 'search', 'theme'];
const probe = process.argv[2];
if (!PROBES.includes(probe)) {
  console.error(`用法:node drive.mjs <probe>   probe ∈ ${PROBES.join(' | ')}`);
  process.exit(2);
}

const portsFile = join(RUN_DIR, 'ports.json');
let stack;
try {
  stack = JSON.parse(readFileSync(portsFile, 'utf8'));
} catch {
  console.error(`无栈:${portsFile} 不存在或损坏。先跑 launch.mjs`);
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
  join(SCRIPT_ROOT, '.claude', 'verify-evidence', `${stamp}-${probe}`);
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

const shot = async (page, name, { secrets = [] } = {}) => {
  await page.screenshot({ path: join(EVIDENCE, name), mask: secrets });
  artifacts.push(name);
  console.log(`shot  ${name}`);
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
  if (!res.ok) throw new Error(`POST ${url} → ${res.status}: ${await res.text()}`);
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

try {
  if (probe === 'board') {
    await gotoBoard();

    const title = (await page.locator('.board-topbar-title').textContent())?.trim();
    check(title === '工作台', `顶栏标题 = 工作台(实测 ${title})`);

    const columns = await page.locator('.board-column').count();
    check(columns === 4, `工作台渲染 4 列(实测 ${columns})`);
    const seats = await page.locator('.board-column').evaluateAll((els) =>
      els.map((el) => [
        el.getAttribute('data-column'),
        el.querySelector('.board-column-name')?.textContent?.trim(),
      ]),
    );
    const canon = [
      ['todo', '待开始'],
      ['building', '执行中'],
      ['pending', '待处理'],
      ['done', '已完成'],
    ];
    check(
      JSON.stringify(seats) === JSON.stringify(canon),
      `列序 id↔名对拍(实测 ${seats.map(([id, name]) => `${id}:${name}`).join(' ')})`,
    );

    const retired = await page
      .locator('.board-column-name')
      .evaluateAll((els) =>
        els.map((el) => el.textContent?.trim()).filter((n) => ['规划中', '待确认', '待验收'].includes(n)),
      );
    check(retired.length === 0, `退役列名不渲染(实测 ${retired.join('/') || '无'})`);

    const collapse = await page
      .locator('.board-column-collapse, .board-column-strip, .board-column--collapsed')
      .count();
    check(collapse === 0, `列收起族已删除(实测 ${collapse} 个残留节点)`);

    const widths = await page
      .locator('.board-column')
      .evaluateAll((els) => els.map((el) => el.getBoundingClientRect().width));
    const even = widths.length === 4 && widths.every((w) => Math.abs(w - widths[0]) <= 1);
    check(even && (widths[0] ?? 0) > 0, `4 列等宽(实测 ${widths.map((w) => Math.round(w)).join('/')})`);
    const scroller = await page.locator('.board-scroller').evaluate((el) => ({
      scrollable: el.scrollWidth > el.clientWidth + 1,
      overflowX: getComputedStyle(el).overflowX,
    }));
    check(!scroller.scrollable, '桌面无横向滚动');
    check(scroller.overflowX === 'auto', `窄窗兜底 overflow-x = auto(实测 ${scroller.overflowX})`);

    const pendingEmpty = (
      await page.locator('[data-column="pending"] .board-column-empty').textContent()
    )?.trim();
    check(pendingEmpty === '暂无', `待处理空态文案(实测 ${pendingEmpty})`);

    const newBtn = page.locator('.sidebar-new-task');
    check(await newBtn.isVisible(), '侧栏「新任务」行可见');
    await shot(page, '01-board.png');
  }

  if (probe === 'new-task') {

    const title = `验证任务 ${Date.now() % 100000}`;
    await gotoBoard();
    await shot(page, '01-board-before.png');

    await page.click('.sidebar-new-task');
    await page.waitForSelector('.new-task-dialog', { timeout: 5000 });
    check(true, '新建任务 dialog 打开');

    await page.fill('.new-task-spec', title);
    await page.click('.new-task-save');
    await page.waitForSelector('.new-task-dialog', { state: 'hidden', timeout: 5000 });

    const card = page.locator('[data-column-list="todo"] .todo-card', { hasText: title });
    await card.waitFor({ state: 'visible', timeout: 15_000 });
    const seq = (
      await card.locator('.todo-card-meta').getByText(/^#\d+$/).first().textContent()
    )?.trim();
    check(seq?.startsWith('#') === true, `卡片落「待开始」列,序号 ${seq}`);
    await shot(page, '02-new-task-card.png');

    const todos = await getJson(`${API}/api/todos`);
    const apiTodo = Array.isArray(todos) ? todos.find((t) => t.title === title) : undefined;
    check(
      apiTodo != null && apiTodo.phase === 'todo',
      `GET /api/todos 含新任务(phase=${apiTodo?.phase ?? '缺失'})`,
    );
    extra.apiTodo = apiTodo ?? null;

    const dbTruth = dbQuery((db) => ({
      row: db
        .prepare('SELECT id, title, phase, seqNum FROM todo WHERE title = ?')
        .get(title),
    }));
    check(
      dbTruth.ok && dbTruth.row != null,
      `SQLite todo 表有行(seqNum=${dbTruth.row?.seqNum ?? '缺失'}${dbTruth.skipped ? `,跳过:${dbTruth.reason}` : ''})`,
    );
    extra.dbTodo = dbTruth.row ?? dbTruth.reason ?? null;
  }

  if (probe === 'api-key') {

    await page.goto(`${WEB}/app/api-keys`);

    const keysEmpty = page.getByTestId('keys-empty');
    await keysEmpty.waitFor({ timeout: 15_000 });
    check(true, 'API 密钥页空态就绪');
    await shot(page, '01-keys-empty.png');

    await keysEmpty.getByRole('button', { name: '新建密钥' }).click();

    const createDialog = page.getByRole('dialog', { name: '新建密钥' });
    await createDialog.waitFor({ timeout: 15_000 });
    check(true, '新建密钥弹窗打开(#287 两步流)');
    await shot(page, '02-keys-create-dialog.png');
    await createDialog.getByRole('button', { name: '创建' }).click();
    const onceCode = page.locator('code', { hasText: 'cairn_' });
    await onceCode.waitFor({ timeout: 15_000 });
    const plaintext = (await onceCode.textContent())?.trim();
    check(
      plaintext?.startsWith('cairn_') === true,
      `一次性明文形态 cairn_…(${plaintext?.slice(0, 14)}…,仅显示一次)`,
    );

    const maskedRow = page
      .locator('[data-slot="card"]')
      .filter({ hasText: 'cairn_' })
      .filter({ hasNot: page.locator('code') });
    await maskedRow.first().waitFor({ timeout: 15_000 }).catch(() => {});
    const maskedRows = await maskedRow.count();
    check(maskedRows === 1, `密钥列表出现掩码行(${maskedRows} 行)`);
    await shot(page, '03-keys-once.png', { secrets: [onceCode] });

    const teams = await getJson(`${API}/api/teams`);
    const teamId = teams[0]?.id;
    const keys = await getJson(`${API}/api/teams/${teamId}/api-keys`);
    const masked = Array.isArray(keys) ? keys[0]?.masked : undefined;
    check(masked?.startsWith('cairn_') === true, `API 掩码行(${masked ?? '缺失'})`);
    extra.apiKeyMasked = masked ?? null;

    const dbTruth = dbQuery((db) => ({
      row: db.prepare('SELECT id, name, masked, keyHash FROM api_key').get(),
    }));
    check(
      dbTruth.ok && dbTruth.row?.keyHash != null,
      `SQLite api_key 表存 keyHash 非明文(02 §8 护栏)`,
    );
    extra.dbApiKey = dbTruth.row ?? dbTruth.reason ?? null;
  }

  if (probe === 'search') {

    const title = `搜索目标 ${Date.now() % 100000}`;
    const proj = await postJson(`${API}/api/projects`, {
      name: '搜索验证',
      repoKind: 'hosted',
    });
    await postJson(`${API}/api/projects/${proj.id}/todos`, { title, spec: title });
    await gotoBoard();

    const panel = page.getByRole('dialog', { name: '搜索' });
    for (let attempt = 0; attempt < 6; attempt += 1) {
      await page.keyboard.press('Meta+k');
      const opened = await panel
        .waitFor({ state: 'visible', timeout: 1000 })
        .then(() => true)
        .catch(() => false);
      if (opened) break;
      if (attempt === 5) throw new Error('⌘K 未打开搜索面板(6 次重按后)');
    }
    check(true, '搜索面板打开(⌘K)');
    await panel.getByRole('textbox').fill(title);
    const row = page
      .getByRole('dialog', { name: '搜索' })
      .locator('[data-row-kind="todo"]', { hasText: title });
    await row.first().waitFor({ state: 'visible', timeout: 10_000 });
    check(true, `结果行命中「${title}」`);
    await shot(page, '02-search-results.png');
    extra.searchTarget = title;
  }

  if (probe === 'theme') {

    await gotoBoard();
    await shot(page, '01-theme-default-dark.png');

    await page.evaluate(() => localStorage.setItem('cairn-theme', 'light'));
    await page.reload();
    await page.waitForSelector('[data-route="board"]', { timeout: 15_000 });
    const light = await page.evaluate(() => ({
      theme: document.documentElement.dataset.theme,
      light: document.documentElement.classList.contains('light'),
    }));
    check(
      light.theme === 'light' && light.light === true,
      `light 生效(${JSON.stringify(light)})`,
    );
    await shot(page, '02-theme-light.png');

    await page.evaluate(() => localStorage.setItem('cairn-theme', 'dark'));
    await page.reload();
    await page.waitForSelector('[data-route="board"]', { timeout: 15_000 });
    const dark = await page.evaluate(() => ({
      theme: document.documentElement.dataset.theme,
      light: document.documentElement.classList.contains('light'),
    }));
    check(
      dark.theme === 'dark' && dark.light === false,
      `dark 生效(${JSON.stringify(dark)})`,
    );
    await shot(page, '03-theme-dark.png');
  }
} catch (err) {
  check(false, `probe 异常:${String(err?.message ?? err)}`);
  try {
    await shot(page, '99-error.png');
  } catch {

  }
} finally {
  await browser.close();
}

const ok = failures === 0;
const result = {
  probe,
  ok,
  at: now.toISOString(),
  stack: { api: API, web: WEB, homeDir: stack.homeDir, root: stack.root },
  checks,
  artifacts,
  ...extra,
};
writeFileSync(join(EVIDENCE, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);

console.log(ok ? `drive ${probe}:PASS` : `drive ${probe}:FAIL(${failures} 项)`);
console.log(`evidence:${EVIDENCE}`);
process.exit(ok ? 0 : 1);
