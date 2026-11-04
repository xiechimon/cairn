#!/usr/bin/env node

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

const now = new Date();
const pad = (n) => String(n).padStart(2, '0');
const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
const EVIDENCE =
  process.env.VERIFY_EVIDENCE_DIR ??
  join(SCRIPT_ROOT, '.claude', 'verify-evidence', `${stamp}-search-project-line`);
mkdirSync(EVIDENCE, { recursive: true });

const FIXTURE_PROJECT = 'r3-lifecycle';
const checks = [];
const extra = {};
let failures = 0;
const check = (ok, label) => {
  checks.push({ ok, label });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) failures += 1;
};
const writeJson = (name, value) =>
  writeFileSync(join(EVIDENCE, name), `${JSON.stringify(value, null, 2)}\n`);

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
const dbRows = () => {
  const Database = createRequire(join(ROOT, 'apps', 'server', 'package.json'))('better-sqlite3');
  const db = new Database(DB_PATH, { readonly: true });
  try {
    return {
      project: db.prepare('SELECT id, name FROM project ORDER BY name').all(),
      todo: db
        .prepare("SELECT id, seqNum, title, projectId FROM todo WHERE title LIKE '副行探针%' ORDER BY seqNum")
        .all(),
    };
  } finally {
    db.close();
  }
};

const seed = [
  { project: 'verify-1400', title: '副行探针 alpha' },
  { project: 'atlas', title: '副行探针 beta' },
];
const expected = {};
for (const { project, title } of seed) {
  const proj = await postJson(`${API}/api/projects`, { name: project, repoKind: 'hosted' });
  await postJson(`${API}/api/projects/${proj.id}/todos`, { title, spec: title });
  expected[title] = project;
}
extra.expected = expected;

const browser = await chromium.launch();
const newPage = () => browser.newPage({ viewport: { width: 1440, height: 732 }, colorScheme: 'dark' });

const panelOf = (page) => page.getByRole('dialog', { name: '搜索' });
const openPanel = async (page) => {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await page.keyboard.press('Meta+k');
    const opened = await panelOf(page)
      .waitFor({ state: 'visible', timeout: 1000 })
      .then(() => true)
      .catch(() => false);
    if (opened) return;
  }
  throw new Error('⌘K 未打开搜索面板(6 次重按后)');
};

const readRows = (page) =>
  panelOf(page)
    .locator('[data-row-kind="todo"]')
    .evaluateAll((rows) =>
      rows.map((row) => {
        const lines = row.querySelector(':scope > span:nth-child(2)')?.children ?? [];
        return { title: lines[0]?.textContent ?? '', project: lines[1]?.textContent ?? null };
      }),
    );
const panelText = async (page) => (await panelOf(page).textContent()) ?? '';
const rowsCarryOwnProject = (rows) =>
  rows.length === seed.length &&
  rows.every((r) => {
    const title = Object.keys(expected).find((t) => r.title.endsWith(t));
    return title !== undefined && r.project === expected[title];
  });
const gotoBoardReady = async (page, { projects = true } = {}) => {
  await page.goto(`${WEB}/app`);
  await page.waitForSelector('[data-route="board"]', { timeout: 15_000 });
  await page.getByText('副行探针 beta').first().waitFor({ timeout: 15_000 });
  if (projects) {
    await page.getByTestId('project-name').filter({ hasText: 'atlas' }).waitFor({ timeout: 15_000 });
  }
};

