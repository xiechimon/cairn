#!/usr/bin/env node
// Control Glass CLI. One command: scratch CAIRN_HOME, Hono + Vite on the
// verify ports, Playwright along the journeys in features/glass-journeys.md,
// result.json plus screenshots. Launch and cleanup stay in the encyclopedia
// scripts. This file only hardcodes the steps.

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

const REPO = fileURLToPath(new URL('../../../..', import.meta.url));
const LAUNCH = fileURLToPath(
  new URL('../../../../.claude/skills/verify-cairn/scripts/launch.mjs', import.meta.url),
);
const CLEANUP = fileURLToPath(
  new URL('../../../../.claude/skills/verify-cairn/scripts/cleanup.mjs', import.meta.url),
);

const JOURNEYS = ['board', 'create-task', 'dispatch', 'view-diff', 'request-changes', 'merge'];
const DIFF = [
  'diff --git a/src/hello.txt b/src/hello.txt',
  '--- a/src/hello.txt',
  '+++ b/src/hello.txt',
  '@@ -1 +1,2 @@',
  '-old line',
  '+new line',
  '+second line',
  '',
].join('\n');

function parseArgs(argv) {
  const journeys = [];
  let out = null;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--out') {
      out = argv[i + 1];
      if (!out) throw new Error('--out needs a directory');
      i += 1;
      continue;
    }
    if (arg === '--help' || arg === '-h') return { help: true, journeys, out };
    if (!JOURNEYS.includes(arg)) {
      throw new Error(`unknown journey ${arg}. journeys: ${JOURNEYS.join(' | ')}`);
    }
    journeys.push(arg);
  }
  return { help: false, journeys: journeys.length > 0 ? journeys : [...JOURNEYS], out };
}

