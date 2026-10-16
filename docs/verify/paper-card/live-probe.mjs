// Live-stack probe for the Paper task card (PR 3). Needs a verify-pacman
// stack (launch.mjs, fresh library). Rerun from the repo root:
//   VERIFY_REPO_ROOT=$PWD node .claude/skills/verify-pacman/scripts/launch.mjs
//   node docs/verify/paper-card/live-probe.mjs <outDir>
//   node .claude/skills/verify-pacman/scripts/cleanup.mjs
// Real clicks: the 待开始 column plus opens the new-task dialog and saves the
// first task; the hover 开始 link on a queued card starts it. The other cards
// are seeded over REST and moved with the board's manual phase PATCH. Failed
// and review cards need a real build (the manual PATCH answers 409), so the
// fixture screenshots cover those two faces.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { chromium } from '@playwright/test';

const ROOT = resolve(import.meta.dirname, '../../..');
const OUT = resolve(process.argv[2] ?? join(ROOT, 'docs/verify/paper-card/live'));
mkdirSync(OUT, { recursive: true });
const ports = JSON.parse(readFileSync(join(ROOT, '.claude/verify-run/ports.json'), 'utf8'));
const API = `http://127.0.0.1:${ports.serverPort}`;
const WEB = `http://127.0.0.1:${ports.webPort}`;
const checks = [];
const check = (ok, label) => {
  checks.push({ ok: Boolean(ok), label });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`);
};
const api = async (method, path, body) => {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
await page.addInitScript(() => localStorage.setItem('pacman-theme', 'light'));
await page.goto(`${WEB}/app`);
await page.waitForSelector('.board-column');

// 1. column plus (real click) -> new-task dialog -> save
const plus = page.getByRole('button', { name: '新建任务' });
await page.locator('[data-column="todo"] header').hover();
await page.waitForTimeout(250);
check((await plus.evaluate((el) => getComputedStyle(el).opacity)) === '1', '待开始 header hover shows the plus');
await plus.click();
const dialog = page.getByRole('dialog', { name: '新建任务' });
await dialog.waitFor();
check(true, 'column plus opens the 新建任务 dialog');
const longTitle =
  '把看板任务卡换成 Paper 结构：标题两行截断、元信息单行不换行、按状态的底栏，并且验证超长标题在窄列里的表现';
await page.fill('.new-task-spec', longTitle);
await page.click('.new-task-save');
await dialog.waitFor({ state: 'hidden' });
const firstCard = page.locator('[data-column="todo"] [data-todo-id]').first();
await firstCard.waitFor();
check(true, 'saved task lands in 待开始');

// 2. seed the rest over REST
const projects = (await api('GET', '/api/projects')).json;
const project = (Array.isArray(projects) ? projects : projects.projects)[0];
const renamed = await api('PATCH', `/api/projects/${project.id}`, {
  name: 'pacman-gh-probe-integration-sandbox',
});
check(renamed.status === 200, `rename project to a long name (HTTP ${renamed.status})`);
const tag = await api('POST', `/api/projects/${project.id}/tags`, {
  name: 'improvement-followup',
  color: '#2563eb',
});
check(tag.status === 201 || tag.status === 200, `create tag (HTTP ${tag.status})`);
const seed = [
  { title: '按机器能力推荐并发上限', phase: null, tag: true },
  { title: '侧栏 288px 一级表面与滚动渐隐', phase: 'building', tag: false },
  { title: '实现 #1251：机器能力上报 + 派发能力闸', phase: 'done', tag: false },
  { title: '合并会话分支改动到默认分支', phase: 'closed', tag: false },
  { title: '实现 issue #1138：claim 闸加 agent 级 maxConcurrentTasks', phase: 'confirm', tag: false },
];
const phaseResults = {};
for (const s of seed) {
  const created = await api('POST', `/api/projects/${project.id}/todos`, {
    title: s.title,
    spec: s.title,
    ...(s.tag ? { tagIds: [tag.json.id] } : {}),
  });
  if (s.phase != null) {
    const moved = await api('PATCH', `/api/todos/${created.json.id}`, { phase: s.phase });
    phaseResults[s.phase] = moved.status;
  }
}
writeFileSync(join(OUT, 'phase-patch-status.json'), `${JSON.stringify(phaseResults, null, 2)}\n`);

await page.reload();
await page.waitForSelector('.board-column [data-todo-id]');
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(500);
await page.mouse.move(0, 0);
await page.screenshot({ path: join(OUT, '01-board.png') });

const metaHeights = await page
  .locator('[data-testid="board-scroller"] .todo-card-meta')
  .evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().height)));
check(metaHeights.length === 6 && metaHeights.every((h) => h === 20), `every meta row is one 20px line (${metaHeights.join(',')})`);
const tagIcon = page.locator('[data-card-tag] svg').first();
check((await tagIcon.evaluate((el) => getComputedStyle(el).color)) === 'rgb(37, 99, 235)', 'tag icon carries the tag color');
check((await page.locator('[data-todo-id] .tag-chip').count()) === 0, 'no solid TagChip on cards');
const titleLines = await page
  .locator('.todo-card-title', { hasText: '把看板任务卡换成' })
  .evaluate((el) => Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight)));
check(titleLines === 2, `long title clamps to 2 lines (${titleLines})`);

// 3. hover state + real click on the hover 开始 link
const queued = page.locator('[data-column="todo"] [data-todo-id]', { hasText: '按机器能力推荐并发上限' });
await queued.locator('.todo-card-title').hover();
await page.waitForTimeout(250);
const start = queued.getByRole('button', { name: '开始' });
check((await start.evaluate((el) => getComputedStyle(el).opacity)) === '1', 'hover reveals the 开始 link');
await page.screenshot({ path: join(OUT, '02-board-hover.png') });
// live 开始 = POST /api/todos/:id/orchestrate (#640: the phase stays until the chief acts)
const orchestrate = page.waitForResponse((r) => r.url().includes('/orchestrate'));
await start.click();
const orchestrated = await orchestrate;
check(orchestrated.request().method() === 'POST', `开始 link fires POST ${new URL(orchestrated.url()).pathname} (HTTP ${orchestrated.status()})`);
await page.waitForTimeout(1500);
await page.screenshot({ path: join(OUT, '03-after-start-click.png') });

const todos = (await api('GET', '/api/todos')).json;
writeFileSync(join(OUT, 'api-todos.json'), `${JSON.stringify(todos, null, 2)}\n`);
const require = createRequire(join(ROOT, 'apps/server/package.json'));
const Database = require('better-sqlite3');
const db = new Database(join(ROOT, '.claude/verify-run/home/server/server.db'), { readonly: true });
const rows = db.prepare('select seqNum, title, phase from todo order by seqNum').all();
db.close();
writeFileSync(join(OUT, 'sqlite-todo-rows.json'), `${JSON.stringify(rows, null, 2)}\n`);
check(rows.length === 6, `SQLite holds 6 todo rows (${rows.length})`);

await browser.close();
writeFileSync(join(OUT, 'result.json'), `${JSON.stringify({ web: WEB, api: API, checks }, null, 2)}\n`);
const failed = checks.filter((c) => !c.ok).length;
console.log(`${checks.length - failed}/${checks.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
