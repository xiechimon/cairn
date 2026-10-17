#!/usr/bin/env node
// verify-pacman probe — Paper Grouped sidebar (plan PR 5) live evidence.
// Seeds three projects + todos over REST, moves four todos into gate /
// running / done phases with a direct UPDATE on the scratch SQLite (the
// live server answers 409 to manual gate-phase PATCHes), then walks the
// sidebar with real clicks in the light theme: expanded, 资源 opened,
// 需要我处理 filter (and the chip back out), collapsed rail. Asserts counts
// against the board's own column counts and the URL/aria state.
// Stack must already run (launch.mjs; VERIFY_REPO_ROOT for worktree lanes).
// Evidence (screenshots + result.json) lands in VERIFY_EVIDENCE_DIR.
// Run with the proxy env unset.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const SCRIPT_ROOT = fileURLToPath(new URL('../../../..', import.meta.url));
const ROOT = process.env.VERIFY_REPO_ROOT ? resolve(process.env.VERIFY_REPO_ROOT) : SCRIPT_ROOT;
const RUN_DIR = process.env.VERIFY_RUN_DIR ?? join(ROOT, '.claude', 'verify-run');
const stack = JSON.parse(readFileSync(join(RUN_DIR, 'ports.json'), 'utf8'));
const API = `http://127.0.0.1:${stack.serverPort}`;
const WEB = `http://127.0.0.1:${stack.webPort}`;
const DB_PATH = join(stack.homeDir, 'server', 'server.db');
const EVIDENCE =
  process.env.VERIFY_EVIDENCE_DIR ?? join(ROOT, '.claude', 'verify-evidence', 'paper-sidebar');
mkdirSync(EVIDENCE, { recursive: true });

const checks = [];
let failures = 0;
const check = (ok, label, detail) => {
  checks.push({ ok, label, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail == null ? '' : `  (${detail})`}`);
  if (!ok) failures += 1;
};

const api = async (method, path, body) => {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: body == null ? {} : { 'content-type': 'application/json' },
    body: body == null ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, json };
};

const requireServer = createRequire(join(ROOT, 'apps', 'server', 'package.json'));
const Database = requireServer('better-sqlite3');

// —— seed ——
const PROJECTS = [
  { name: 'pacman', todos: ['侧栏改版验收 A', '侧栏改版验收 B', '侧栏改版验收 C'] },
  { name: 'pacman-gh-probe', todos: ['探针任务 D', '探针任务 E'] },
  { name: '凭证链路验证-一个很长很长的项目名字用来压测截断', todos: ['凭证任务 F'] },
];
const created = [];
for (const p of PROJECTS) {
  const proj = await api('POST', '/api/projects', { name: p.name });
  const projectId = proj.json?.id ?? proj.json?.project?.id;
  check(proj.status < 300 && projectId != null, `POST /api/projects ${p.name}`, proj.status);
  for (const title of p.todos) {
    const todo = await api('POST', `/api/projects/${projectId}/todos`, { title, spec: title });
    const todoId = todo.json?.id ?? todo.json?.todo?.id;
    check(todo.status < 300 && todoId != null, `POST todo ${title}`, todo.status);
    created.push({ projectId, project: p.name, todoId, title });
  }
}
const phases = { '侧栏改版验收 B': 'confirm', '探针任务 D': 'failed', '侧栏改版验收 C': 'building', '凭证任务 F': 'done' };
const db = new Database(DB_PATH);
for (const row of created) {
  const phase = phases[row.title];
  if (phase != null) db.prepare('UPDATE todo SET phase = ? WHERE id = ?').run(phase, row.todoId);
}
const dbRows = db.prepare('SELECT id, title, phase, projectId FROM todo ORDER BY title').all();
db.close();

// —— browser ——
const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 732 },
  deviceScaleFactor: 2,
  colorScheme: 'light',
});
await ctx.addInitScript(() => {
  if (sessionStorage.getItem('verify-seeded') == null) {
    localStorage.setItem('pacman-theme', 'light');
    localStorage.removeItem('pacman.sidebar-collapsed');
    localStorage.removeItem('pacman.sidebarResourcesCollapsed');
    sessionStorage.setItem('verify-seeded', '1');
  }
});
const page = await ctx.newPage();
const aside = page.getByRole('complementary');
const shot = (name) => page.screenshot({ path: join(EVIDENCE, `${name}.png`) });
const columnCount = async (id) =>
  Number(await page.locator(`[data-column="${id}"] [data-testid="column-count"]`).textContent());

await page.goto(`${WEB}/app`);
await page.locator('[data-column="pending"]').waitFor();
await page.waitForTimeout(800);

const width = await aside.evaluate((el) => el.getBoundingClientRect().width);
check(width === 248, 'expanded sidebar is 248px', width);
const pending = await columnCount('pending');
const running = await columnCount('building');
const badge = await aside.getByTestId('attention-badge').textContent();
check(pending === 2 && badge === String(pending), '需要我处理 badge = 待处理 column', `${badge}/${pending}`);
const counts = await page
  .locator('[data-testid="project-row"]')
  .evaluateAll((rows) =>
    rows.map((r) => ({
      name: r.querySelector('[data-testid="project-name"]')?.textContent,
      count: r.querySelector('[data-testid="project-count"]')?.textContent ?? null,
      tile: getComputedStyle(r.querySelector('.project-avatar')).backgroundColor,
    })),
  );
check(
  JSON.stringify(counts.map((c) => c.count)) === JSON.stringify(['3', '2', null]),
  'project rows count unfinished todos (done excluded)',
  JSON.stringify(counts.map((c) => c.count)),
);
const status = await page.getByTestId('machine-status').textContent();
check(status?.endsWith(`执行中 ${running}`), 'user row second line carries the running count', status);
await shot('after-live-expanded');

await aside.getByRole('button', { name: '资源' }).click();
await aside.getByRole('link', { name: '技能' }).waitFor();
check(
  (await page.evaluate(() => localStorage.getItem('pacman.sidebarResourcesCollapsed'))) === '0',
  '资源 open state persisted',
);
await shot('after-live-resources-open');
await page.reload();
await page.locator('[data-column="pending"]').waitFor();
check(await aside.getByRole('link', { name: '技能' }).isVisible(), '资源 stays open after reload');

const needsMe = aside.getByRole('link', { name: /需要我处理/ });
await needsMe.click();
await page.waitForURL(/column=pending/);
await page.waitForTimeout(400);
check((await page.locator('[data-column]').count()) === 1, '需要我处理 shows only the 待处理 column');
check((await needsMe.getAttribute('aria-current')) === 'page', '需要我处理 row is active');
await shot('after-live-needs-me');
await page.getByRole('button', { name: '清除待处理筛选' }).click();
await page.waitForTimeout(300);
check((await page.locator('[data-column]').count()) === 4, 'chip clears back to four columns');
check(!page.url().includes('column='), 'chip drops the column param', page.url());

await aside.getByRole('button', { name: '收起侧边栏' }).click();
await page.waitForTimeout(300);
const railWidth = await aside.evaluate((el) => el.getBoundingClientRect().width);
check(railWidth === 40, 'collapsed rail is 40px', railWidth);
await shot('after-live-collapsed-rail');

await browser.close();
writeFileSync(
  join(EVIDENCE, 'result.json'),
  `${JSON.stringify({ checks, created, dbRows, projectRows: counts, machineStatus: status }, null, 2)}\n`,
);
console.log(`${failures === 0 ? 'ALL PASS' : `${failures} FAIL`}  evidence: ${EVIDENCE}`);
process.exit(failures === 0 ? 0 : 1);
