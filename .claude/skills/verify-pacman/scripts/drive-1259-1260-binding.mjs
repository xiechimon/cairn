#!/usr/bin/env node
// verify-pacman drive-1259-1260-binding — agent 归属机绑定 + 总管降级（#1259/#1260）
// live 全链验证。
//
// 腿：
//   A 路由（wire 真值）：worker 步与 chief 回合都只投归属机——别机 claim
//     空手（75s 长轮询等满）、归属机领到。
//   B 占槽（#1260）：归属机 maxConcurrent=1 且 chief 步在跑 → 再 claim 空手
//     （chief 占槽，worker 同闸）。
//   C 换绑校验：PATCH agent 改归属机 → 下一步即时改派；绑到缺模型的机器
//     （claude-code agent → 目标机自报清单无该模型）→ 400 指名。
//   D 机器生命周期：删机保护 409 点名 → 整机迁移（模型不合的留机列原因，
//     合格的迁走）→ 腾空后删除 204。
//   E sweep 挂起语义（#1257）：DB 直插无归属机的存量 agent + 老化其
//     pending 步 → 调度拍扫过仍 pending（不判死）、零失败痕迹、todo
//     waitingOn = machine（「等机器」可见态承担出口）。
//   F UI 闭环（浏览器）：machines 列表行名可点 → 详情页（fact 条/归属
//     agent 网格/迁移与删除出口）→ 详情页建 agent 弹窗预选归属机；chief
//     抽屉模型行只读（无触发钮）；总管设置 Agent tab 只读信息卡在位、
//     压缩模型/机器选择器不在。
// 零 daemon、零 LLM：chief 回合数据面与真机器同形（claim 全走真 machine
// wire）。claim 空手是长轮询（~75s 等满），别用短超时误判（drive-895 N7 律）。
// 依赖全新库：重验 = 重 launch。
// 用法：VERIFY_REPO_ROOT=<worktree> node drive-1259-1260-binding.mjs

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

// —— 铺底（全 REST，非被测路径）——————————————————————————————
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

// 双 runtime 显式开齐（创建/换绑校验读 enabledRuntimes）。
for (const id of [home.id, other.id]) {
  const r = await sendJson(SERVER + '/api/machines/' + id, { enabledRuntimes: ['pi', 'claude-code'] }, 'PATCH');
  if (r.status !== 200) throw new Error('开 runtime 失败 ' + id);
}

// —— A 腿：路由 = 归属机（worker + chief）———————————————————————
const agentRes = await sendJson(SERVER + '/api/teams/' + teamId + '/agents', {
  displayName: 'verify-bound-agent',
  description: '绑定探针',
  provider: 'stub-gw',
  modelId: 'stub-model',
  machineId: home.id,
});
check('A0 创建 agent（归属机 = home）→ 201', agentRes.status === 201, JSON.stringify(agentRes.body).slice(0, 120));
const agentId = agentRes.body.id;

// 缺 machineId 创建 → 400（必填槽）。
const noHome = await sendJson(SERVER + '/api/teams/' + teamId + '/agents', {
  displayName: 'verify-nohome-agent',
  provider: 'stub-gw',
  modelId: 'stub-model',
});
check('A0b 创建缺 machineId → 400', noHome.status === 400);

// chief 绑定该 agent。
const bind = await sendJson(SERVER + '/api/teams/' + teamId + '/chief', { agent: { agentId } }, 'PATCH');
check('A1 chief 绑定 agent → 200', bind.status === 200);

// todo + build 指给该 agent。
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

// chief 回合。
const turn = await sendJson(SERVER + '/api/teams/' + teamId + '/chief/threads', { content: '归属机路由探针。' });
if (turn.status !== 201) throw new Error('chief 回合失败 ' + JSON.stringify(turn.body));
const threadId = turn.body.thread.id;

async function claim(token, timeoutMs = 100_000) {
  const res = await sendJson(SERVER + '/api/machine/tasks/claim', {}, 'POST', token, timeoutMs);
  if (res.status !== 200) throw new Error('claim → ' + res.status);
  return res.body.step;
}

// 别机 claim 空手（chief 步 + worker 步都不可见——FIFO 下 chief 更早在队，
// 两个都不可见即一次空手证明整批不可见）。
const otherClaim = await claim(other.token);
check('A2 别机 claim 空手（worker 步 + chief 步都不投它）', otherClaim === null);

