#!/usr/bin/env node

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
  process.stderr.write('无栈：' + portsFile + ' 不存在。先跑 launch.mjs\n');
  process.exit(1);
}
const stack = JSON.parse(readFileSync(portsFile, 'utf8'));
const SERVER = 'http://127.0.0.1:' + (stack.serverPort ?? 8791);
const WEB = 'http://127.0.0.1:' + (stack.webPort ?? 5273);
const HOME_DIR = stack.homeDir ?? join(RUN_DIR, 'home');
const DB_PATH = join(HOME_DIR, 'server', 'server.db');
const require2 = createRequire(join(REPO, 'apps/server/package.json'));
const ts = new Date().toISOString().replace(/[:.]/g, '-');
const EVIDENCE =
  process.env.VERIFY_EVIDENCE_DIR ??
  join(SCRIPT_REPO, '.claude/verify-evidence/' + ts + '-1259-1260-binding');
mkdirSync(EVIDENCE, { recursive: true });

const checks = [];
function check(name, ok, detail) {
  if (typeof ok !== 'boolean') throw new TypeError('check() ok 位须 boolean：' + name);
  checks.push({ name, ok, detail: detail ?? null });
  process.stdout.write((ok ? 'PASS' : 'FAIL') + '  ' + name + (detail ? '  — ' + detail : '') + '\n');
}
const artifacts = [];
async function shot(page, name) {
  await page.screenshot({ path: join(EVIDENCE, name), fullPage: true });
  artifacts.push(name);
  process.stdout.write('shot  ' + name + '\n');
}
function saveJson(name, data) {
  writeFileSync(join(EVIDENCE, name), JSON.stringify(data, null, 2));
  artifacts.push(name);
  process.stdout.write('json  ' + name + '\n');
}

async function getJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error('GET ' + url + ' → ' + res.status);
  return res.json();
}
async function sendJson(url, body, method, token, timeoutMs) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = 'Bearer ' + token;
  const res = await fetch(url, {
    method: method ?? 'POST',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs ?? 8000),
  });
  const text = await res.text();
  try {
    return { status: res.status, body: JSON.parse(text) };
  } catch {
    return { status: res.status, body: text };
  }
}
function db(fn, readonly = true) {
  const Database = require2('better-sqlite3');
  const d = new Database(DB_PATH, { readonly });
  try {
    return fn(d);
  } finally {
    d.close();
  }
}

const HOME_NAME = 'verify-home-1259';
const OTHER_NAME = 'verify-other-1259';

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
if (prov.status !== 201 && prov.status !== 200) throw new Error('provider 铺底失败 ' + prov.status);

async function newApiKey(name) {
  const res = await sendJson(SERVER + '/api/teams/' + teamId + '/api-keys', {
    name,
    gitAccess: false,
    mcpAccess: false,
    toolGrants: { read: [], write: [] },
  });
  const plain = res.body?.plaintext ?? res.body?.record?.plaintext ?? res.body?.token;
  if (!plain) throw new Error('api-key 无 plaintext：' + JSON.stringify(res.body).slice(0, 200));
  return plain;
}

async function enroll(name, key, claudeModels) {
  const res = await sendJson(
    SERVER + '/api/machine/enroll',
    {
      teamId,
      name,
      cliVersion: '0.1.0',
      claudeCode: {
        installed: true,
        hostname: name,
        models: claudeModels.map((m) => ({ id: m, name: m, slot: 'default' })),
      },
    },
    'POST',
    key,
  );
  const token = res.body?.token ?? res.body?.machine?.token;
  if ((res.status !== 200 && res.status !== 201) || !token)
    throw new Error('enroll ' + name + ' → ' + res.status);
  return { token, name };
}

const keyA = await newApiKey('verify-a');
const keyB = await newApiKey('verify-b');
const home = await enroll(HOME_NAME, keyA, ['stub-cc-model']);
const other = await enroll(OTHER_NAME, keyB, ['stub-cc-other']);
const machineRows = await getJson(SERVER + '/api/teams/' + teamId + '/machines');
home.id = machineRows.find((m) => m.name === HOME_NAME)?.id;
other.id = machineRows.find((m) => m.name === OTHER_NAME)?.id;
check('铺底：双机 enroll（各持各 key）', home.id != null && other.id != null, `home=${home.id} other=${other.id}`);
if (!home.id || !other.id) throw new Error('机器行缺失');

