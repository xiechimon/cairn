#!/usr/bin/env node
// verify-cairn drive-1104-unassigned-build — run_builds 无指派 build 静默
// 卡死双修（#1104）live 闭环：chief 入口 400 打回 + claim 面无主步失败收尾。
//
// 四腿（铺底全走公开 REST，drive-903 铺底律，非被测路径；零 daemon 零 LLM
// ——chief 回合数据面与真机器同形，claim → tool relay → done 全走真
// machine wire）：
//   A chief relay：假机器认领 chief 回合步后 relay run_builds——整参缺失 /
//     空对象 / 两槽显式全空三形均 400 且文案可指导补正（含 assignment 示例）；
//     补传 assignment 后同 todo 成功派发（400 不留半启动态，SQLite 对拍）。
//     收道 = 同回合 relay cancel_builds（903 律：不用 claim+done failed）。
//   B REST + claim 面：POST builds 空 assignment → 201 入队（步允许入队）；
//     更晚入队的合法 build 在前（FIFO）——machine claim 一次即证「无主步
//     当场失败收尾 + 合法步照常领走」（无队头阻塞）；SQLite 对拍 step
//     failed + build.errorMessage 落根因 + todo → failed 终态。
//   C scheduler：无指派 todo 挂 once 过期档 → 等 15s tick 建 build
//     （triggerSource='schedule'）→ claim 面同漏斗失败收尾。
//   D 看板可见：浏览器开看板（失败卡在「待处理」列）+ 详情页失败行
//     （r8 canon：标题 = build.errorMessage 根因）双截图。
// 依赖全新库：重验 = 重 launch。
// 用法：VERIFY_REPO_ROOT=<worktree> node drive-1104-unassigned-build.mjs

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
  join(SCRIPT_REPO, '.claude/verify-evidence/' + ts + '-1104-unassigned-build');
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
    signal: AbortSignal.timeout(8000),
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
  displayName: '验证员 1104',
  provider: 'stub-gw',
  modelId: 'stub-model',
});
if (![200, 201].includes(agent.status)) {
  throw new Error('agent → ' + agent.status + ' ' + JSON.stringify(agent.body));
}
const AGENT_ID = agent.body?.id ?? agent.body?.agentId ?? agent.body?.record?.id;
if (!AGENT_ID) throw new Error('agent 无 id：' + JSON.stringify(agent.body));

const bind = await sendJson(
  SERVER + '/api/teams/' + teamId + '/chief',
  { agent: { agentId: AGENT_ID, thinkingLevel: null } },
  'PATCH',
);
if (bind.status !== 200) throw new Error('chief bind → ' + bind.status);

const proj = await sendJson(SERVER + '/api/projects', { name: 'probe-1104' });
const projectId = proj.body?.id ?? proj.body?.project?.id;
if (!projectId) throw new Error('project 无 id：' + JSON.stringify(proj.body));

async function makeTodo(title) {
  const res = await sendJson(SERVER + '/api/projects/' + projectId + '/todos', {
    title,
    spec: '用于 #1104 ' + title + ' 实证。',
  });
  const id = res.body?.id;
  if (!id) throw new Error('todo 无 id：' + JSON.stringify(res.body));
  return id;
}
const T_CHIEF = await makeTodo('chief 无指派腿探针');
const T_REST = await makeTodo('REST 无指派腿探针');
const T_VALID = await makeTodo('REST 合法对照探针');
const T_SCHED = await makeTodo('scheduler 无指派腿探针');

const key = await sendJson(SERVER + '/api/teams/' + teamId + '/api-keys', {
  name: 'unassigned-probe',
  gitAccess: false,
  mcpAccess: false,
  toolGrants: { read: [], write: [] },
});
const keyPlain = key.body?.plaintext ?? key.body?.record?.plaintext ?? key.body?.token;
if (!keyPlain) throw new Error('api-key 无 plaintext：' + JSON.stringify(key.body));
const enroll = await sendJson(
  SERVER + '/api/machine/enroll',
  { teamId, name: 'unassigned-probe-machine', cliVersion: '0.1.0' },
  'POST',
  keyPlain,
);
const machineToken = enroll.body?.token ?? enroll.body?.machine?.token;
if (enroll.status !== 200 || !machineToken) throw new Error('enroll → ' + enroll.status);