const homeClaim1 = await claim(home.token);
check('A3 归属机领到 build 步', homeClaim1?.step?.kind === 'build', homeClaim1?.step?.kind);
check('A3b 载荷 agent.modelId = 自身配置（stub-model）', homeClaim1?.agent?.modelId === 'stub-model');
const homeClaim2 = await claim(home.token);
check('A4 归属机领到 chief 步（降级后 = 绑定 Agent 归属机路由）', homeClaim2?.step?.kind === 'chief', homeClaim2?.step?.kind);
check('A4b chief 载荷模型 = 绑定 Agent 自身（无覆盖槽）', homeClaim2?.agent?.modelId === 'stub-model');
saveJson('a-claims.json', { homeClaim1, homeClaim2 });

// —— B 腿：chief 占槽（maxConcurrent=1 + chief 在跑 → 再 claim 空手）———————
const cap = await sendJson(SERVER + '/api/machines/' + home.id, { maxConcurrent: 1 }, 'PATCH');
if (cap.status !== 200) throw new Error('设 cap 失败');
const capClaim = await claim(home.token);
check('B1 cap 1 + chief 在跑 → 归属机 claim 空手（chief 步占槽）', capClaim === null);
await sendJson(SERVER + '/api/machines/' + home.id, { maxConcurrent: 3 }, 'PATCH');

// —— C 腿：换绑校验——————————————————————————————————————————
// C1 模型不合 → 400 指名（claude-code agent 绑到自报清单无该模型的机器）。
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
// C2 合法换绑即时生效：build agent 换到 other → 新步 other 领、home 空手。
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

// —— D 腿：删机保护 + 整机迁移 ———————————————————————————————
// 两台 agent 都在 other 上（agentId 换绑到此、ccAgent 也绑过去——先给 ccAgent
// 绑到 other 是不行的（C1 已证），ccAgent 留在 home；做部分迁移腿：home 上
// 的 ccAgent 模型在 other 没有 → 迁 other 时被拒留机）。
// 把 build agent 再绑回 home，让 home 名下有两个 agent（一合格一不合）。
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
// ccAgent 换绑去 other 不行（C1 的模型洞）——改绑前先给 other 补模型报告
// （presence 心跳面），再迁走、腾空删除 home。
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