try {

  {
    const page = await newPage();
    await gotoBoardReady(page);
    await openPanel(page);
    let searchAnsweredAt = null;
    let t0 = 0;
    page.on('response', (res) => {
      if (res.url().includes('/api/search?') && searchAnsweredAt === null)
        searchAnsweredAt = Date.now() - t0;
    });
    t0 = Date.now();
    await panelOf(page).getByRole('textbox').fill('副行探针');
    const samples = [];
    for (const at of [0, 500, 3000]) {
      const wait = at - (Date.now() - t0);
      if (wait > 0) await page.waitForTimeout(wait);
      const rows = await readRows(page);
      samples.push({
        targetMs: at,
        actualMs: Date.now() - t0,
        searchAnswered: searchAnsweredAt !== null && searchAnsweredAt <= Date.now() - t0,
        rows,
        fixtureNameInPanel: (await panelText(page)).includes(FIXTURE_PROJECT),
      });
    }
    extra.naturalTiming = { searchAnsweredAtMs: searchAnsweredAt, samples };
    const first = samples[0];
    check(
      first.searchAnswered === false,
      `N +${first.actualMs}ms 帧在 /api/search 回包前(回包于 +${searchAnsweredAt}ms)`,
    );
    for (const s of samples)
      check(
        rowsCarryOwnProject(s.rows) && !s.fixtureNameInPanel,
        `N +${s.actualMs}ms 每行副行 = 自己的项目(${s.rows.map((r) => `${r.title}→${r.project}`).join(' | ')}),面板无 ${FIXTURE_PROJECT}`,
      );
    await page.screenshot({ path: join(EVIDENCE, '00-natural-3000ms.png') });
    await page.close();
  }

  {
    const page = await newPage();
    const held = [];
    await page.route('**/api/search?*', (route) => {
      held.push(route);
    });
    await gotoBoardReady(page);
    await openPanel(page);
    await panelOf(page).getByRole('textbox').fill('副行');
    for (let i = 0; i < 40 && held.length === 0; i += 1) await page.waitForTimeout(50);
    check(held.length > 0, `H /api/search 请求已发出并被扣住(${held.length} 条)`);
    const pre = await readRows(page);
    extra.heldPreResponse = pre;
    check(
      rowsCarryOwnProject(pre) && !(await panelText(page)).includes(FIXTURE_PROJECT),
      `H 回包前帧:${pre.map((r) => `${r.title}→${r.project}`).join(' | ')},面板无 ${FIXTURE_PROJECT}`,
    );
    await page.screenshot({ path: join(EVIDENCE, '01-pre-response.png') });
    const answered = page.waitForResponse((res) => res.url().includes('/api/search?'));
    for (const route of held.splice(0)) await route.continue();
    await page.unroute('**/api/search?*');
    const res = await answered;
    const server = await res.json();
    writeJson('search-response-browser.json', server);
    await page.waitForTimeout(300);
    const post = await readRows(page);
    extra.serverFrame = post;
    check(
      rowsCarryOwnProject(post) && !(await panelText(page)).includes(FIXTURE_PROJECT),
      `H 服务端帧:${post.map((r) => `${r.title}→${r.project}`).join(' | ')}`,
    );
    check(
      JSON.stringify(pre) === JSON.stringify(post),
      'H 回包前帧与服务端帧逐行相同(副行不跳变)',
    );
    await page.screenshot({ path: join(EVIDENCE, '02-server-frame.png') });
    await page.close();
  }

  {
    const page = await newPage();
    const heldProjects = [];
    const heldSearch = [];
    await page.route('**/api/projects?*', (route) => {
      heldProjects.push(route);
    });
    await page.route('**/api/search?*', (route) => {
      heldSearch.push(route);
    });
    await gotoBoardReady(page, { projects: false });
    await openPanel(page);
    await panelOf(page).getByRole('textbox').fill('副行探针');
    for (let i = 0; i < 40 && heldSearch.length === 0; i += 1) await page.waitForTimeout(50);
    const rows = await readRows(page);
    extra.projectsPending = rows;
    check(
      heldProjects.length > 0 && heldSearch.length > 0,
      `P /api/projects(${heldProjects.length})与 /api/search(${heldSearch.length})均在途`,
    );
    check(
      rows.length === seed.length &&
        rows.every((r) => r.project === null) &&
        !(await panelText(page)).includes(FIXTURE_PROJECT),
      `P 项目读面在途帧:${rows.map((r) => `${r.title}→${r.project}`).join(' | ')}(无副行,无 ${FIXTURE_PROJECT})`,
    );
    await page.screenshot({ path: join(EVIDENCE, '03-projects-pending.png') });
    for (const route of [...heldProjects, ...heldSearch]) await route.continue();
    await page.unroute('**/api/projects?*');
    await page.unroute('**/api/search?*');
    await page.close();
  }

  const teams = await getJson(`${API}/api/teams`);
  const projects = await getJson(`${API}/api/projects?teamId=${teams[0].id}`);
  writeJson('projects-api.json', projects);
  const search = await getJson(`${API}/api/search?q=${encodeURIComponent('副行探针')}`);
  writeJson('search-api.json', search);
  check(
    search.todos.length === seed.length &&
      search.todos.every((t) => expected[t.title] === t.projectName),
    `API /api/search 每行 projectName = 自己的项目(${search.todos.map((t) => `${t.title}→${t.projectName}`).join(' | ')})`,
  );
  const db = dbRows();
  writeJson('sqlite-rows.json', db);
  const nameById = new Map(db.project.map((p) => [p.id, p.name]));
  check(
    db.todo.length === seed.length && db.todo.every((t) => expected[t.title] === nameById.get(t.projectId)),
    `SQLite todo.projectId → project.name 与期望一致(${db.todo.map((t) => `${t.title}→${nameById.get(t.projectId)}`).join(' | ')})`,
  );
} catch (err) {
  check(false, `probe 异常:${err?.message ?? err}`);
} finally {
  await browser.close();
}

writeJson('result.json', {
  probe: 'search-project-line',
  ok: failures === 0,
  passed: checks.filter((c) => c.ok).length,
  total: checks.length,
  checks,
  stack: { api: API, web: WEB },
  ...extra,
});
console.log(`evidence  ${EVIDENCE}`);
console.log(`${checks.filter((c) => c.ok).length}/${checks.length} checks passed`);
process.exit(failures === 0 ? 0 : 1);
