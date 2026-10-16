#!/usr/bin/env node
// verify-pacman drive-tags — 固定标签词表 + 无标题面（spec 15 #394 /
// ADR 0002；接替 #309 手动标签面——该面已移除）。
//
// 走真用户路径：看板「新建任务」→ 对话框无标题输入/无标签行（负空间钉）→
// 正文多行保存 → 看板卡标题 = 首行截断（占位标题，server 派生）→ 详情页
// 无标签时 chips 行不渲染（只读律）。
//
// 真值：GET /api/projects/{id}/tags = 固定词表 6 行（播种）/ todo.title =
// 首行截断 / SQLite `tag` 表播种行。EXPECTED_TAGS 是有意独立硬编码的验证
// 镜像——词表漂移（shared FIXED_TAGS 改动）必须让本脚本 FAIL。
//
// 标签播种是 UI + server 面，无需 daemon。set_task_meta 回填面归 server
// vitest（apps/server/test/task-meta.test.ts）。
// 用法：node drive-tags.mjs

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
  process.env.VERIFY_EVIDENCE_DIR ?? join(SCRIPT_REPO, `.claude/verify-evidence/${ts}-tags`);
mkdirSync(EVIDENCE, { recursive: true });

const require2 = createRequire(join(REPO, 'apps/server/package.json'));

/** 固定词表验证镜像（ADR 0002 D4）：与 shared FIXED_TAGS 有意脱钩硬编码。 */
const EXPECTED_TAGS = ['bug', 'feature', 'improvement', 'refactor', 'docs', 'chore'];

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

const extra = {};
const stamp = Date.now() % 100000;
const firstLine = `元信息验证任务 ${stamp}`;
const spec = `${firstLine}\n\n现在的情况：第二行不进标题`;
extra.firstLine = firstLine;

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1440, height: 732 },
  colorScheme: 'dark',
});

