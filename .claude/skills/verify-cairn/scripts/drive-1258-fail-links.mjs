import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
  process.env.VERIFY_EVIDENCE_DIR ?? join(SCRIPT_REPO, `.claude/verify-evidence/${ts}-1258-fail-links`);
mkdirSync(EVIDENCE, { recursive: true });

const require2 = createRequire(join(REPO, 'apps/server/package.json'));
const Database = require2('better-sqlite3');

const checks = [];
function check(name, ok, detail) {
  checks.push({ name, ok: Boolean(ok), detail: detail ?? null });
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}\n`);
}

async function jget(path) {
  const res = await fetch(`${SERVER}${path}`);
  return { status: res.status, body: await res.json() };
}
async function jpost(path, body, token, method = 'POST') {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${SERVER}${path}`, {
    method,
    headers,
    body: JSON.stringify(body),
  });
  let parsed = null;
  try {
    parsed = await res.json();
  } catch {
    parsed = await res.text();
  }
  return { status: res.status, body: parsed };
}

const ERR_HEAD = '构建失败：远程 shell 预检拒绝（verify-1258 探针假错误）';
const ERR_TAIL = '[1258-probe] 尾部 marker——完整文本必须逐字出现在「原始错误」弹窗里，一个字都不能少。';
const LONG_ERROR = [
  ERR_HEAD,
  '',
  '$ git push origin cairn/conv-verify-1258',
  'To /srv/git/cairn.git',
  ' ! [rejected]        cairn/conv-verify-1258 -> cairn/conv-verify-1258 (non-fast-forward)',
  'error: failed to push some refs to',
  "hint: Updates were rejected because the tip of your current branch is behind",
  "hint: its remote counterpart. If you want to integrate the remote changes,",
  "hint: use 'git pull' before pushing again.",
  'hint: See the git documentation for details.',
  '',
  '上下文：',
  ...Array.from({ length: 12 }, (_, i) => `  · 第 ${i + 1} 段堆栈摘录：at stepRunner (apps/daemon/src/backend/runner.ts:${420 + i * 7}:${11 + i})`),
  '',
  ERR_TAIL,
].join('\n');

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 732 } });

  const teams = await jget('/api/teams');
  const teamId = teams.body?.[0]?.id;
  const prov = await jpost(`/api/teams/${teamId}/providers`, {
    providerId: 'stub-gw',
    label: 'Stub Gateway',
    baseUrl: 'http://127.0.0.1:9/v1',
    api: 'openai-completions',
    authHeader: true,
    compat: { supportsDeveloperRole: false },
    models: [{ id: 'stub-model', name: 'stub-model' }],
  });
  if (![200, 201, 409].includes(prov.status)) throw new Error(`provider ${prov.status}`);
  const apiKey = await jpost(`/api/teams/${teamId}/api-keys`, {
    name: 'verify-1258-machine',
    gitAccess: false,
    mcpAccess: false,
    toolGrants: { read: [], write: [] },
  });
  const apiKeyPlain = apiKey.body?.plaintext ?? apiKey.body?.token;
  if (!apiKeyPlain) throw new Error(`api-key: ${JSON.stringify(apiKey.body)}`);
  const enroll = await jpost(
    '/api/machine/enroll',
    { teamId, name: 'verify-1258-machine', cliVersion: '0.1.0' },
    apiKeyPlain,
  );
  const machineToken = enroll.body?.token;
  const machineId = enroll.body?.id ?? enroll.body?.machineId;
  if (!machineToken || !machineId) throw new Error(`enroll: ${JSON.stringify(enroll.body)}`);
  const agent = await jpost(`/api/teams/${teamId}/agents`, {
    displayName: 'verify-builder-1258',
    provider: 'stub-gw',
    modelId: 'stub-model',
    machineId,
  });
  const agentId = agent.body?.id ?? agent.body?.agentId ?? agent.body?.record?.id;
  if (!agentId) throw new Error(`agent create: ${JSON.stringify(agent.body)}`);
  const project = await jpost('/api/projects', {
    name: '1258-fail-links-probe',
    repoKind: 'hosted',
  });
  const projectId = project.body?.id;
  if (!projectId) throw new Error(`project: ${JSON.stringify(project.body)}`);

  const todo = await jpost(`/api/projects/${projectId}/todos`, {
    title: '1258 失败行探针（查看原始错误）',
    spec: '探针任务：plan 步直接报失败， errorMessage 上 build',
  });
  const todoId = todo.body?.id;
  if (!todoId) throw new Error(`todo create: ${JSON.stringify(todo.body)}`);
  const started = await jpost(`/api/projects/${projectId}/builds`, {
    todoIds: [todoId],
    assignment: { plan: { agentId }, build: { agentId } },
    withPlan: true,
  });
  const buildId = started.body?.builds?.[0]?.id;
  if (!buildId) throw new Error(`build create failed: ${JSON.stringify(started.body)}`);
  const claim = await jpost('/api/machine/tasks/claim', {}, machineToken);
  const step = claim.body?.step?.step ?? claim.body?.step;
  if (step?.kind !== 'plan') throw new Error(`expected plan claim: ${JSON.stringify(claim.body)}`);
  const done = await jpost(
    `/api/machine/done/${step.id}`,
    { status: 'failed', errorMessage: LONG_ERROR, sessionId: `pi-${buildId}` },
    machineToken,
  );
  if (done.status !== 200) throw new Error(`done ${done.status}`);

  const todoRow = await jget(`/api/todos/${todoId}`);
  check('wire: todo phase = failed', todoRow.body?.phase === 'failed', `phase=${todoRow.body?.phase}`);
  const buildRow = await jget(`/api/builds/${buildId}`);
  check(
    'wire: build.errorMessage 全文逐字节',
    buildRow.body?.errorMessage === LONG_ERROR,
    `len=${buildRow.body?.errorMessage?.length ?? 'n/a'} (期望 ${LONG_ERROR.length})`,
  );

  const db = new Database(DB_PATH, { readonly: true });
  const row = db
    .prepare('SELECT "errorMessage" FROM build WHERE id = ?')
    .get(buildId);
  db.close();
  check(
    'sqlite: build.errorMessage 全文逐字节',
    row?.errorMessage === LONG_ERROR,
    `len=${row?.errorMessage?.length ?? 'n/a'}`,
  );

  await page.goto(`${WEB}/app/todo/${todoId}`);
  const failTitle = page.locator('.chat-para--fail');
  await failTitle.waitFor({ state: 'visible', timeout: 15000 });
  check(
    'ui: 失败行渲染（行 title = errorMessage 全文）',
    (await failTitle.textContent()) === LONG_ERROR,
    `len=${(await failTitle.textContent())?.length ?? 'n/a'}`,
  );
  const rawButton = page.getByRole('button', { name: '查看原始错误' });
  check('ui: 查看原始错误是真按钮', (await rawButton.count()) === 1);
  check('ui: 排查指南死链不渲染', (await page.getByText('排查指南').count()) === 0);
  await page.screenshot({ path: join(EVIDENCE, 'fail-row.png'), fullPage: false });

  await rawButton.click();
  const dialog = page.getByRole('dialog', { name: '原始错误' });
  await dialog.waitFor({ state: 'visible', timeout: 5000 });
  const preText = await dialog.locator('[data-testid="fail-raw-error"]').textContent();
  check('ui: 弹窗正文 = errorMessage 全文逐字节（多行不截断）', preText === LONG_ERROR, `len=${preText?.length ?? 'n/a'}`);
  check('ui: 弹窗可见首尾 marker', preText?.startsWith(ERR_HEAD) === true && preText?.endsWith(ERR_TAIL) === true);
  await page.screenshot({ path: join(EVIDENCE, 'raw-error-dialog.png'), fullPage: false });

  await dialog.getByRole('button', { name: '关闭' }).click();
  await dialog.waitFor({ state: 'hidden', timeout: 5000 });
  check('ui: X 关闭收层', true);
  await page.screenshot({ path: join(EVIDENCE, 'dialog-closed.png'), fullPage: false });
} finally {
  await browser.close();
}

const failed = checks.filter((c) => !c.ok).length;
writeFileSync(
  join(EVIDENCE, 'result.json'),
  JSON.stringify(
    {
      probe: 'drive-1258-fail-links',
      ticket: 1258,
      stack: { server: SERVER, web: WEB, db: DB_PATH },
      checks,
      summary: { total: checks.length, failed },
    },
    null,
    2,
  ),
);
console.log(`\n${checks.length - failed}/${checks.length} PASS  evidence: ${EVIDENCE}`);
process.exit(failed === 0 ? 0 : 1);