function stamp() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function runNode(script, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script], {
      cwd: REPO,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (buf) => {
      stdout += buf.toString();
    });
    child.stderr.on('data', (buf) => {
      stderr += buf.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${script} exited ${code}\n${stdout}\n${stderr}`));
    });
  });
}

const result = {
  ok: false,
  journeys: [],
  consoleErrors: [],
  failedRequests: [],
  observations: {},
  stack: null,
  fatal: null,
};
let evidenceDir = null;
let launched = false;
let browser = null;
let code = 1;

try {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(`node .cursor/skills/verify-cairn/scripts/glass.mjs [--out dir] [${JOURNEYS.join(' | ')}]`);
    process.exit(0);
  }

  evidenceDir = args.out
    ? (args.out.startsWith('/') ? args.out : join(REPO, args.out))
    : join(REPO, '.claude', 'verify-evidence', `${stamp()}-glass`);
  mkdirSync(evidenceDir, { recursive: true });

  const env = {
    ...process.env,
    VERIFY_REPO_ROOT: REPO,
    NO_PROXY: '127.0.0.1,localhost',
    no_proxy: '127.0.0.1,localhost',
  };
  delete env.http_proxy;
  delete env.https_proxy;
  delete env.HTTP_PROXY;
  delete env.HTTPS_PROXY;
  delete env.ALL_PROXY;
  delete env.all_proxy;

  console.log('launch');
  await runNode(LAUNCH, env);
  launched = true;

  const runDir = env.VERIFY_RUN_DIR ?? join(REPO, '.claude', 'verify-run');
  const stack = JSON.parse(readFileSync(join(runDir, 'ports.json'), 'utf8'));
  result.stack = {
    serverPort: stack.serverPort,
    webPort: stack.webPort,
    homeDir: stack.homeDir,
  };
  const API = `http://127.0.0.1:${stack.serverPort}`;
  const WEB = `http://127.0.0.1:${stack.webPort}`;

  async function send(method, path, body, token, ok = [200, 201, 202]) {
    const headers = {};
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (token) headers.authorization = `Bearer ${token}`;
    const res = await fetch(`${API}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let parsed = null;
    if (text !== '') {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }
    if (!ok.includes(res.status)) {
      const detail = typeof parsed === 'string' ? parsed : JSON.stringify(parsed);
      throw new Error(`${method} ${path} → ${res.status}: ${detail.slice(0, 500)}`);
    }
    return parsed;
  }

  const session = await send('GET', '/api/auth/session');
  const doctorOk = session?.user?.displayName === 'Owner' || session?.displayName === 'Owner';
  result.observations.doctor = { displayName: session?.user?.displayName ?? session?.displayName ?? null };
  if (!doctorOk) throw new Error(`doctor: session is not Owner (${JSON.stringify(session).slice(0, 200)})`);

  const needsDispatch = args.journeys.includes('dispatch');
  const needsReview = args.journeys.some((id) =>
    ['view-diff', 'request-changes', 'merge'].includes(id),
  );
  const seeded = {};

  if (needsReview || needsDispatch) {
    console.log(needsReview ? 'seed review tasks' : 'seed chief agent');
    const teams = await send('GET', '/api/teams');
    const teamId = teams[0]?.id;
    if (!teamId) throw new Error('seed: no team');
    await send(
      'POST',
      `/api/teams/${teamId}/providers`,
      {
        providerId: 'stub-gw',
        label: 'Stub Gateway',
        baseUrl: 'http://127.0.0.1:9/v1',
        api: 'openai-completions',
        authHeader: true,
        compat: { supportsDeveloperRole: false },
        models: [{ id: 'stub-model', name: 'stub-model' }],
      },
      undefined,
      [200, 201, 409],
    );
    const key = await send('POST', `/api/teams/${teamId}/api-keys`, {
      name: 'glass',
      gitAccess: false,
      mcpAccess: false,
      toolGrants: { read: [], write: [] },
    });
    const keyPlain = key?.plaintext ?? key?.record?.plaintext ?? key?.token;
    if (!keyPlain) throw new Error(`seed: api key missing plaintext (${JSON.stringify(key).slice(0, 200)})`);
    const enroll = await send(
      'POST',
      '/api/machine/enroll',
      { teamId, name: 'glass-machine', cliVersion: '0.1.0' },
      keyPlain,
    );
    const machineToken = enroll?.token ?? enroll?.machine?.token;
    const machineId = enroll?.machineId ?? enroll?.machine?.machineId;
    if (!machineToken || !machineId) {
      throw new Error(`seed: enroll missing token (${JSON.stringify(enroll).slice(0, 300)})`);
    }
    const agent = await send('POST', `/api/teams/${teamId}/agents`, {
      displayName: 'glass-builder',
      provider: 'stub-gw',
      modelId: 'stub-model',
      machineId,
      tools: ['合并分支', '推送分支'],
    });
    const agentId = agent?.id;
    if (!agentId) throw new Error(`seed: agent missing id (${JSON.stringify(agent).slice(0, 200)})`);
    if (needsDispatch) {
      const patched = await send('PATCH', `/api/teams/${teamId}/chief`, {
        agent: { agentId },
      });
      const bound = patched?.chief?.agent?.agentId ?? null;
      if (bound !== agentId) {
        throw new Error(`seed: chief not bound (${JSON.stringify(patched?.chief?.agent ?? null).slice(0, 200)})`);
      }
      result.observations.chief = { agentId };
    }
    if (needsReview) {
    const project = await send('POST', '/api/projects', { name: 'Glass review' });
    const projectId = project?.id;
    if (!projectId) throw new Error(`seed: project missing id (${JSON.stringify(project).slice(0, 200)})`);

    async function claimKind(kind) {
      await send('POST', '/api/machine/presence', {}, machineToken);
      const claim = await send('POST', '/api/machine/tasks/claim', {}, machineToken);
      const step = claim?.step?.step ?? claim?.step;
      if (step?.kind !== kind) {
        throw new Error(`seed: expected ${kind} claim, got ${JSON.stringify(claim).slice(0, 400)}`);
      }
      return step.id;
    }

    async function uploadPlan(stepId) {
      const urls = await send(
        'POST',
        `/api/machine/upload-urls/${stepId}`,
        { files: [{ name: 'plan.md' }] },
        machineToken,
      );
      const up = urls?.uploads?.[0];
      if (!up?.url) throw new Error(`seed: upload-urls missing url (${JSON.stringify(urls).slice(0, 300)})`);
      const path = up.url.replace(/^https?:\/\/[^/]+/, '');
      const put = await fetch(`${API}${path}`, {
        method: 'PUT',
        headers: { authorization: `Bearer ${machineToken}`, 'content-type': 'text/markdown' },
        body: '# plan v1\n\nGlass review plan\n',
      });
      if (!put.ok) throw new Error(`seed: put plan → ${put.status}`);
    }

    async function reviewTodo(title) {
      const todo = await send('POST', `/api/projects/${projectId}/todos`, {
        title,
        spec: title,
      });
      const todoId = todo?.id;
      if (!todoId) throw new Error(`seed: todo missing id (${JSON.stringify(todo).slice(0, 200)})`);
      const build = await send('POST', `/api/projects/${projectId}/builds`, {
        todoIds: [todoId],
        assignment: { plan: { agentId }, build: { agentId } },
        withPlan: true,
      });
      const buildId = build?.builds?.[0]?.id;
      if (!buildId) throw new Error(`seed: build missing id (${JSON.stringify(build).slice(0, 300)})`);
      const planId = await claimKind('plan');
      await uploadPlan(planId);
      await send('POST', `/api/machine/done/${planId}`, { status: 'success' }, machineToken);
      await send('POST', `/api/builds/${buildId}/steps`, { action: 'confirm' });
      const buildStepId = await claimKind('build');
      await send(
        'POST',
        `/api/machine/done/${buildStepId}`,
        { status: 'success', changesDiff: DIFF },
        machineToken,
      );
      const face = await send('GET', `/api/todos/${todoId}`);
      if (face?.phase !== 'review') {
        throw new Error(`seed: ${title} phase=${face?.phase}, expected review`);
      }
      return { todoId, buildId };
    }

    if (args.journeys.includes('view-diff')) seeded.diff = await reviewTodo('Glass diff');
    if (args.journeys.includes('request-changes')) seeded.reject = await reviewTodo('Glass request changes');
    if (args.journeys.includes('merge')) seeded.merge = await reviewTodo('Glass merge');
    result.observations.seed = seeded;
    }
  }

  browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1440, height: 732 },
    colorScheme: 'dark',
  });
  const pushCapped = (list, item) => {
    if (list.length >= 40) return;
    list.push(item);
  };
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    pushCapped(result.consoleErrors, { text: msg.text().slice(0, 500) });
  });
  page.on('pageerror', (err) => {
    pushCapped(result.consoleErrors, { text: String(err?.message ?? err).slice(0, 500), pageerror: true });
  });
  page.on('requestfailed', (req) => {
    pushCapped(result.failedRequests, {
      url: req.url(),
      method: req.method(),
      failure: req.failure()?.errorText ?? 'failed',
    });
  });
  page.on('response', (res) => {
    if (res.status() < 400) return;
    pushCapped(result.failedRequests, {
      url: res.url(),
      method: res.request().method(),
      status: res.status(),
    });
  });

  const shot = async (name) => {
    await page.screenshot({ path: join(evidenceDir, name) });
    console.log(`shot  ${name}`);
    return name;
  };

  function journey(id) {
    const row = { id, ok: true, checks: [], screenshots: [] };
    result.journeys.push(row);
    const check = (ok, label) => {
      row.checks.push({ ok, label });
      console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}: ${label}`);
      if (!ok) row.ok = false;
    };
    return { check, row };
  }

  async function runJourney(id, fn) {
    const ctx = journey(id);
    try {
      await fn(ctx.check, ctx.row);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      try {
        ctx.row.screenshots.push(await shot(`fail-${id}.png`));
      } catch {
        /* page may already be closed */
      }
      ctx.check(false, message);
    }
  }

  async function openBoard() {
    await page.goto(`${WEB}/app`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForSelector('[data-route="board"]', { timeout: 60_000 });
  }

  function dbTodo(title) {
    const requireServer = createRequire(join(REPO, 'apps', 'server', 'package.json'));
    const Database = requireServer('better-sqlite3');
    const db = new Database(join(stack.homeDir, 'server', 'server.db'), { readonly: true });
    try {
      return db.prepare('select id, title, phase from todo where title = ?').get(title) ?? null;
    } finally {
      db.close();
    }
  }

  if (args.journeys.includes('board')) {
    await runJourney('board', async (check, row) => {
    await openBoard();
    row.screenshots.push(await shot('01-board.png'));
    const title = (await page.locator('.board-topbar-title').textContent())?.trim();
    check(title === '工作台', `topbar title = 工作台 (got ${title})`);
    const columns = await page.locator('.board-column').count();
    check(columns === 4, `4 columns (got ${columns})`);
    });
  }

  if (args.journeys.includes('create-task')) {
    await runJourney('create-task', async (check, row) => {
    const title = `Glass created ${stamp()}`;
    await openBoard();
    await page.locator('.sidebar-new-task').click();
    await page.waitForSelector('.new-task-spec', { timeout: 15_000 });
    await page.locator('.new-task-spec').fill(title);
    row.screenshots.push(await shot('02-create-task-dialog.png'));
    await page.locator('.new-task-save').click();
    const card = page.locator('[data-column-list="todo"]').getByText(title, { exact: true });
    await card.waitFor({ timeout: 20_000 });
    await page.locator('.new-task-spec').waitFor({ state: 'hidden', timeout: 10_000 });
    row.screenshots.push(await shot('03-create-task-card.png'));
    check(await card.count() === 1, 'card is in 待开始');
    const todos = await send('GET', '/api/todos');
    const apiRow = (Array.isArray(todos) ? todos : []).find((row) => row.title === title);
    check(apiRow?.phase === 'todo', `GET /api/todos phase=${apiRow?.phase ?? 'missing'}`);
    const dbRow = dbTodo(title);
    check(dbRow?.phase === 'todo', `sqlite phase=${dbRow?.phase ?? 'missing'}`);
    result.observations.createTask = { title, id: apiRow?.id ?? null };
    });
  }

  if (args.journeys.includes('dispatch')) {
    await runJourney('dispatch', async (check, row) => {
    const title = `Glass dispatch ${stamp()}`;
    const teams = await send('GET', '/api/teams');
    const teamId = teams[0]?.id;
    const before = await send('GET', `/api/teams/${teamId}/chief/threads`);
    const beforeCount = Array.isArray(before) ? before.length : 0;
    await openBoard();
    await page.locator('.sidebar-new-task').click();
    await page.waitForSelector('.new-task-spec', { timeout: 15_000 });
    await page.locator('.new-task-spec').fill(title);
    await page.locator('.new-task-start').click();
    const toast = page.getByText('已保存，交给总管编排');
    await toast.waitFor({ timeout: 20_000 });
    row.screenshots.push(await shot('04-dispatch-toast.png'));
    check(await toast.count() > 0, 'toast 已保存，交给总管编排');
    await page.getByRole('button', { name: '总管' }).click();
    const drawer = page.locator('aside.chief-drawer:not([hidden])');
    await drawer.waitFor({ timeout: 15_000 });
    row.screenshots.push(await shot('05-dispatch-chief.png'));
    check(await drawer.count() === 1, 'chief drawer open');
    const after = await send('GET', `/api/teams/${teamId}/chief/threads`);
    const afterCount = Array.isArray(after) ? after.length : 0;
    check(afterCount === beforeCount + 1, `chief threads ${beforeCount} → ${afterCount}`);
    const card = page.locator('[data-column-list="todo"]').getByText(title, { exact: true });
    check(await card.count() === 1, 'card still in 待开始 (no daemon)');
    await page.getByRole('button', { name: '最小化' }).click();
    await drawer.waitFor({ state: 'hidden', timeout: 10_000 });
    result.observations.dispatch = { title, threadsBefore: beforeCount, threadsAfter: afterCount };
    });
  }

  async function openTodo(todoId) {
    await page.goto(`${WEB}/app/todo/${todoId}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForSelector('[data-testid="detail-title"]', { timeout: 30_000 });
  }

  if (args.journeys.includes('view-diff')) {
    await runJourney('view-diff', async (check, row) => {
    await openTodo(seeded.diff.todoId);
    const header = page.getByText('个文件改动');
    await header.waitFor({ timeout: 20_000 });
    await page.getByText('src/hello.txt').first().waitFor({ timeout: 15_000 });
    row.screenshots.push(await shot('06-view-diff.png'));
    check(await header.count() > 0, 'changes header visible');
    check(await page.getByText('src/hello.txt').count() > 0, 'src/hello.txt visible');
    const added = page.locator('[data-kind="add"]').filter({ hasText: 'new line' });
    check(await added.count() > 0, 'added line visible');
    const changes = await send('GET', `/api/builds/${seeded.diff.buildId}/changes`);
    const paths = (changes?.files ?? []).map((file) => file.path);
    check(paths.includes('src/hello.txt'), `changes paths=${paths.join(',') || 'none'}`);
    result.observations.viewDiff = { todoId: seeded.diff.todoId, reported: changes?.reported ?? null, paths };
    });
  }

  if (args.journeys.includes('request-changes')) {
    await runJourney('request-changes', async (check, row) => {
    const feedback = 'Move the close button to the left.';
    await openTodo(seeded.reject.todoId);
    await page.locator('.detail-head-icon--more').click();
    const item = page.locator('.more-menu-item[data-action="reject"]');
    await item.waitFor({ timeout: 10_000 });
    await item.click();
    const dialog = page.getByRole('dialog', { name: '请求修改' });
    await dialog.waitFor({ timeout: 10_000 });
    await dialog.getByRole('textbox').fill(feedback);
    row.screenshots.push(await shot('07-request-changes-dialog.png'));
    await dialog.getByRole('button', { name: '请求修改' }).click();
    await page.waitForFunction(
      () => (document.querySelector('.detail-chip')?.textContent ?? '').includes('规划中'),
      null,
      { timeout: 15_000 },
    );
    row.screenshots.push(await shot('08-request-changes-landed.png'));
    const chip = (await page.locator('.detail-chip').textContent()) ?? '';
    check(chip.includes('规划中'), `chip=${chip.trim()}`);
    const face = await send('GET', `/api/todos/${seeded.reject.todoId}`);
    check(face?.phase === 'planning', `phase=${face?.phase}`);
    check(face?.latestBuildId === seeded.reject.buildId, 'latestBuildId unchanged');
    result.observations.requestChanges = { todoId: seeded.reject.todoId, phase: face?.phase ?? null };
    });
  }

  if (args.journeys.includes('merge')) {
    await runJourney('merge', async (check, row) => {
    await openTodo(seeded.merge.todoId);
    await page.locator('.detail-head-action').click();
    const dialog = page.getByRole('dialog', { name: '完成任务' });
    await dialog.waitFor({ timeout: 10_000 });
    const box = dialog.getByRole('checkbox', { name: '将改动合并到默认分支' });
    await box.waitFor({ timeout: 10_000 });
    row.screenshots.push(await shot('09-merge-dialog.png'));
    check(await box.isChecked(), 'merge checkbox checked');
    await dialog.getByRole('button', { name: '完成' }).click();
    const toast = page.getByText('已发起合并');
    await toast.waitFor({ timeout: 15_000 });
    row.screenshots.push(await shot('10-merge-accepted.png'));
    check(await toast.count() > 0, 'toast 已发起合并');
    const face = await send('GET', `/api/todos/${seeded.merge.todoId}`);
    check(face?.phase === 'review', `phase stays review until a machine finishes (got ${face?.phase})`);
    result.observations.merge = { todoId: seeded.merge.todoId, phase: face?.phase ?? null };
    });
  }

  result.ok = result.journeys.every((row) => row.ok);
  code = result.ok ? 0 : 1;
} catch (err) {
  result.fatal = err instanceof Error ? err.message : String(err);
  result.ok = false;
  code = 1;
  console.error(result.fatal);
} finally {
  if (browser) await browser.close().catch(() => {});
  if (evidenceDir) {
    writeFileSync(join(evidenceDir, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
    console.log(`evidence  ${evidenceDir}`);
  }
  if (launched) {
    console.log('cleanup');
    await runNode(CLEANUP, {
      ...process.env,
      VERIFY_REPO_ROOT: REPO,
    }).catch((err) => {
      console.error(err instanceof Error ? err.message : String(err));
    });
  }
}

console.log(result.ok ? 'PASS' : 'FAIL');
process.exit(code);