for (const id of [home.id, other.id]) {
  const r = await sendJson(SERVER + '/api/machines/' + id, { enabledRuntimes: ['pi', 'claude-code'] }, 'PATCH');
  if (r.status !== 200) throw new Error('开 runtime 失败 ' + id);
}

const agentRes = await sendJson(SERVER + '/api/teams/' + teamId + '/agents', {
  displayName: 'verify-bound-agent',
  description: '绑定探针',
  provider: 'stub-gw',
  modelId: 'stub-model',
  machineId: home.id,
});
check('A0 创建 agent（归属机 = home）→ 201', agentRes.status === 201, JSON.stringify(agentRes.body).slice(0, 120));
const agentId = agentRes.body.id;

const noHome = await sendJson(SERVER + '/api/teams/' + teamId + '/agents', {
  displayName: 'verify-nohome-agent',
  provider: 'stub-gw',
  modelId: 'stub-model',
});
check('A0b 创建缺 machineId → 400', noHome.status === 400);

const bind = await sendJson(SERVER + '/api/teams/' + teamId + '/chief', { agent: { agentId } }, 'PATCH');
check('A1 chief 绑定 agent → 200', bind.status === 200);

const proj = await sendJson(SERVER + '/api/projects', { name: 'verify-1259' });
if (proj.status !== 201) throw new Error('建项目失败');
const todoRes = await sendJson(SERVER + '/api/projects/' + proj.body.id + '/todos', {
  title: '绑定探针任务',
  spec: '验证归属机派发',
});
const buildRes = await sendJson(SERVER + '/api/projects/' + proj.body.id + '/builds', {
  todoIds: [todoRes.body.id],
  assignment: { plan: null, build: { agentId } },
  withPlan: false,
});
if (buildRes.status !== 201) throw new Error('起 build 失败 ' + JSON.stringify(buildRes.body));

const turn = await sendJson(SERVER + '/api/teams/' + teamId + '/chief/threads', { content: '归属机路由探针。' });
if (turn.status !== 201) throw new Error('chief 回合失败 ' + JSON.stringify(turn.body));
const threadId = turn.body.thread.id;

async function claim(token, timeoutMs = 100_000) {
  const res = await sendJson(SERVER + '/api/machine/tasks/claim', {}, 'POST', token, timeoutMs);
  if (res.status !== 200) throw new Error('claim → ' + res.status);
  return res.body.step;
}

const otherClaim = await claim(other.token);
check('A2 别机 claim 空手（worker 步 + chief 步都不投它）', otherClaim === null);

const homeClaim1 = await claim(home.token);
check('A3 归属机领到 build 步', homeClaim1?.step?.kind === 'build', homeClaim1?.step?.kind);
check('A3b 载荷 agent.modelId = 自身配置（stub-model）', homeClaim1?.agent?.modelId === 'stub-model');
const homeClaim2 = await claim(home.token);
check('A4 归属机领到 chief 步（降级后 = 绑定 Agent 归属机路由）', homeClaim2?.step?.kind === 'chief', homeClaim2?.step?.kind);
check('A4b chief 载荷模型 = 绑定 Agent 自身（无覆盖槽）', homeClaim2?.agent?.modelId === 'stub-model');
saveJson('a-claims.json', { homeClaim1, homeClaim2 });

const cap = await sendJson(SERVER + '/api/machines/' + home.id, { maxConcurrent: 1 }, 'PATCH');
if (cap.status !== 200) throw new Error('设 cap 失败');
const capClaim = await claim(home.token);
check('B1 cap 1 + chief 在跑 → 归属机 claim 空手（chief 步占槽）', capClaim === null);
await sendJson(SERVER + '/api/machines/' + home.id, { maxConcurrent: 3 }, 'PATCH');

const ccAgent = await sendJson(SERVER + '/api/teams/' + teamId + '/agents', {
  displayName: 'verify-cc-agent',
  provider: 'claude-code',
  modelId: 'stub-cc-model',
  machineId: home.id,
});
check('C0 创建 claude-code agent（home 有该模型）→ 201', ccAgent.status === 201, JSON.stringify(ccAgent.body).slice(0, 160));
const ccReject = await sendJson(
  SERVER + '/api/teams/' + teamId + '/agents/' + ccAgent.body.id,
  { machineId: other.id },
  'PATCH',
);
check(
  'C1 换绑到缺模型的机器 → 400 指名模型',
  ccReject.status === 400 && JSON.stringify(ccReject.body).includes('stub-cc-model'),
  JSON.stringify(ccReject.body).slice(0, 200),
);

