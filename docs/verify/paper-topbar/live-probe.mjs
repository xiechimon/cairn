// Live-stack probe for the Paper board top bar (paper-redesign-plan PR 4).
// Stack: verify-pacman launch.mjs (isolated server + vite dev, fresh DB).
//   VERIFY_RUN_DIR=<run dir> node docs/verify/paper-topbar/live-probe.mjs <before|after>
// Seed: one machine (wire played by this script, no daemon, no LLM), two
// hosted projects, three todos; two of them reach `failed` through
// build -> claim -> done(failed). Browser leg: real clicks only.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const label = process.argv[2];
if (label !== 'before' && label !== 'after') throw new Error('usage: live-probe.mjs <before|after>');
const RUN_DIR = process.env.VERIFY_RUN_DIR;
if (!RUN_DIR || !existsSync(join(RUN_DIR, 'ports.json'))) throw new Error('VERIFY_RUN_DIR/ports.json');
const ports = JSON.parse(readFileSync(join(RUN_DIR, 'ports.json'), 'utf8'));
const SERVER = `http://127.0.0.1:${ports.serverPort}`;
const WEB = `http://127.0.0.1:${ports.webPort}`;
const OUT = join(dirname(fileURLToPath(import.meta.url)), 'live');
mkdirSync(OUT, { recursive: true });

const checks = [];
function check(name, ok, detail) {
  checks.push({ name, ok: Boolean(ok), detail: detail ?? null });
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}\n`);
}
async function call(path, body, token, method = body === undefined ? 'GET' : 'POST') {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${SERVER}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed = text;
  try {
    parsed = JSON.parse(text);
  } catch {}
  return { status: res.status, body: parsed };
}

const teamId = (await call('/api/teams')).body?.[0]?.id;
await call(`/api/teams/${teamId}/providers`, {
  providerId: 'stub-gw',
  label: 'Stub Gateway',
  baseUrl: 'http://127.0.0.1:9/v1',
  api: 'openai-completions',
  authHeader: true,
  compat: { supportsDeveloperRole: false },
  models: [{ id: 'stub-model', name: 'stub-model' }],
});
const apiKey = await call(`/api/teams/${teamId}/api-keys`, {
  name: 'verify-paper-topbar',
  gitAccess: false,
  mcpAccess: false,
  toolGrants: { read: [], write: [] },
});
const enroll = await call(
  '/api/machine/enroll',
  { teamId, name: 'verify-paper-topbar', cliVersion: '0.1.0' },
  apiKey.body?.plaintext ?? apiKey.body?.token,
);
const machineToken = enroll.body?.token;
const machineId = enroll.body?.id ?? enroll.body?.machineId;
const agent = await call(`/api/teams/${teamId}/agents`, {
  displayName: 'verify-builder-topbar',
  provider: 'stub-gw',
  modelId: 'stub-model',
  machineId,
});
const agentId = agent.body?.id ?? agent.body?.agentId ?? agent.body?.record?.id;
if (!machineToken || !agentId) throw new Error(`seed: ${JSON.stringify({ enroll, agent })}`);
const projA = (await call('/api/projects', { name: 'paper-topbar-a', repoKind: 'hosted' })).body?.id;
const projB = (await call('/api/projects', { name: 'paper-topbar-b', repoKind: 'hosted' })).body?.id;

async function todo(projectId, title) {
  return (await call(`/api/projects/${projectId}/todos`, { title, spec: title })).body?.id;
}
async function fail(projectId, todoId) {
  const started = await call(`/api/projects/${projectId}/builds`, {
    todoIds: [todoId],
    assignment: { plan: { agentId }, build: { agentId } },
    withPlan: true,
  });
  const buildId = started.body?.builds?.[0]?.id;
  const claim = await call('/api/machine/tasks/claim', {}, machineToken);
  const step = claim.body?.step?.step ?? claim.body?.step;
  const done = await call(
    `/api/machine/done/${step?.id}`,
    { status: 'failed', errorMessage: 'verify-paper-topbar probe failure', sessionId: `pi-${buildId}` },
    machineToken,
  );
  if (done.status !== 200) throw new Error(`done ${done.status}: ${JSON.stringify(done.body)}`);
}

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 732 }, deviceScaleFactor: 2 });
await context.addInitScript(() => localStorage.setItem('pacman-theme', 'light'));
const page = await context.newPage();
const header = page.locator('[data-route="board"] header').first();
const shot = (name, height = 160, width = 1440) =>
  page.screenshot({ path: join(OUT, `${label}-${name}.png`), clip: { x: 0, y: 0, width, height } });

await page.goto(`${WEB}/app`);
await page.locator('.board-column').first().waitFor();
await page.waitForTimeout(500);
await shot('n-zero');
if (label === 'after') {
  check('N=0: quiet line', (await header.getByTestId('needs-you').textContent()) === '没有等你处理的事');
}

const a1 = await todo(projA, 'Paper 顶栏探针 A1（失败）');
const a2 = await todo(projA, 'Paper 顶栏探针 A2（失败）');
await todo(projB, 'Paper 顶栏探针 B1（待开始）');
await fail(projA, a1);
await fail(projA, a2);
const wire = (await call('/api/todos')).body;
const rows = Array.isArray(wire) ? wire : (wire?.todos ?? []);
const failedRows = rows.filter((r) => r.phase === 'failed').length;
check('wire: two todos in failed', failedRows === 2, `failed=${failedRows}`);

await page.goto(`${WEB}/app`);
await page.locator('[data-column="pending"] [data-todo-id]').nth(1).waitFor();
await page.waitForTimeout(500);
await shot('n-pending');
if (label === 'after') {
  const pending = await page.locator('[data-column="pending"]').getByTestId('column-count').textContent();
  const text = await header.getByTestId('needs-you').textContent();
  check('N>0: summary = 待处理 column count', text === `${pending} 项等你处理`, `${text} / column ${pending}`);
  check('topbar height 56', (await header.boundingBox())?.height === 56);

  await header.getByRole('button', { name: '新任务' }).click();
  const dialog = page.getByRole('dialog', { name: '新建任务' });
  await dialog.waitFor();
  check('新任务 pill opens the new-task dialog', await dialog.isVisible());
  await page.waitForTimeout(300);
  await shot('new-task-dialog', 732);
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });

  await header.getByRole('button', { name: '筛选', exact: true }).click();
  await page.getByRole('dialog', { name: '筛选' }).waitFor();
  await page.locator(`[data-project="${projB}"]`).click();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  const filtered = await header.getByTestId('needs-you').textContent();
  check('filter to project B: summary follows the column', filtered === '没有等你处理的事', filtered);
  check('filter badge shows 1', (await page.getByTestId('filter-count').textContent()) === '1');
  await shot('filter-active');

  await page.goto(`${WEB}/app`);
  await page.locator('.board-column').first().waitFor();
  await header.getByRole('link', { name: '定时' }).click();
  await page.waitForURL(/\/app\/schedules/);
  check('定时 navigates to /app/schedules', new URL(page.url()).pathname === '/app/schedules');
}

await page.setViewportSize({ width: 720, height: 732 });
await page.goto(`${WEB}/app`);
await page.locator('.board-column').first().waitFor();
await page.waitForTimeout(500);
await shot('narrow-720', 160, 720);

await browser.close();
writeFileSync(join(OUT, `${label}-checks.json`), `${JSON.stringify(checks, null, 2)}\n`);
const failedChecks = checks.filter((c) => !c.ok).length;
console.log(`${checks.length - failedChecks}/${checks.length} PASS`);
process.exit(failedChecks === 0 ? 0 : 1);
