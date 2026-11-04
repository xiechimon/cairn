#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const SCRIPT_REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const REPO = process.env.VERIFY_REPO_ROOT ?? SCRIPT_REPO;
const RUN_DIR = process.env.VERIFY_RUN_DIR ?? join(REPO, '.claude/verify-run');
const portsFile = join(RUN_DIR, 'ports.json');
if (!existsSync(portsFile)) {
  process.stderr.write('无栈：' + portsFile + ' 不存在或损坏。先跑 launch.mjs\n');
  process.exit(1);
}
const stack = JSON.parse(readFileSync(portsFile, 'utf8'));
const SERVER = 'http://127.0.0.1:' + (stack.serverPort ?? process.env.VERIFY_PORT ?? 8791);
const WEB = 'http://127.0.0.1:' + (stack.webPort ?? process.env.VERIFY_WEB_PORT ?? 5273);
const HOME_DIR = stack.homeDir ?? join(RUN_DIR, 'home');
const DB_PATH = join(HOME_DIR, 'server', 'server.db');
const require2 = createRequire(join(REPO, 'apps/server/package.json'));
const ts = new Date().toISOString().replace(/[:.]/g, '-');
const EVIDENCE =
  process.env.VERIFY_EVIDENCE_DIR ??
  join(SCRIPT_REPO, '.claude/verify-evidence/' + ts + '-1242-project-identity');
mkdirSync(EVIDENCE, { recursive: true });