const rebind = await sendJson(
  SERVER + '/api/teams/' + teamId + '/agents/' + agentId,
  { machineId: other.id },
  'PATCH',
);
check('C2 合法换绑 → 200', rebind.status === 200);
const todo2 = await sendJson(SERVER + '/api/projects/' + proj.body.id + '/todos', {
  title: '换绑探针任务',
  spec: '改派即时生效',
});
await sendJson(SERVER + '/api/projects/' + proj.body.id + '/builds', {
  todoIds: [todo2.body.id],
  assignment: { plan: null, build: { agentId } },
  withPlan: false,
});
const homeEmpty = await claim(home.token);
check('C3 换绑后原归属机 claim 空手（改派即时生效）', homeEmpty === null);
const otherGot = await claim(other.token);
check('C4 新归属机领到', otherGot?.step?.kind === 'build', otherGot?.step?.kind);

await sendJson(SERVER + '/api/teams/' + teamId + '/agents/' + agentId, { machineId: home.id }, 'PATCH');
const del = await sendJson(SERVER + '/api/machines/' + home.id, undefined, 'DELETE');
check(
  'D1 删有绑定 agent 的机器 → 409 点名两台',
  del.status === 409 &&
    JSON.stringify(del.body).includes('verify-bound-agent') &&
    JSON.stringify(del.body).includes('verify-cc-agent'),
  JSON.stringify(del.body).slice(0, 240),
);
const evac = await sendJson(SERVER + '/api/machines/' + home.id + '/evacuate', { targetMachineId: other.id });
const evacAgents = db((d) =>
  d.prepare('SELECT id, machineId FROM agent ORDER BY id').all(),
);
check(
  'D2 整机迁移：合格的迁走（verify-bound-agent → other）',
  evac.status === 200 && evacAgents.find((a) => a.id === agentId)?.machineId === other.id,
  JSON.stringify(evac.body).slice(0, 200),
);
check(
  'D3 部分迁移合法：模型不合的留原机 + 响应列原因',
  evacAgents.find((a) => a.id === ccAgent.body.id)?.machineId === home.id &&
    JSON.stringify(evac.body).includes(ccAgent.body.id),
  JSON.stringify(evac.body).slice(0, 200),
);
saveJson('d-evacuate.json', { evacuate: evac.body, agents: evacAgents });

await sendJson(
  SERVER + '/api/machine/presence',
  { claudeCode: { installed: true, hostname: OTHER_NAME, models: [
    { id: 'stub-cc-model', name: 'stub-cc-model', slot: 'default' },
    { id: 'stub-cc-other', name: 'stub-cc-other', slot: 'default' },
  ] } },
  'POST',
  other.token,
);
const fixRebind = await sendJson(
  SERVER + '/api/teams/' + teamId + '/agents/' + ccAgent.body.id,
  { machineId: other.id },
  'PATCH',
);
check('D4 目标机补模型报告后换绑 → 200', fixRebind.status === 200);
const del2 = await sendJson(SERVER + '/api/machines/' + home.id, undefined, 'DELETE');
check('D5 腾空后删除 → 204 + 行消失', del2.status === 204 && db((d) => d.prepare('SELECT COUNT(*) n FROM machine WHERE id = ?').get(home.id).n) === 0);