// —— E 腿：sweep 挂起语义（存量无归属机 agent，#1257）———————————————————
// DB 直插存量形态（创建面已禁设 null——这条腿钉的是迁移前的存量行）。
db((d) => {
  d.prepare(
    `INSERT INTO agent (id, teamId, displayName, provider, modelId, machineId) VALUES (?, ?, ?, ?, ?, NULL)`,
  ).run('agent-legacy-nohome', teamId, 'verify-legacy-nohome', 'stub-gw', 'stub-model');
  const now = Date.now();
  d.prepare(
    `INSERT INTO todo (id, teamId, projectId, seqNum, title, spec, phase, phaseAt, assignment, latestBuildId) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run('todo-legacy-1', teamId, proj.body.id, 9901, '存量任务', '', 'queued', now, JSON.stringify({ plan: null, build: { agentId: 'agent-legacy-nohome' } }), 'build-legacy-1');
  d.prepare(
    `INSERT INTO build (id, todoId, withPlan, planDocId, triggerSource, createdAt) VALUES (?, ?, 0, NULL, 'user', ?)`,
  ).run('build-legacy-1', 'todo-legacy-1', now);
  // 超龄形态：挂起与龄期无关（无宽限概念），老化只为钉「超龄也不判死」。
  d.prepare(
    `INSERT INTO step (id, buildId, kind, status, createdAt) VALUES (?, ?, 'build', 'pending', ?)`,
  ).run('step-legacy-1', 'build-legacy-1', now - 11 * 60_000);
}, false);
// 挂起是稳态断言（不是「等到某事件」）：poll 到「≥2 个调度拍（15s 间隔）扫过」
// 的时点再验——拍跑过而步仍 pending 才是挂起证据，早于首拍断言什么都没证。
const eStart = Date.now();
while (Date.now() - eStart < 32_000) {
  await new Promise((r) => setTimeout(r, 1000));
}
const legacyStep = db((d) => d.prepare(`SELECT status FROM step WHERE id = 'step-legacy-1'`).get());
const legacyBuild = db((d) =>
  d.prepare(`SELECT errorMessage FROM build WHERE id = 'build-legacy-1'`).get(),
);
check(
  'E1 无归属机存量步：调度拍扫过仍 pending（#1257 挂起不判死）',
  legacyStep?.status === 'pending',
  JSON.stringify(legacyStep),
);
check(
  'E2 零失败痕迹（build.errorMessage 空）',
  (legacyBuild?.errorMessage ?? null) === null,
  legacyBuild?.errorMessage ?? null,
);
// 可见性出口：todo waitingOn 派生 = machine（agent 无归属机 = 无机可领）。
const legacyTodos = await sendJson(SERVER + '/api/projects/' + proj.body.id + '/todos', undefined, 'GET');
const legacyTodoList = Array.isArray(legacyTodos.body) ? legacyTodos.body : [];
const legacyTodo = legacyTodoList.find((t) => t.id === 'todo-legacy-1');
check(
  'E3 挂起可见：todo.waitingOn = machine',
  legacyTodo?.waitingOn?.on === 'machine',
  JSON.stringify(legacyTodo?.waitingOn ?? null),
);
saveJson('e-legacy-sweep.json', { step: legacyStep, build: legacyBuild, waitingOn: legacyTodo?.waitingOn ?? null });

// —— F 腿：UI 闭环（浏览器）——————————————————————————————————
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

// F1 列表行名可点 → 详情页。
await page.goto(WEB + '/app/resources/machines', { waitUntil: 'networkidle' });
await page.getByRole('link', { name: OTHER_NAME }).click();
await page.waitForURL('**/app/resources/machines/*');
// SPA 换页：URL 先翻、组件后渲染——isVisible 抢跑会吃到旧页像素（实测竞态），
// 一律 waitFor 到目标 testid 再截图再断言。
await page.getByTestId('machine-detail-online').waitFor();
await shot(page, 'f1-machine-detail.png');
check('F1 机器名链接 → 详情页（fact 条在位）', await page.getByTestId('machine-detail-online').isVisible());

// F2 详情页网格 = 归属本机的 agent（两台都在）。
const gridCards = await page.getByTestId('team-agent-card').count();
check('F2 详情页网格列出归属本机的 2 个 agent', gridCards === 2, `cards=${gridCards}`);

// F3 详情页建 agent：预选归属机 = 本机。
await page.getByRole('button', { name: '创建 Agent' }).click();
const dlg = page.getByRole('dialog', { name: '创建 agent' });
await dlg.locator('.dlg-agent-machine-select').waitFor();
const prefill = await dlg.locator('.dlg-agent-machine-select').textContent();
check('F3 创建弹窗预选归属机 = 本机', (prefill ?? '').includes(OTHER_NAME), prefill ?? '');
await shot(page, 'f3-create-dialog.png');
await page.keyboard.press('Escape');

// F4 chief 抽屉：模型行只读（无触发钮）。
await page.goto(WEB + '/app', { waitUntil: 'networkidle' });
await page.keyboard.press('Meta+j');
await page.waitForTimeout(800);
const modelTrigger = await page.getByRole('button', { name: '总管主模型' }).count();
check('F4 chief 抽屉无模型覆盖触发钮（只读行）', modelTrigger === 0);
await shot(page, 'f4-chief-drawer.png');

// F5 总管设置：只读信息卡在位 + 退役选择器不在。
await page.getByRole('button', { name: /设置|总管设置/ }).first().click().catch(() => {});
await page.waitForTimeout(500);
// 设置面在 Agent tab（默认）。
const infoCard = await page.getByTestId('chief-follows-agent').count();
const compressBtn = await page.getByRole('button', { name: '压缩模型' }).count();
const machineBtn = await page.getByRole('button', { name: '机器', exact: true }).count();
check('F5 设置面只读信息卡在位 + 压缩模型/机器选择器退役', infoCard === 1 && compressBtn === 0 && machineBtn === 0, `info=${infoCard} compress=${compressBtn} machine=${machineBtn}`);
await shot(page, 'f5-chief-settings.png');

await browser.close();

// —— 汇总 ————————————————————————————————————————————————
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