const checks = [];
function check(name, ok, detail) {
  if (typeof ok !== 'boolean') {
    throw new TypeError('check(' + JSON.stringify(name) + ') 的 ok 位须为 boolean，收到 ' + typeof ok);
  }
  checks.push({ name, ok, detail: detail ?? null });
  process.stdout.write((ok ? 'PASS' : 'FAIL') + '  ' + name + (detail ? '  — ' + detail : '') + '\n');
}
const artifacts = [];
async function shot(page, name) {
  await page.screenshot({ path: join(EVIDENCE, name) });
  artifacts.push(name);
  process.stdout.write('shot  ' + name + '\n');
}
async function saveJson(name, data) {
  writeFileSync(join(EVIDENCE, name), JSON.stringify(data, null, 2));
  artifacts.push(name);
  process.stdout.write('json  ' + name + '\n');
}
async function getJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error('GET ' + url + ' → ' + res.status);
  return res.json();
}
async function sendJson(url, body, method, token) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = 'Bearer ' + token;
  const res = await fetch(url, {
    method: method ?? 'POST',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),

    signal: AbortSignal.timeout(30000),
  });
  const text = await res.text();
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }
  return { status: res.status, body: parsed };
}
function dbRead(fn) {
  const Database = require2('better-sqlite3');
  const db = new Database(DB_PATH, { readonly: true });
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

const LOCAL_REPO = join(RUN_DIR, 'local-repo');
mkdirSync(LOCAL_REPO, { recursive: true });
execFileSync('git', ['-C', LOCAL_REPO, 'init', '-b', 'main'], { stdio: 'pipe' });
execFileSync('git', ['-C', LOCAL_REPO, 'config', 'user.email', 'probe@cairn'], { stdio: 'pipe' });
execFileSync('git', ['-C', LOCAL_REPO, 'config', 'user.name', 'probe-1242'], { stdio: 'pipe' });
writeFileSync(join(LOCAL_REPO, 'README.md'), '# probe-1242 local repo\n');
execFileSync('git', ['-C', LOCAL_REPO, 'add', 'README.md'], { stdio: 'pipe' });
execFileSync('git', ['-C', LOCAL_REPO, 'commit', '-m', 'seed'], { stdio: 'pipe' });

const teams = await getJson(SERVER + '/api/teams');
const teamId = teams[0]?.id;
if (!teamId) throw new Error('无 team——先重 launch（全新库 seed）');

const prov = await sendJson(SERVER + '/api/teams/' + teamId + '/providers', {
  providerId: 'stub-gw',
  label: 'Stub Gateway',
  baseUrl: 'http://127.0.0.1:9/v1',
  api: 'openai-completions',
  authHeader: true,
  compat: { supportsDeveloperRole: false },
  models: [{ id: 'stub-model', name: 'stub-model' }],
});
if (![200, 201, 409].includes(prov.status)) throw new Error('provider → ' + prov.status);

const key = await sendJson(SERVER + '/api/teams/' + teamId + '/api-keys', {
  name: 'identity-probe',
  gitAccess: false,
  mcpAccess: false,
  toolGrants: { read: [], write: [] },
});
const keyPlain = key.body?.plaintext ?? key.body?.record?.plaintext ?? key.body?.token;
if (!keyPlain) throw new Error('api-key 无 plaintext');
const enroll = await sendJson(
  SERVER + '/api/machine/enroll',
  { teamId, name: 'identity-probe-machine', cliVersion: '0.1.0' },
  'POST',
  keyPlain,
);
const machineToken = enroll.body?.token ?? enroll.body?.machine?.token;
const machineId = enroll.body?.machineId ?? enroll.body?.machine?.machineId;
if (enroll.status !== 200 || !machineToken || !machineId) {
  throw new Error('enroll → ' + enroll.status + ' ' + JSON.stringify(enroll.body).slice(0, 300));
}

const agent = await sendJson(SERVER + '/api/teams/' + teamId + '/agents', {
  displayName: '验证员 1242',
  provider: 'stub-gw',
  modelId: 'stub-model',
  machineId,
});
if (![200, 201].includes(agent.status)) {
  throw new Error('agent → ' + agent.status + ' ' + JSON.stringify(agent.body));
}
const AGENT_ID = agent.body?.id ?? agent.body?.agentId ?? agent.body?.record?.id;

const proj = await sendJson(SERVER + '/api/projects', {
  name: 'probe-1242-local',
  kind: 'local',
  localPath: LOCAL_REPO,
});
if (proj.status !== 201) throw new Error('local project → ' + proj.status + ' ' + JSON.stringify(proj.body));
const PROJECT_ID = proj.body?.id;
if (!PROJECT_ID) throw new Error('project 无 id');

const todoTitles = ['转换注记探针', '在飞闸探针', '转换后施工探针'];
const todoIds = [];
for (const title of todoTitles) {
  const t = await sendJson(SERVER + '/api/projects/' + PROJECT_ID + '/todos', {
    title,
    spec: '#1242 ' + title,
  });
  if (t.status !== 201) throw new Error('todo ' + title + ' → ' + t.status);
  todoIds.push(t.body.id);
}

check('S0 铺底：local 项目（scratch 真 git 仓）+ 3 todo + 假机器 enroll', true, 'project=' + PROJECT_ID);

async function claimStep() {
  const claim = await sendJson(SERVER + '/api/machine/tasks/claim', {}, 'POST', machineToken);
  const claimed = claim.body?.step;
  if (!claimed?.step?.id) {
    throw new Error('claim 空手：' + JSON.stringify(claim.body).slice(0, 300));
  }
  return { stepId: claimed.step.id, claimed };
}
async function doneStep(stepId) {
  const res = await sendJson(SERVER + '/api/machine/done/' + stepId, { status: 'success' }, 'POST', machineToken);
  if (res.status !== 200) {
    throw new Error('done → ' + res.status + ' ' + JSON.stringify(res.body).slice(0, 300));
  }
}
async function startBuild(todoId) {
  const res = await sendJson(SERVER + '/api/projects/' + PROJECT_ID + '/builds', {
    todoIds: [todoId],
    assignment: { plan: { agentId: AGENT_ID }, build: { agentId: AGENT_ID } },
    withPlan: false,
  });
  if (res.status !== 201) {
    throw new Error('build → ' + res.status + ' ' + JSON.stringify(res.body).slice(0, 300));
  }
  const buildId = res.body?.builds?.[0]?.id;
  if (!buildId) throw new Error('build 无 id：' + JSON.stringify(res.body));
  return buildId;
}

await startBuild(todoIds[0]);
const claim1 = await claimStep();
check(
  'C1 转换前 claim 载荷 repo = local 形态（cloneUrl = 本机路径）',
  JSON.stringify(claim1.claimed?.project?.repo) ===
    JSON.stringify({ kind: 'local', cloneUrl: LOCAL_REPO }),
  JSON.stringify(claim1.claimed?.project?.repo),
);
await doneStep(claim1.stepId);

const emptyPatch = await sendJson(SERVER + '/api/projects/' + PROJECT_ID, {}, 'PATCH');
check('A1 空 body → 400（五键全缺 = 静默 no-op 族判死）', emptyPatch.status === 400, 'status=' + emptyPatch.status);
const unknownPatch = await sendJson(SERVER + '/api/projects/' + PROJECT_ID, { repoName: 'x' }, 'PATCH');
check('A2 未知字段 → 400（strict 明示拒绝）', unknownPatch.status === 400, 'status=' + unknownPatch.status + ' ' + String(unknownPatch.body?.error).slice(0, 80));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 732 } });
await page.route('**/api.dicebear.com/**', (route) =>
  route.fulfill({
    contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><rect width="24" height="24" fill="#888"/></svg>',
  }),
);
const SETTINGS = WEB + '/app/project/' + PROJECT_ID + '/settings';