db((d) => {
  d.prepare(
    `INSERT INTO agent (id, teamId, displayName, provider, modelId, machineId) VALUES (?, ?, ?, ?, ?, NULL)`,
  ).run('agent-legacy-nohome', teamId, 'verify-legacy-nohome', 'stub-gw', 'stub-model');
  const now = Date.now();

  d.prepare(
    `INSERT INTO todo (id, teamId, projectId, seqNum, title, spec, phase, phaseAt, assignment, latestBuildId) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run('todo-legacy-1', teamId, proj.body.id, 9901, '存量任务', '', 'building', now, JSON.stringify({ plan: null, build: { agentId: 'agent-legacy-nohome' } }), 'build-legacy-1');
  d.prepare(
    `INSERT INTO build (id, todoId, withPlan, planDocId, triggerSource, createdAt) VALUES (?, ?, 0, NULL, 'user', ?)`,
  ).run('build-legacy-1', 'todo-legacy-1', now);
  d.prepare(
    `INSERT INTO step (id, buildId, kind, status, createdAt) VALUES (?, ?, 'build', 'pending', ?)`,
  ).run('step-legacy-1', 'build-legacy-1', now - 11 * 60_000);
}, false);

await new Promise((r) => setTimeout(r, 35_000));
const legacyStep = db((d) => d.prepare(`SELECT status FROM step WHERE id = 'step-legacy-1'`).get());
const legacyBuild = db((d) =>
  d.prepare(`SELECT errorMessage FROM build WHERE id = 'build-legacy-1'`).get(),
);
const legacyTodo = (await getJson(SERVER + '/api/projects/' + proj.body.id + '/todos')).find(
  (t) => t.id === 'todo-legacy-1',
);
check('E1 无归属机存量步：调度拍后仍 pending（#1257 挂起不判死）', legacyStep?.status === 'pending', JSON.stringify(legacyStep));
check('E2 build 无 errorMessage（挂起 ≠ 失败）', legacyBuild?.errorMessage == null, legacyBuild?.errorMessage ?? null);
check(
  'E3 板面 waitingOn = 等机器（补设即解锁）',
  legacyTodo?.waitingOn?.on === 'machine',
  JSON.stringify(legacyTodo?.waitingOn ?? null),
);
saveJson('e-legacy-sweep.json', { step: legacyStep, build: legacyBuild, todo: legacyTodo });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

await page.goto(WEB + '/app/resources/machines', { waitUntil: 'networkidle' });
await page.getByRole('link', { name: OTHER_NAME }).click();
await page.waitForURL('**/app/resources/machines/*');
await shot(page, 'f1-machine-detail.png');
check('F1 机器名链接 → 详情页（fact 条在位）', await page.getByTestId('machine-detail-online').isVisible());

const gridCards = await page.getByTestId('team-agent-card').count();
check('F2 详情页网格列出归属本机的 2 个 agent', gridCards === 2, `cards=${gridCards}`);

await page.getByRole('button', { name: '创建 Agent' }).click();
const dlg = page.getByRole('dialog', { name: '创建 agent' });
await dlg.locator('.dlg-agent-machine-select').waitFor();
const prefill = await dlg.locator('.dlg-agent-machine-select').textContent();
check('F3 创建弹窗预选归属机 = 本机', (prefill ?? '').includes(OTHER_NAME), prefill ?? '');
await shot(page, 'f3-create-dialog.png');
await page.keyboard.press('Escape');

await page.goto(WEB + '/app', { waitUntil: 'networkidle' });
await page.keyboard.press('Meta+j');
await page.waitForTimeout(800);
const modelTrigger = await page.getByRole('button', { name: '总管主模型' }).count();
check('F4 chief 抽屉无模型覆盖触发钮（只读行）', modelTrigger === 0);
await shot(page, 'f4-chief-drawer.png');

await page.getByRole('button', { name: /设置|总管设置/ }).first().click().catch(() => {});
await page.waitForTimeout(500);

const infoCard = await page.getByTestId('chief-follows-agent').count();
const compressBtn = await page.getByRole('button', { name: '压缩模型' }).count();
const machineBtn = await page.getByRole('button', { name: '机器', exact: true }).count();
check('F5 设置面只读信息卡在位 + 压缩模型/机器选择器退役', infoCard === 1 && compressBtn === 0 && machineBtn === 0, `info=${infoCard} compress=${compressBtn} machine=${machineBtn}`);
await shot(page, 'f5-chief-settings.png');

await browser.close();

const failed = checks.filter((c) => !c.ok);
writeFileSync(
  join(EVIDENCE, 'result.json'),
  JSON.stringify(
    { probe: '1259-1260-binding', server: SERVER, web: WEB, checks, artifacts, ok: failed.length === 0 },
    null,
    2,
  ),
);
process.stdout.write('\n' + (failed.length === 0 ? 'ALL PASS' : failed.length + ' FAILED') + '  evidence: ' + EVIDENCE + '\n');
process.exit(failed.length === 0 ? 0 : 1);
