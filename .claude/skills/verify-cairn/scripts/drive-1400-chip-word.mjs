#!/usr/bin/env node
// verify-cairn probe — #1400 待处理 has one meaning. Live stack, no daemon,
// no LLM. Seeds one project and three todos over REST (fresh `todo`, plus one
// moved to `queued` and one to `confirm` with a direct UPDATE on the scratch
// SQLite: manual gate-phase PATCHes answer 409 on the live server), and a
// once schedule (2030) on the fresh todo. Browser leg with real clicks reads the
// word on every surface:
//   board columns (待开始 holds todo + queued, 待处理 holds confirm),
//   detail header chip (fresh / queued / confirm), ⌘K search row chips,
//   schedule card chip, project task row status.
// --expect=new (default): the todo chip reads 待开始, the queued chip 排队中,
// and no chip reads 待处理. --expect=old: the same reads on the pre-#1400
// build, where both chips read 待处理 (the before half: launch the base
// worktree's stack and point VERIFY_REPO_ROOT + VERIFY_RUN_DIR at it).
// Stack must already run (launch.mjs; coordinates from VERIFY_RUN_DIR/
// ports.json). Evidence (screenshots + result.json + SQLite rows) lands in
// VERIFY_EVIDENCE_DIR; delivery per SKILL.md 证据归档纪律. Exit 1 on any FAIL.
// Proxy env must be unset (loopback through the proxy answers 502).

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const expectArg = process.argv.slice(2).find((a) => a.startsWith('--expect')) ?? '--expect=new';
const EXPECT = expectArg.slice('--expect='.length);
if (!['old', 'new'].includes(EXPECT)) {
  console.error(`unknown mode ${expectArg}: use --expect=old or --expect=new`);
  process.exit(2);
}
const FRESH_WORD = EXPECT === 'old' ? '待处理' : '待开始';
const QUEUED_WORD = EXPECT === 'old' ? '待处理' : '排队中';

const SCRIPT_ROOT = fileURLToPath(new URL('../../../..', import.meta.url));
const ROOT = process.env.VERIFY_REPO_ROOT ? resolve(process.env.VERIFY_REPO_ROOT) : SCRIPT_ROOT;
const RUN_DIR = process.env.VERIFY_RUN_DIR ?? join(ROOT, '.claude', 'verify-run');

let stack;
try {
  stack = JSON.parse(readFileSync(join(RUN_DIR, 'ports.json'), 'utf8'));
} catch {
  console.error(`无栈:${join(RUN_DIR, 'ports.json')} 不存在或损坏。先跑 launch.mjs`);
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
  join(SCRIPT_ROOT, '.claude', 'verify-evidence', `${stamp}-1400-chip-word-${EXPECT}`);
mkdirSync(EVIDENCE, { recursive: true });

const checks = [];
const payloads = {};
let failures = 0;
const check = (ok, label) => {
  checks.push({ ok, label });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
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
  } catch {
    /* non-JSON body */
  }
  return { status: res.status, json, text };
};

const withDb = (readonly, fn) => {
  const requireServer = createRequire(join(ROOT, 'apps', 'server', 'package.json'));
  const Database = requireServer('better-sqlite3');
  const db = new Database(DB_PATH, { readonly });
  try {
    return fn(db);
  } finally {
    db.close();
  }
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 732 }, colorScheme: 'light' });
const shot = (name) => page.screenshot({ path: join(EVIDENCE, name) });