await page.goto(SETTINGS);
const nameInput = page.getByRole('textbox', { name: '名称' });
await nameInput.waitFor({ state: 'visible', timeout: 8000 });
await expectValue(nameInput, 'probe-1242-local');
await nameInput.fill('probe-1242-renamed');
const renameRefetched = page.waitForResponse(
  (r) => r.url().includes('/api/projects') && r.request().method() === 'GET',
);
await page.getByRole('button', { name: '保存名称' }).click();
await renameRefetched;
await expectValue(nameInput, 'probe-1242-renamed');
const renamedRow = dbRead((db) =>
  db.prepare('SELECT name FROM project WHERE id = ?').get(PROJECT_ID),
);
check(
  'B1 设置页改名 → PATCH 落库（SQLite 行）+ invalidate 回显新名',
  renamedRow?.name === 'probe-1242-renamed',
  'row.name=' + renamedRow?.name,
);
await page.goto(WEB + '/app');
await page.locator('.todo-card').first().waitFor({ state: 'visible', timeout: 8000 });

const sidebarRow = page.locator('.sidebar-subrow', { hasText: 'probe-1242-renamed' });
const cardChip = page.locator('.todo-card').first().locator('.ml-1.truncate');
await sidebarRow.waitFor({ state: 'visible', timeout: 8000 });
const chipText = (await cardChip.first().innerText()).trim();
check(
  'B2 改名生效于侧栏与卡面（名称纯显示面，projects 面同源收敛）',
  (await sidebarRow.count()) === 1 && chipText === 'probe-1242-renamed',
  'sidebar rows=' + (await sidebarRow.count()) + ' chip=' + chipText,
);
await shot(page, '01-board-renamed.png');

await page.goto(SETTINGS);
const descInput = page.getByRole('textbox', { name: '描述' });
await descInput.waitFor({ state: 'visible', timeout: 8000 });
await descInput.fill('#1242 迁移期描述');
const descRefetched = page.waitForResponse(
  (r) => r.url().includes('/api/projects') && r.request().method() === 'GET',
);
await page.getByRole('button', { name: '保存描述' }).click();
await descRefetched;
await expectValue(descInput, '#1242 迁移期描述');
const descRow = dbRead((db) =>
  db.prepare('SELECT description FROM project WHERE id = ?').get(PROJECT_ID),
);
check('C1 描述落值（SQLite 行 + invalidate 回显）', descRow?.description === '#1242 迁移期描述', 'row=' + descRow?.description);
await descInput.fill('');
const descClearRefetched = page.waitForResponse(
  (r) => r.url().includes('/api/projects') && r.request().method() === 'GET',
);
await page.getByRole('button', { name: '保存描述' }).click();
await descClearRefetched;
await expectValue(descInput, '');
const descRow2 = dbRead((db) =>
  db.prepare('SELECT description FROM project WHERE id = ?').get(PROJECT_ID),
);
check('C2 清空描述 → 列 null（空 ≡ null）', descRow2?.description === null, 'row=' + descRow2?.description);

await startBuild(todoIds[1]);
await page.goto(SETTINGS);
const repoInput = page.getByRole('textbox', { name: 'GitHub 仓库（owner/repo）' });
await repoInput.waitFor({ state: 'visible', timeout: 8000 });

await expectValue(page.getByRole('textbox', { name: '本机加速路径' }), LOCAL_REPO);
await repoInput.fill('octocat/Hello-World');
await page.getByRole('button', { name: '转换' }).click();
const toast = page.getByText('转换失败，请重试。');
await toast.waitFor({ state: 'visible', timeout: 8000 });
const inflightToast = await page.locator('[data-sonner-toast]').first().innerText();
check(
  'D1 有在飞 build 时转换 → 409 + 失败 toast 可见（非静默）',
  inflightToast.includes('in-flight'),
  'toast=' + inflightToast.replace(/\n/g, ' ').slice(0, 120),
);
await shot(page, '02-convert-409-toast.png');
const blockedRow = dbRead((db) =>
  db.prepare('SELECT repoKind FROM project WHERE id = ?').get(PROJECT_ID),
);
check('D2 409 后行未动（仍 local）', blockedRow?.repoKind === 'local', 'repoKind=' + blockedRow?.repoKind);

const claim2 = await claimStep();
await doneStep(claim2.stepId);

