#!/usr/bin/env node
// verify-pacman drive-1208-machine-pin — 机器钉选派发（#1208）live 闭环。
//
// 两条腿：
//   A 前提腿（wire 真值）：todo.machineId 钉 mea → orchestrate 线程落 pin +
//     编排请求行明示机器名 + 别机 claim 空手 + 钉机领到 chief 步——派发面
//     已经把 todo 钉选当硬约束（#687 落地，票面前提「读面没接」的反证）。
//   B 交付腿（浏览器）：唯一分歧源 = run_builds 显式 machineId 改派（卡 #26
//     实录形态：mea 在线、clone 失败、chief 改派本机）→ 详情页机器行
//     「（任务钉选 {machine}）」尾注可见，换机不再静默；两个对照：
//     钉选被遵守 = 零噪声；未钉（自动）行为不变。
//
// 铺底全走公开 REST（drive-agent-identity 铺底律，非被测路径）：provider +
// agent + PATCH chief 绑定 + project + 3 todo（A/B 钉 mea、C 不钉）+
// 双 api-key + 双机 enroll（各持各 key——enrollment 按 key/team 认机器，
// 同 key 重注册会顶掉前一行的 schema 注释律）。
// 零 daemon、零 LLM：chief 回合数据面与真机器同形（claim → tool relay 全走
// 真 machine wire）。claim 空手是长轮询（~75s hold 后返 null）——走生产
// 节奏等满，别用 8s 短超时把合法等待误判成网络错（drive-895 N7 律）。
// 依赖全新库：重验 = 重 launch。
// 用法：VERIFY_REPO_ROOT=<worktree> node drive-1208-machine-pin.mjs
//   --expect=old 打 origin/main 基线栈（8793/5275）：A/C/D 腿照旧（派发
//   读面在 main 已在），B1 反转为「无尾注」（缺陷基线：静默换机）。

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const EXPECT_OLD = process.argv.includes('--expect=old');
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
  join(SCRIPT_REPO, '.claude/verify-evidence/' + ts + '-1208-machine-pin');
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

const MEA_NAME = 'verify-mea-1208';
const MAC_NAME = 'verify-mac-1208';

// —— 铺底（全 REST，非被测路径）—————————————————————————————
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

const agent = await sendJson(SERVER + '/api/teams/' + teamId + '/agents', {
  displayName: '验证员 1208',
  provider: 'stub-gw',
  modelId: 'stub-model',
});
if (![200, 201].includes(agent.status)) throw new Error('agent → ' + agent.status + ' ' + JSON.stringify(agent.body));
const AGENT_ID = agent.body?.id ?? agent.body?.agentId ?? agent.body?.record?.id;
if (!AGENT_ID) throw new Error('agent 无 id：' + JSON.stringify(agent.body));

const bind = await sendJson(SERVER + '/api/teams/' + teamId + '/chief', {
  agent: { agentId: AGENT_ID, thinkingLevel: null },
}, 'PATCH');
if (bind.status !== 200) throw new Error('chief bind → ' + bind.status + ' ' + JSON.stringify(bind.body));

const proj = await sendJson(SERVER + '/api/projects', { name: 'probe-1208' });
const projectId = proj.body?.id ?? proj.body?.project?.id;
if (!projectId) throw new Error('project 无 id：' + JSON.stringify(proj.body));

async function issueKey(name) {
  const key = await sendJson(SERVER + '/api/teams/' + teamId + '/api-keys', {
    name,
    gitAccess: false,
    mcpAccess: false,
    toolGrants: { read: [], write: [] },
  });
  const keyPlain = key.body?.plaintext ?? key.body?.record?.plaintext ?? key.body?.token;
  if (!keyPlain) throw new Error('api-key 无 plaintext：' + JSON.stringify(key.body));
  return keyPlain;
}
// 双机各持各的 key（drive-895 律）：同 key 重注册 = 复用同一 machine 行。
async function enroll(name, keyPlain) {
  const res = await sendJson(SERVER + '/api/machine/enroll', { teamId, name, cliVersion: '0.1.0' }, 'POST', keyPlain);
  const token = res.body?.token ?? res.body?.machine?.token;
  if (res.status !== 200 || !token) throw new Error('enroll ' + name + ' → ' + res.status);
  return { token, name };
}
const mea = await enroll(MEA_NAME, await issueKey('probe-1208-mea'));
const mac = await enroll(MAC_NAME, await issueKey('probe-1208-mac'));
const machineRows = await getJson(SERVER + '/api/teams/' + teamId + '/machines');
const meaId = machineRows.find((m) => m.name === MEA_NAME)?.id;
const macId = machineRows.find((m) => m.name === MAC_NAME)?.id;
if (!meaId || !macId) throw new Error('机器行缺失：' + JSON.stringify(machineRows.map((m) => m.name)));