try {
  await page.goto(`${WEB}/app`);
  await page.waitForSelector('[data-route="board"]', { timeout: 15_000 });
  check('board-ready', true, '看板 shell 就绪');

  // 标签 chip 的落点（XMON-14 起 = components/ui/tag-chip，落在 registry Badge
  // 上）：类型筛选弹层的选中行是 live 栈上唯一可达的 TagChip 面——#394 起新建
  // 面没有手动标签入口，任务卡上的 chip 要等 agent 回填 tagIds。
  await page.click('.board-type-filter');
  const typeOption = page.locator('.type-filter-option[data-tag="bug"]');
  await typeOption.waitFor({ state: 'visible', timeout: 5000 });
  await typeOption.click();
  const tagChip = typeOption.locator('.tag-chip');
  // 选中态是点击后的重渲染结果——count() 不自动等待，先等可见再读数
  await tagChip
    .first()
    .waitFor({ state: 'visible', timeout: 5000 })
    .catch(() => {});
  const chipCount = await tagChip.count();
  const chipSlot = chipCount > 0 ? await tagChip.first().getAttribute('data-slot') : null;
  const chipBox = chipCount > 0 ? await tagChip.first().boundingBox() : null;
  check(
    'tag-chip-registry',
    chipCount === 1 && chipSlot === 'badge' && Math.round(chipBox?.height ?? 0) === 20,
    `chip n=${chipCount} data-slot=${chipSlot ?? '缺失'} h=${chipBox ? Math.round(chipBox.height) : '缺失'}`,
  );
  await shot(page, '01b-tag-chip.png');
  await typeOption.click(); // 解除选中，回到干净态
  await page.keyboard.press('Escape');

  await page.click('.sidebar-new-task');
  await page.waitForSelector('.new-task-dialog', { timeout: 5000 });

  // 负空间钉：标题输入位与手动标签面不存在
  const noTitleInput = (await page.locator('.new-task-input').count()) === 0;
  const noTagRow = (await page.locator('.new-task-tags').count()) === 0;
  const noTagAdd = (await page.locator('.new-task-tag-add').count()) === 0;
  check('no-title-input', noTitleInput, '标题输入位不存在');
  check('no-tag-ui', noTagRow && noTagAdd, '标签行/添加钮不存在');
  await page.fill('.new-task-spec', spec);
  await shot(page, '01-single-field-dialog.png');

  await page.click('.new-task-save');
  await page.waitForSelector('.new-task-dialog', { state: 'hidden', timeout: 5000 });
  const card = page.locator('[data-column-list="todo"] .todo-card', { hasText: firstLine });
  await card.waitFor({ state: 'visible', timeout: 15_000 });
  check('card-placeholder-title', true, '看板卡标题 = 正文首行（占位）');
  await shot(page, '02-card-placeholder.png');

  // 真值 1：todo.title = 首行（占位派生）；tagIds 空（回填是 agent 面）
  const todos = await getJson(`${SERVER}/api/todos`);
  const apiTodo = Array.isArray(todos) ? todos.find((t) => t.title === firstLine) : undefined;
  check('api-placeholder-title', apiTodo != null, `API todo.title = 首行(${apiTodo?.title ?? '缺失'})`);
  check(
    'api-todo-no-tags',
    Array.isArray(apiTodo?.tagIds) && apiTodo.tagIds.length === 0,
    'tagIds 空（agent 回填前）',
  );
  extra.todoId = apiTodo?.id ?? null;

  // 真值 2：固定词表播种 6 行（API + SQLite 双面）
  const projects = await getJson(`${SERVER}/api/projects`);
  const projectId = Array.isArray(projects) ? (projects[0]?.id ?? null) : null;
  const tags = projectId ? await getJson(`${SERVER}/api/projects/${projectId}/tags`) : [];
  const names = Array.isArray(tags) ? tags.map((t) => t.name) : [];
  check(
    'api-fixed-tags',
    EXPECTED_TAGS.every((n) => names.includes(n)) && names.length === EXPECTED_TAGS.length,
    `播种词表(${names.join('/') || '无'})`,
  );
  const dbTruth = dbQuery((db) => ({
    seeded: projectId
      ? db.prepare('SELECT COUNT(*) AS n FROM tag WHERE projectId = ?').get(projectId)
      : null,
  }));
  check(
    'db-seeded-tags',
    (dbTruth.seeded?.n ?? 0) === EXPECTED_TAGS.length,
    `SQLite tag 播种行(${dbTruth.seeded?.n ?? '?'} 行)`,
  );

  // 真值 3：详情页——无标签则 chips 行不渲染（只读律，无添加 affordance）
  await page.goto(`${WEB}/app/todo/${apiTodo?.id ?? ''}`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.composer, .fresh-block', { timeout: 15_000 });
  const tagsRowCount = await page.locator('.fresh-tags').count();
  check('detail-no-tag-row', tagsRowCount === 0, `无标签时 chips 行不渲染(命中 ${tagsRowCount})`);
  const h2 = (await page.locator('.fresh-title').textContent())?.trim() ?? '';
  check('detail-title', h2 === firstLine, `详情 h2 = 占位标题(${h2 || '空'})`);
  await shot(page, '03-detail-readonly.png');

  // #445 校准反转：看板卡渲染标签 chip（tagged 卡显示，ADR 0002 F4 修订）；
  // 本任务 agent 未回填、无标签——卡面必须零 chip（钉「无标签零占位」律，
  // 防占位空盒或鬼影 chip）。
  await page.goto(`${WEB}/app`);
  await page.waitForSelector('[data-route="board"]', { timeout: 15_000 });
  const cardHasChip = await page
    .locator('[data-column-list="todo"] .todo-card', { hasText: firstLine })
    .locator('[class*="tag-chip"], [data-card-tag]')
    .count();
  check('board-card-no-chip', cardHasChip === 0, `无标签卡零占位(命中 ${cardHasChip} 个)`);
} finally {
  await browser.close();
}

const ok = checks.every((c) => c.ok);
const result = {
  probe: 'tags',
  ok,
  at: new Date().toISOString(),
  stack: { api: SERVER, web: WEB, homeDir: join(RUN_DIR, 'home') },
  checks,
  artifacts,
  ...extra,
};
writeFileSync(join(EVIDENCE, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
process.stdout.write(
  `\nevidence: ${EVIDENCE}\nallOk=${ok}\n${ok ? 'drive tags:PASS' : 'drive tags:FAIL'}\n`,
);
process.exit(ok ? 0 : 1);