check(
  'S0 铺底：project + 4 todo + agent + chief 绑定 + 机器注册（REST 双真值）',
  Boolean(projectId && T_CHIEF && T_REST && T_VALID && T_SCHED && AGENT_ID && machineToken),
  'project=' + projectId,
);

// —— 机器 wire 辅助（claim 双层包装 {step:{step:{…}}}，machine-wire 律）————
async function claimStep() {
  const claim = await sendJson(SERVER + '/api/machine/tasks/claim', {}, 'POST', machineToken);
  const payload = claim.body?.step;
  const claimed = payload?.step ?? payload;
  return { status: claim.status, payload, claimed };
}
async function relayRaw(stepId, name, params) {
  return sendJson(SERVER + '/api/machine/tool/' + stepId, { name, params }, 'POST', machineToken);
}
async function doneStep(stepId) {
  // wire 词表 = success/failed/stopped（机器上报面；DB 步终态词 done 是
  // 落账后的列值，别混进请求体——920 gotcha 的反向面）。
  const res = await sendJson(SERVER + '/api/machine/done/' + stepId, { status: 'success' }, 'POST', machineToken);
  if (res.status !== 200) throw new Error('done → ' + res.status + ' ' + JSON.stringify(res.body).slice(0, 300));
}
function rowsFor(todoId) {
  return dbRead((db) => {
    const builds = db
      .prepare('SELECT id, "triggerSource", "errorMessage" FROM build WHERE "todoId" = ? ORDER BY "createdAt"')
      .all(todoId);
    const steps = builds.flatMap((b) =>
      db
        .prepare('SELECT id, kind, status FROM step WHERE "buildId" = ? ORDER BY "createdAt"')
        .all(b.id)
        .map((s) => ({ buildId: b.id, ...s })),
    );
    const todoRow = db.prepare('SELECT phase FROM todo WHERE id = ?').get(todoId);
    return { builds, steps, phase: todoRow?.phase ?? null };
  });
}

// —— A chief relay：无指派 assignment → 400 打回（三空形 + 补传成功）————
const thread = await sendJson(SERVER + '/api/teams/' + teamId + '/chief/threads', {
  content: '#1104 无指派派发探针：请对下面的 todo 执行 run_builds。',
});
if (thread.status !== 201 && thread.status !== 200) {
  throw new Error('chief thread → ' + thread.status + ' ' + JSON.stringify(thread.body).slice(0, 300));
}
const a1 = await claimStep();
const chiefStepId = a1.claimed?.id;
if (!chiefStepId || a1.claimed.kind !== 'chief') {
  throw new Error('A claim 非 chief 步：' + JSON.stringify(a1.claimed).slice(0, 400));
}

const e1 = await relayRaw(chiefStepId, 'run_builds', { todoIds: [T_CHIEF] });
const e1err = typeof e1.body?.error === 'string' ? e1.body.error : '';
check(
  'A1 run_builds 整参缺失 → 400，文案含补正示形（assignment/两槽全空）',
  e1.status === 400 && e1err.includes('两槽全空') && e1err.includes('assignment'),
  'status=' + e1.status + ' error=' + e1err.slice(0, 60),
);
const e2 = await relayRaw(chiefStepId, 'run_builds', { todoIds: [T_CHIEF], assignment: {} });
check(
  'A2 run_builds assignment 空对象 → 400',
  e2.status === 400 && typeof e2.body?.error === 'string' && e2.body.error.includes('两槽全空'),
  'status=' + e2.status,
);
const e3 = await relayRaw(chiefStepId, 'run_builds', {
  todoIds: [T_CHIEF],
  assignment: { plan: null, build: null },
});
check(
  'A3 run_builds assignment 两槽显式全空 → 400',
  e3.status === 400 && typeof e3.body?.error === 'string' && e3.body.error.includes('两槽全空'),
  'status=' + e3.status,
);
const chiefStateAfter400 = rowsFor(T_CHIEF);
check(
  'A4 三次 400 不留半启动态：todo 仍 todo 相、零 build 零步',
  chiefStateAfter400.phase === 'todo' &&
    chiefStateAfter400.builds.length === 0 &&
    chiefStateAfter400.steps.length === 0,
  'phase=' + chiefStateAfter400.phase + ' builds=' + chiefStateAfter400.builds.length,
);