try {
  // —— seed ——————————————————————————————————————————————————————————
  const proj = await api('POST', '/api/projects', { name: 'verify-1400' });
  const projectId = proj.json?.id;
  check(proj.status === 201 || proj.status === 200, `seed: project (id=${projectId})`);
  const mk = async (label) => {
    const res = await api('POST', `/api/projects/${projectId}/todos`, {
      title: `verify 1400 ${label}`,
      spec: `verify 1400 ${label}: #1400 probe prop.`,
    });
    return res.json?.id;
  };
  const fresh = await mk('fresh');
  const queued = await mk('queued');
  const confirm = await mk('confirm');
  check(fresh != null && queued != null && confirm != null, 'seed: three todos over REST');
  withDb(false, (db) => {
    const set = db.prepare('update todo set phase = ? where id = ?');
    set.run('queued', queued);
    set.run('confirm', confirm);
  });
  // A once rule years out: the server scheduler never fires it mid-probe, so
  // the fresh todo stays in `todo`.
  const at = Date.UTC(2030, 0, 1, 1, 0); // 2030-01-01 09:00 +08
  const sched = await api('POST', '/api/schedules', { todoId: fresh, kind: 'once', at });
  check(sched.status === 201, `seed: once schedule on the fresh todo (status ${sched.status})`);
  const rows = withDb(true, (db) =>
    db
      .prepare('select id, title, phase from todo where id in (?, ?, ?) order by title')
      .all(fresh, queued, confirm),
  );
  payloads.todoRows = rows;
  const phaseOf = Object.fromEntries(rows.map((r) => [r.id, r.phase]));
  check(
    phaseOf[fresh] === 'todo' && phaseOf[queued] === 'queued' && phaseOf[confirm] === 'confirm',
    `SQLite: phases todo / queued / confirm (${JSON.stringify(rows)})`,
  );
  const todos = await api('GET', `/api/todos?projectId=${projectId}`);
  payloads.apiTodos = (todos.json ?? []).map((t) => ({ id: t.id, title: t.title, phase: t.phase }));

  // —— board ——————————————————————————————————————————————————————————
  await page.goto(`${WEB}/app`, { waitUntil: 'load' });
  const col = (id) => page.locator(`.board-column[data-column="${id}"]`);
  const card = (id) => page.locator(`[data-todo-id="${id}"]`);
  await card(fresh).first().waitFor({ state: 'visible', timeout: 10_000 });
  check(
    (await col('todo').locator('.board-column-name').textContent()) === '待开始' &&
      (await col('pending').locator('.board-column-name').textContent()) === '待处理',
    'board: column names 待开始 / 待处理',
  );
  check(
    (await col('todo').locator(`[data-todo-id="${fresh}"]`).count()) === 1 &&
      (await col('todo').locator(`[data-todo-id="${queued}"]`).count()) === 1,
    'board: fresh + queued cards sit in 待开始',
  );
  check(
    (await col('pending').locator(`[data-todo-id="${confirm}"]`).count()) === 1,
    'board: confirm card sits in 待处理',
  );
  await shot('01-board.png');

  // —— detail header ————————————————————————————————————————————————————
  const detailChips = {};
  for (const [id, label, want] of [
    [fresh, 'fresh', FRESH_WORD],
    [queued, 'queued', QUEUED_WORD],
    [confirm, 'confirm', '确认'],
  ]) {
    await card(id).locator('a').first().click();
    await page.getByTestId('phase-chip').waitFor({ state: 'visible', timeout: 10_000 });
    const got = ((await page.getByTestId('phase-chip').textContent()) ?? '').trim();
    detailChips[label] = got;
    check(got === want, `detail header (${label}): chip reads ${want} (got ${got})`);
    await shot(`02-detail-${label}.png`);
    await page.goto(`${WEB}/app`, { waitUntil: 'load' });
    await card(fresh).first().waitFor({ state: 'visible', timeout: 10_000 });
  }

  // —— ⌘K search —————————————————————————————————————————————————————————
  const panel = page.getByRole('dialog', { name: '搜索' });
  await page.locator('aside, [role="complementary"]').first().waitFor({ state: 'visible' });
  for (let i = 0; i < 6 && !(await panel.isVisible()); i += 1) {
    await page.keyboard.press('Meta+k');
    await panel.waitFor({ state: 'visible', timeout: 1000 }).catch(() => undefined);
  }
  // Read the rows after the server answers the full query: until then the
  // panel shows client-filtered rows.
  const searched = page.waitForResponse(
    (r) =>
      r.url().includes('/api/search') && new URL(r.url()).searchParams.get('q') === 'verify 1400',
  );
  await page.keyboard.type('verify 1400');
  await searched;
  const todoRows = panel.locator('[data-row-kind="todo"]');
  await todoRows.filter({ hasText: 'verify-1400' }).nth(2).waitFor({ timeout: 10_000 });
  const rowChip = async (label) =>
    (
      (await todoRows
        .filter({ hasText: `verify 1400 ${label}` })
        .locator('[data-tone]')
        .textContent()) ?? ''
    ).trim();
  const searchChips = {
    fresh: await rowChip('fresh'),
    queued: await rowChip('queued'),
    confirm: await rowChip('confirm'),
  };
  payloads.searchChips = searchChips;
  check(
    searchChips.fresh === FRESH_WORD && searchChips.queued === QUEUED_WORD,
    `search: fresh reads ${FRESH_WORD}, queued ${QUEUED_WORD} (${JSON.stringify(searchChips)})`,
  );
  check(searchChips.confirm === '确认', 'search: confirm row reads 确认');
  await shot('03-search.png');
  await page.keyboard.press('Escape');

  // —— schedules ——————————————————————————————————————————————————————————
  await page.goto(`${WEB}/app/schedules`, { waitUntil: 'load' });
  const schedCard = page.locator('.sched-card', { hasText: 'verify 1400 fresh' });
  await schedCard.waitFor({ state: 'visible', timeout: 10_000 });
  const schedChip = ((await schedCard.locator('[data-tone]').textContent()) ?? '').trim();
  check(schedChip === FRESH_WORD, `schedules: fresh card reads ${FRESH_WORD} (got ${schedChip})`);
  await shot('04-schedules.png');

  // —— project page ——————————————————————————————————————————————————————
  await page.goto(`${WEB}/app/project/${projectId}`, { waitUntil: 'load' });
  await page.locator('.page-tab', { hasText: '任务' }).click();
  await page.getByTestId('task-row').first().waitFor({ state: 'visible', timeout: 10_000 });
  const rowStatus = async (label) =>
    (
      (await page
        .getByTestId('task-row')
        .filter({ hasText: `verify 1400 ${label}` })
        .getByTestId('task-status')
        .textContent()) ?? ''
    ).trim();
  const projectStatus = {
    fresh: await rowStatus('fresh'),
    queued: await rowStatus('queued'),
    confirm: await rowStatus('confirm'),
  };
  payloads.projectStatus = projectStatus;
  check(
    projectStatus.fresh === FRESH_WORD && projectStatus.queued === QUEUED_WORD,
    `project rows: fresh reads ${FRESH_WORD}, queued ${QUEUED_WORD} (${JSON.stringify(projectStatus)})`,
  );
  check(projectStatus.confirm === '确认', 'project rows: confirm reads 确认');
  await shot('05-project.png');

  // —— one meaning ————————————————————————————————————————————————————————
  if (EXPECT === 'new') {
    check(
      [
        ...Object.values(detailChips),
        ...Object.values(searchChips),
        ...Object.values(projectStatus),
        schedChip,
      ].every((w) => w !== '待处理'),
      'no chip on detail / search / schedules / project rows reads 待处理',
    );
  }
} catch (err) {
  check(false, `probe error: ${String(err).split('\n')[0]}`);
  await shot('99-crash.png').catch(() => undefined);
} finally {
  await browser.close();
  writeFileSync(
    join(EVIDENCE, 'result.json'),
    JSON.stringify({ probe: 'drive-1400-chip-word', expect: EXPECT, stack, checks, payloads }, null, 2),
  );
  console.log(`\n${checks.length - failures}/${checks.length} PASS  evidence=${EVIDENCE}`);
  process.exit(failures === 0 ? 0 : 1);
}