await page.getByRole('button', { name: '转换' }).click();

await page
  .getByText('转换为 GitHub 形态', { exact: true })
  .waitFor({ state: 'hidden', timeout: 15000 });
const convRow = dbRead((db) =>
  db.prepare('SELECT repoKind, githubRepo, localPath FROM project WHERE id = ?').get(PROJECT_ID),
);
check(
  'E1 local→github 转换落库：repoKind/githubRepo/localPath（local 绑定转加速位）',
  convRow?.repoKind === 'github' &&
    convRow?.githubRepo === 'octocat/Hello-World' &&
    convRow?.localPath === LOCAL_REPO,
  JSON.stringify(convRow),
);
await page.goto(SETTINGS);
const accel = page.getByRole('textbox', { name: '本机加速路径' });
await accel.waitFor({ state: 'visible', timeout: 8000 });
await expectValue(accel, LOCAL_REPO);
check('E2 转换后设置页：转换卡卸载、基本信息卡加速位行上线（预填原值）', true);
await shot(page, '03-settings-converted.png');
const convRecord = await getJson(SERVER + '/api/projects?teamId=' + teamId);
const converted = convRecord.find((p) => p.id === PROJECT_ID);
check(
  'E3 record 真值：repoKind=github + cloneUrl 切 https 派生',
  converted?.repoKind === 'github' && converted?.cloneUrl === 'https://github.com/octocat/Hello-World.git',
  'cloneUrl=' + converted?.cloneUrl,
);
await saveJson('04-project-record.json', converted);

const noteRows = dbRead((db) =>
  db
    .prepare(
      "SELECT conversationId, role, content FROM message WHERE role = 'system' ORDER BY createdAt",
    )
    .all(),
);
const parsedNotes = noteRows.map((r) => ({
  conversationId: r.conversationId,
  text: JSON.parse(r.content),
}));
const RENAME_NOTE = '项目已从「probe-1242-local」改名为「probe-1242-renamed」。';
const CONVERT_NOTE =
  '项目形态已从 local 转换为 GitHub（octocat/Hello-World，本机加速路径 ' + LOCAL_REPO + '）。';
const renameNotes = parsedNotes.filter((n) => n.text === RENAME_NOTE);
const convertNotes = parsedNotes.filter((n) => n.text === CONVERT_NOTE);
check(
  'E4 board 项目历史注记：改名（todo1 会话）+ 转换（todo1/todo2 会话）各落行（单源文本）',
  renameNotes.length === 1 && convertNotes.length === 2,
  'rename=' + renameNotes.length + ' convert=' + convertNotes.length,
);
await saveJson('05-system-notes.json', parsedNotes);

await page.goto(WEB + '/app/todo/' + todoIds[0]);
const noteLine = page.getByText('项目形态已从 local 转换为 GitHub', { exact: false });
await noteLine.first().waitFor({ state: 'visible', timeout: 8000 });
check('E5 todo 详情 transcript 可见转换注记行（板面可见性）', true);
await shot(page, '06-transcript-note.png');

await startBuild(todoIds[2]);
const claim3 = await claimStep();
check(
  'F1 转换后 claim 载荷 repo = {kind:github, cloneUrl, localPath}（clone 臂 + 加速臂）',
  JSON.stringify(claim3.claimed?.project?.repo) ===
    JSON.stringify({
      kind: 'github',
      cloneUrl: 'https://github.com/octocat/Hello-World.git',
      localPath: LOCAL_REPO,
    }),
  JSON.stringify(claim3.claimed?.project?.repo),
);
await doneStep(claim3.stepId);
await browser.close();

const passCount = checks.filter((c) => c.ok).length;
writeFileSync(
  join(EVIDENCE, 'result.json'),
  JSON.stringify(
    {
      probe: 'drive-1242-project-identity',
      ticket: '#1242',
      stack: { server: SERVER, web: WEB, repo: REPO },
      checks,
      pass: passCount + '/' + checks.length,
      artifacts,
    },
    null,
    2,
  ),
);
process.stdout.write('\nresult  ' + passCount + '/' + checks.length + ' PASS，证据 ' + EVIDENCE + '\n');
if (passCount !== checks.length) process.exit(1);

async function expectValue(locator, value, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const got = await locator.inputValue();
    if (got === value) return;
    if (Date.now() >= deadline) {
      throw new Error('输入值期望 ' + JSON.stringify(value) + '，实际 ' + JSON.stringify(got));
    }
    await new Promise((r) => setTimeout(r, 200));
  }
}