const e5 = await relayRaw(chiefStepId, 'run_builds', {
  todoIds: [T_CHIEF],
  assignment: { plan: { agentId: AGENT_ID }, build: { agentId: AGENT_ID } },
});
let chiefBuildId = null;
if (e5.status === 200) {
  const parsed = JSON.parse(e5.body.text);
  chiefBuildId = parsed?.builds?.[0]?.id ?? null;
}
check(
  'A5 补传 assignment 后同 todo 派发成功（build 落库 + todo → queued）',
  e5.status === 200 && Boolean(chiefBuildId) && rowsFor(T_CHIEF).phase === 'queued',
  'buildId=' + chiefBuildId,
);
// 收道（903 律）：同回合 cancel_builds，别留 pending worker 步顶歪后续腿。
if (chiefBuildId) {
  await relayRaw(chiefStepId, 'cancel_builds', { buildIds: [chiefBuildId] });
}
await doneStep(chiefStepId);
await saveJson('a-chief-relay-400.json', { e1, e2, e3, e5: { status: e5.status, buildId: chiefBuildId } });

// —— B REST + claim 面：空 assignment 入队 → 无主步失败收尾 + 合法步领走 ————
const b1 = await sendJson(SERVER + '/api/projects/' + projectId + '/builds', {
  todoIds: [T_REST],
  assignment: { plan: null, build: null },
  withPlan: false,
});
const restBuildId = b1.body?.builds?.[0]?.id;
check(
  'B1 REST 空 assignment → 201 入队（步允许入队，claim 面负责收口）',
  b1.status === 201 && Boolean(restBuildId),
  'status=' + b1.status + ' buildId=' + restBuildId,
);
const b2 = await sendJson(SERVER + '/api/projects/' + projectId + '/builds', {
  todoIds: [T_VALID],
  assignment: { plan: null, build: { agentId: AGENT_ID } },
  withPlan: false,
});
const validBuildId = b2.body?.builds?.[0]?.id;
if (b2.status !== 201 || !validBuildId) throw new Error('B2 合法 build → ' + b2.status);

const b3 = await claimStep();
check(
  'B2 claim 一次领走合法步（无主步在前不队头阻塞；其已当场失败）',
  b3.claimed?.buildId === validBuildId && b3.claimed?.kind === 'build',
  'claimed.buildId=' + b3.claimed?.buildId + ' valid=' + validBuildId,
);
const restRows = rowsFor(T_REST);
const restStep = restRows.steps[0] ?? null;
check(
  'B3 无主步失败收尾：step failed + build.errorMessage 落「无指派 Agent」根因 + todo → failed',
  restStep?.status === 'failed' &&
    (restRows.builds[0]?.errorMessage ?? '').includes('无指派 Agent') &&
    restRows.phase === 'failed',
  'step=' + restStep?.status + ' err=' + (restRows.builds[0]?.errorMessage ?? '').slice(0, 50),
);
const restBuildApi = await getJson(SERVER + '/api/builds/' + restBuildId);
const restTodoApi = await getJson(SERVER + '/api/todos/' + T_REST);
check(
  'B4 API 双真值：GET build 带 errorMessage、GET todo phase=failed',
  (restBuildApi.errorMessage ?? '').includes('无指派 Agent') && restTodoApi.phase === 'failed',
  'api err=' + (restBuildApi.errorMessage ?? '').slice(0, 50),
);
await saveJson('b-rest-claim-face.json', {
  startEmpty: { status: b1.status, buildId: restBuildId },
  claim: { buildId: b3.claimed?.buildId, kind: b3.claimed?.kind },
  db: restRows,
  buildApi: restBuildApi,
  todoApi: restTodoApi,
});