// 三卡：A/B 钉 mea（A 走改派腿、B 走遵守对照），C 不钉（自动对照）。
// machineId 建 todo 前先 enroll（界外 id 建任务 400——machine-pin 失败
// 方式 1 律），故铺底序 = project → 双机 → 三卡。
const todoA = await sendJson(SERVER + '/api/projects/' + projectId + '/todos', {
  title: '改派腿探针',
  spec: '钉 mea 后被 chief 显式改派到本机——#1208 可见性腿。',
  machineId: meaId,
});
const todoB = await sendJson(SERVER + '/api/projects/' + projectId + '/todos', {
  title: '遵守对照探针',
  spec: '钉 mea 且派发遵守——零噪声对照。',
  machineId: meaId,
});
const todoC = await sendJson(SERVER + '/api/projects/' + projectId + '/todos', {
  title: '自动对照探针',
  spec: '不钉机器——自动行为不变对照。',
});
const TASK_A = todoA.body?.id;
const TASK_B = todoB.body?.id;
const TASK_C = todoC.body?.id;
if (!TASK_A || !TASK_B || !TASK_C) {
  throw new Error('todo 无 id：' + JSON.stringify([todoA.body, todoB.body, todoC.body]));
}
check(
  'S0 铺底：project + 3 todo（钉/钉/不钉）+ 双机 enroll 落库',
  Boolean(projectId && TASK_A && TASK_B && TASK_C && meaId && macId),
  'mea=' + meaId + ' mac=' + macId,
);

// —— chief 回合辅助（真 machine wire，零 LLM）——————————————————
// claim 响应双层包装 {step:{step:{…}, chief, remoteTools}}（machine-wire 律）。
async function claimStep(tag, token, wantKind) {
  const claim = await sendJson(SERVER + '/api/machine/tasks/claim', {}, 'POST', token, 100_000);
  const payload = claim.body?.step;
  const claimed = payload?.step ?? payload;
  if (!claimed?.id || (wantKind !== undefined && claimed.kind !== wantKind)) {
    throw new Error(tag + ' claim 非 ' + (wantKind ?? 'any') + ' 步：' + JSON.stringify(claim.body).slice(0, 400));
  }
  return { stepId: claimed.id, payload };
}
async function relayTool(stepId, name, params, token) {
  const res = await sendJson(
    SERVER + '/api/machine/tool/' + stepId,
    { name, params },
    'POST',
    token,
  );
  if (res.status !== 200) throw new Error('relay ' + name + ' → ' + res.status + ' ' + JSON.stringify(res.body).slice(0, 300));
  return JSON.parse(res.body.text);
}
function buildPinRow(todoId) {
  return dbRead((db) =>
    db
      .prepare('SELECT id, pinnedMachineId FROM build WHERE "todoId" = ? ORDER BY "createdAt"')
      .all(todoId),
  );
}

// —— A 前提腿：派发把 todo 钉选当硬约束（wire 真值）————————————
const orchA = await sendJson(SERVER + '/api/todos/' + TASK_A + '/orchestrate', {});
if (orchA.status !== 201) throw new Error('orchestrate A → ' + orchA.status);
const THREAD_A = orchA.body?.thread?.id;
const threadPin = dbRead((db) =>
  db.prepare('SELECT pinnedMachineId FROM chief_thread WHERE id = ?').get(THREAD_A),
);
check(
  'A1 orchestrate 落 thread.pinnedMachineId = mea（读面已在——票面「没接读面」的反证）',
  threadPin?.pinnedMachineId === meaId,
  'thread=' + THREAD_A + ' pin=' + threadPin?.pinnedMachineId,
);
check(
  'A2 编排请求行明示钉选机器名（chief 裁量改派时有据）',
  typeof orchA.body?.message?.content === 'string' && orchA.body.message.content.includes(MEA_NAME),
  'content 含 ' + MEA_NAME + '：' + String(orchA.body?.message?.content).slice(0, 80),
);
// 别机 claim 空手（长轮询 ~75s hold 后返 null——drive-895 N7 律，100s 超时）。
const macClaim = await sendJson(SERVER + '/api/machine/tasks/claim', {}, 'POST', mac.token, 100_000);
check(
  'A3 别机 claim 空手：钉 mea 的 chief 步只投给 mea（pin = 硬约束）',
  macClaim.body?.step == null,
  JSON.stringify(macClaim.body?.step ?? null).slice(0, 120),
);
const chiefA = await claimStep('A', mea.token, 'chief');
check(
  'A4 钉机领到 chief 步（conversationId = 编排线程）',
  chiefA.payload?.step?.buildId === THREAD_A,
  'step=' + chiefA.stepId,
);

// —— A5 chief 显式改派（run_builds machineId 覆盖——卡 #26 实录形态）——
const relayA = await relayTool(chiefA.stepId, 'run_builds', {
  todoIds: [TASK_A],
  // plan 槽必带：plan 步 agent 无 modelId 会被 tryClaim 跳过（drive-903 律）。
  assignment: { plan: { agentId: AGENT_ID }, build: { agentId: AGENT_ID } },
  machineId: macId,
}, mea.token);
const rowsA = buildPinRow(TASK_A);
check(
  'A5 relay run_builds machineId=mac → build.pinnedMachineId = mac ≠ todo.machineId = mea（改派发生）',
  relayA.builds?.[0]?.pinnedMachineId === macId && rowsA[0]?.pinnedMachineId === macId,
  'relay=' + relayA.builds?.[0]?.pinnedMachineId + ' sqlite=' + rowsA[0]?.pinnedMachineId,
);
await saveJson('leg-a-dispatch-premise.json', {
  orchestrate: { thread: THREAD_A, messageHead: String(orchA.body?.message?.content).slice(0, 200) },
  macClaimStep: macClaim.body?.step ?? null,
  relayRunBuilds: relayA,
  sqliteBuilds: rowsA,
});