// —— C scheduler：无指派 todo 定时触发 → 同漏斗 ————————————————————————
// once 档 at 必须钉 00/15/30/45 四档分钟（assertMinuteStep，r5 §8）：取上一
// 个整刻钟（过去时刻 → next tick 即到期）。
const quarter = 15 * 60_000;
const pastQuarter = Math.floor((Date.now() - quarter) / quarter) * quarter;
const c1 = await sendJson(SERVER + '/api/schedules', {
  todoId: T_SCHED,
  kind: 'once',
  at: pastQuarter,
});
check('C1 无指派 todo 挂 once 过期档 → 201', c1.status === 201, 'status=' + c1.status);

let schedBuildId = null;
const schedDeadline = Date.now() + 25_000;
while (Date.now() < schedDeadline && !schedBuildId) {
  await new Promise((r) => setTimeout(r, 500));
  const rows = dbRead((db) =>
    db
      .prepare('SELECT id, "triggerSource" FROM build WHERE "todoId" = ? ORDER BY "createdAt"')
      .all(T_SCHED),
  );
  schedBuildId = rows.find((r) => r.triggerSource === 'schedule')?.id ?? null;
}
check(
  'C2 scheduler tick 建出无主 build（triggerSource=schedule）',
  Boolean(schedBuildId),
  'buildId=' + schedBuildId,
);
// claim 长轮询 ~75s hold：tryClaim 第一轮同步失败无主步后挂起，探针短超时
// 打断即可（打断不打断，失败收尾都已落账）。
try {
  await fetch(SERVER + '/api/machine/tasks/claim', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + machineToken },
    body: '{}',
    signal: AbortSignal.timeout(2500),
  });
} catch {
  // 预期的超时打断：claim 已先跑 tryClaim。
}
await new Promise((r) => setTimeout(r, 500));
const schedRows = rowsFor(T_SCHED);
const schedStep = schedRows.steps[0] ?? null;
check(
  'C3 scheduler 路无主步同漏斗失败收尾：step failed + errorMessage 根因 + todo → failed',
  schedStep?.status === 'failed' &&
    (schedRows.builds[0]?.errorMessage ?? '').includes('无指派 Agent') &&
    schedRows.phase === 'failed',
  'step=' + schedStep?.status + ' err=' + (schedRows.builds[0]?.errorMessage ?? '').slice(0, 50),
);
await saveJson('c-scheduler-funnel.json', { db: schedRows });

// —— D 看板可见：失败卡在「待处理」列 + 详情页失败行 ————————————————
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 732 } });
await page.route('**/api.dicebear.com/**', (route) =>
  route.fulfill({
    contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><rect width="24" height="24" fill="#888"/></svg>',
  }),
);
await page.goto(WEB + '/app');
await page.getByText('REST 无指派腿探针').first().waitFor({ state: 'visible', timeout: 10_000 });
const boardHasFailedCard = (await page.getByText('REST 无指派腿探针').count()) > 0;
check('D1 看板渲染失败终态卡片（待处理列）', boardHasFailedCard, 'card=REST 无指派腿探针');
await shot(page, '01-board-failed-card.png');

await page.goto(WEB + '/app/todo/' + T_REST);
const failTitle = page.getByText('无指派 Agent', { exact: false }).first();
await failTitle.waitFor({ state: 'visible', timeout: 10_000 });
check(
  'D2 详情页失败行可见：标题 = build.errorMessage 根因（r8 canon）',
  (await failTitle.count()) > 0,
  'text=无指派 Agent',
);
await shot(page, '02-detail-fail-row.png');
await browser.close();

// —— 汇总 ————————————————————————————————————————————————
const failed = checks.filter((c) => !c.ok);
await saveJson('result.json', {
  probe: 'drive-1104-unassigned-build',
  ticket: 1104,
  repo: REPO,
  stack: { server: SERVER, web: WEB, db: DB_PATH },
  checks,
  passed: checks.length - failed.length,
  failed: failed.length,
  artifacts,
});
if (failed.length > 0) {
  process.stderr.write(failed.map((c) => 'FAIL  ' + c.name).join('\n') + '\n');
  process.exit(1);
}
process.stdout.write('drive-1104-unassigned-build：' + checks.length + '/' + checks.length + ' PASS\n');