// —— C 遵守对照腿：无显式 machineId → build 落 todo 值（缺省链）————
const orchB = await sendJson(SERVER + '/api/todos/' + TASK_B + '/orchestrate', {});
if (orchB.status !== 201) throw new Error('orchestrate B → ' + orchB.status);
const chiefB = await claimStep('C', mea.token, 'chief');
const relayB = await relayTool(chiefB.stepId, 'run_builds', {
  todoIds: [TASK_B],
  assignment: { plan: { agentId: AGENT_ID }, build: { agentId: AGENT_ID } },
}, mea.token);
const rowsB = buildPinRow(TASK_B);
check(
  'C1 relay run_builds 缺省 machineId → build.pinnedMachineId = mea（todo 值继承，零改派）',
  relayB.builds?.[0]?.pinnedMachineId === meaId && rowsB[0]?.pinnedMachineId === meaId,
  'relay=' + relayB.builds?.[0]?.pinnedMachineId + ' sqlite=' + rowsB[0]?.pinnedMachineId,
);
await saveJson('leg-c-honored-control.json', { relayRunBuilds: relayB, sqliteBuilds: rowsB });

// —— D 自动对照腿：REST 人工启动（不钉）→ build pin null ————————————
const startC = await sendJson(SERVER + '/api/projects/' + projectId + '/builds', {
  todoIds: [TASK_C],
  assignment: { plan: null, build: { agentId: AGENT_ID } },
  withPlan: false,
});
const rowsC = buildPinRow(TASK_C);
check(
  'D1 REST 人工启动不带 pin + todo 未钉 → build.pinnedMachineId = null（自动行为不变）',
  startC.status === 201 && rowsC[0]?.pinnedMachineId == null,
  'status=' + startC.status + ' pin=' + rowsC[0]?.pinnedMachineId,
);

// —— B 浏览器腿：详情页机器行的改派尾注 ————————————————————————
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 732 } });
await page.route('**/api.dicebear.com/**', (route) =>
  route.fulfill({
    contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><rect width="24" height="24" fill="#888"/></svg>',
  }),
);
const NOTE = '（任务钉选 ' + MEA_NAME + '）';
async function machineRowText(todoId) {
  await page.goto(WEB + '/app/todo/' + todoId, { waitUntil: 'networkidle' });
  const meta = page.locator('[data-testid="task-meta"]');
  await meta.waitFor({ state: 'visible', timeout: 8000 });
  return meta.textContent();
}
const metaA = await machineRowText(TASK_A);
const noteA = metaA != null && metaA.includes(NOTE);
const shownA = metaA != null && metaA.includes(MAC_NAME);
check(
  EXPECT_OLD
    ? 'B1(old) 改派静默基线：机器行 = mac 而无「任务钉选 mea」尾注（缺陷形态）'
    : 'B1 改派可见：机器行含 mac 且尾注「（任务钉选 mea）」在位',
  EXPECT_OLD ? shownA && !noteA : shownA && noteA,
  'row含mac=' + shownA + ' 尾注=' + noteA,
);
await shot(page, '01-detail-machine-reassigned.png');

const metaB = await machineRowText(TASK_B);
check(
  'B2 遵守对照：机器行 = mea 且无「任务钉选」尾注（零噪声）',
  metaB != null && metaB.includes(MEA_NAME) && !metaB.includes('任务钉选'),
  'row含mea=' + String(metaB?.includes(MEA_NAME)) + ' 尾注=' + String(metaB?.includes('任务钉选')),
);
await shot(page, '02-detail-machine-honored.png');

const metaC = await machineRowText(TASK_C);
check(
  'B3 自动对照：未钉任务无「任务钉选」尾注（行为不变）',
  metaC != null && !metaC.includes('任务钉选'),
  '尾注=' + String(metaC?.includes('任务钉选')),
);
await shot(page, '03-detail-machine-unpinned.png');
await browser.close();

const failed = checks.filter((c) => !c.ok);
writeFileSync(
  join(EVIDENCE, 'result.json'),
  JSON.stringify(
    {
      probe: '1208-machine-pin',
      ticket: '#1208',
      expect: EXPECT_OLD ? 'old' : 'new',
      stack: { server: SERVER, web: WEB, repo: REPO, db: DB_PATH },
      ids: { teamId, projectId, agentId: AGENT_ID, todoA: TASK_A, todoB: TASK_B, todoC: TASK_C, meaId, macId },
      checks,
      artifacts,
    },
    null,
    2,
  ),
);
process.stdout.write(
  '\n' + (checks.length - failed.length) + '/' + checks.length + ' PASS  evidence=' + EVIDENCE + '\n',
);
process.exit(failed.length > 0 ? 1 : 0);
