#!/usr/bin/env node
// verify-cairn drive-903-dispatch-judgment — chief 派发判定（#903，ADR
// 0014）live 闭环：设置槽死态 + chief 逐次判定 + 回执理由三条腿。
//
// 真用户路径：抽屉齿轮进总管设置 → Agent tab 无「派发方式」行（僵尸控件
// 负向钉）→ REST 钉设置槽死态（GET 封套无 dispatchWithPlan 键、PATCH 单独
// 该键 400、混发被剥离）→ 假机器认领 chief 回合步 → claim 载荷取两样运行
// 时实物（systemPrompt 派发判定节 + run_builds 工具定义含 withPlan/
// dispatchReason 参数）→ relay run_builds 三形态实证：
//   E1 缺省 → withPlan=true 先规划（fail-safe，D2）+ dispatchReason null；
//   E2 显式 false + 理由 → 直修（判定权归 chief，D1）+ 理由回显（D4）；
//   E3 显式 true + 理由 → 先规划 + 理由回显。
// 每腿 SQLite 落库对拍：build.withPlan + 首步 step.kind；收道 = relay
// cancel_builds（别用 claim+done failed——机器上报 failed 触发重试/replan
// 步，顶歪下一腿的 chief claim）。
//
// 铺底全走公开 REST（drive-agent-identity 铺底律，非被测路径）：provider +
// agent + PATCH chief 绑定 + project + 3 todo + api-key + machine enroll。
// 零 daemon、零 LLM：chief 回合数据面与真机器同形（claim → tool relay →
// done 全走真 machine wire）。依赖全新库：重验 = 重 launch。
// 用法：VERIFY_REPO_ROOT=<worktree> node drive-903-dispatch-judgment.mjs

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
  join(SCRIPT_REPO, '.claude/verify-evidence/' + ts + '-903-dispatch-judgment');
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
  displayName: '验证员 903',
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
if (bind.status !== 200) throw new Error('chief bind → ' + bind.status + ' ' + JSON.stringify(bind.body));

const proj = await sendJson(SERVER + '/api/projects', { name: 'probe-903' });
const projectId = proj.body?.id ?? proj.body?.project?.id;
if (!projectId) throw new Error('project 无 id：' + JSON.stringify(proj.body));
const todoA = await sendJson(SERVER + '/api/projects/' + projectId + '/todos', {
  title: '缺省腿探针',
  spec: '用于 #903 缺省=先规划实证。',
});
const todoB = await sendJson(SERVER + '/api/projects/' + projectId + '/todos', {
  title: '直修腿探针',
  spec: '用于 #903 withPlan=false + 理由回显实证。',
});
const todoC = await sendJson(SERVER + '/api/projects/' + projectId + '/todos', {
  title: '显式规划腿探针',
  spec: '用于 #903 withPlan=true + 理由回显实证。',
});
const TASK_A = todoA.body?.id;
const TASK_B = todoB.body?.id;
const TASK_C = todoC.body?.id;
if (!TASK_A || !TASK_B || !TASK_C) {
  throw new Error('todo 无 id：' + JSON.stringify([todoA.body, todoB.body, todoC.body]));
}

const key = await sendJson(SERVER + '/api/teams/' + teamId + '/api-keys', {
  name: 'dispatch-probe',
  gitAccess: false,
  mcpAccess: false,
  toolGrants: { read: [], write: [] },
});
const keyPlain = key.body?.plaintext ?? key.body?.record?.plaintext ?? key.body?.token;
if (!keyPlain) throw new Error('api-key 无 plaintext：' + JSON.stringify(key.body));
const enroll = await sendJson(
  SERVER + '/api/machine/enroll',
  { teamId, name: 'dispatch-probe-machine', cliVersion: '0.1.0' },
  'POST',
  keyPlain,
);
const machineToken = enroll.body?.token ?? enroll.body?.machine?.token;
if (enroll.status !== 200 || !machineToken) throw new Error('enroll → ' + enroll.status);

check(
  'S0 铺底：project + 三 todo 落库（REST 双真值）',
  Boolean(projectId && TASK_A && TASK_B && TASK_C),
  'project=' + projectId,
);

// —— chief 回合辅助（真 machine wire，零 LLM）——————————————————
// claim 响应双层包装 {step:{step:{…}, chief, remoteTools}}（machine-wire 律）。
async function claimChiefStep(tag) {
  const claim = await sendJson(SERVER + '/api/machine/tasks/claim', {}, 'POST', machineToken);
  const payload = claim.body?.step;
  const claimed = payload?.step ?? payload;
  if (!claimed?.id || claimed.kind !== 'chief') {
    throw new Error(tag + ' claim 非 chief 步：' + JSON.stringify(claim.body).slice(0, 400));
  }
  return { stepId: claimed.id, payload };
}
async function relayTool(stepId, name, params) {
  const res = await sendJson(
    SERVER + '/api/machine/tool/' + stepId,
    { name, params },
    'POST',
    machineToken,
  );
  if (res.status !== 200) throw new Error('relay ' + name + ' → ' + res.status + ' ' + JSON.stringify(res.body).slice(0, 300));
  return JSON.parse(res.body.text);
}
async function doneStep(stepId, status, errorMessage) {
  const res = await sendJson(
    SERVER + '/api/machine/done/' + stepId,
    errorMessage ? { status, errorMessage } : { status },
    'POST',
    machineToken,
  );
  if (res.status !== 200) throw new Error('done → ' + res.status + ' ' + JSON.stringify(res.body).slice(0, 300));
}
function openChiefThread(content) {
  return sendJson(SERVER + '/api/teams/' + teamId + '/chief/threads', { content });
}
function dispatchRows(todoId) {
  return dbRead((db) => {
    const builds = db
      .prepare('SELECT id, withPlan, triggerSource FROM build WHERE "todoId" = ? ORDER BY "createdAt"')
      .all(todoId);
    const steps = builds.flatMap((b) =>
      db
        .prepare('SELECT kind, status FROM step WHERE "buildId" = ? ORDER BY "createdAt"')
        .all(b.id)
        .map((s) => ({ buildId: b.id, ...s })),
    );
    return { builds, steps };
  });
}
// 收道 = 在本腿 chief 步内 relay cancel_builds：pending worker 步直接标
// failed（DB 直写，不走机器 done 通道）。别用「claim + done failed」收道——
// 机器上报 failed 会走 finishStep 的重试/replan 语义，生成新的 pending 步，
// 把下一腿的 chief claim 顶歪（首轮实测：E2 claim 领到 plan 重试步）。
async function cancelBuild(stepId, buildId, tag) {
  const out = await relayTool(stepId, 'cancel_builds', { buildIds: [buildId] });
  if (!Array.isArray(out?.cancelled)) throw new Error(tag + ' cancel_builds 异常：' + JSON.stringify(out));
}

// 派发判定节 canon（composeChiefSystemPrompt 静态产物，ADR 0014 D5）。
const JUDGMENT_MUSTS = [
  '当信息会实质改变结果、执行方式、权限或安全时才问', // Mika 判断纪律原句
  '否则自己决定，并说出你决定了什么',
  '有可复现步骤或失败测试的缺陷 → 直接修', // 信号一
  '引入新能力、或改动跨包 → 先问', // 信号二（#1049 前问 = 先规划承载）
  '判不准 → 先规划', // 信号三（fail-safe）
  '审阅关口恒在', // D3
  'dispatchReason', // D4 审计参数
  '就地一句话推翻', // D4 推翻
  '只影响这一次', // D4 单次性
];

// —— U 浏览器面（live 模式，无 scenario）：设置槽死态 ——————————————
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 732 } });
await page.route('**/api.dicebear.com/**', (route) =>
  route.fulfill({
    contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><rect width="24" height="24" fill="#888"/></svg>',
  }),
);
await page.goto(WEB + '/app');
await page.locator('button[aria-label="总管"]').click();
await page.locator('.chief-drawer').waitFor({ state: 'visible', timeout: 8000 });
await page.locator('button[aria-label="总管设置"]').click();
await page.locator('h1:text-is("总管设置")').waitFor({ state: 'visible', timeout: 8000 });
// Agent tab 缺省即在位；等机器行加载完成再数（邻座行在位 = 拆的只是派发槽）。
await page.locator('button[aria-label="机器"]').waitFor({ state: 'visible', timeout: 8000 });
const dispatchRowCount = await page.locator('button[aria-label="派发方式"]').count();
const dispatchHeadingCount = await page.getByRole('heading', { name: '派发方式' }).count();
const neighborOk =
  (await page.locator('button[aria-label="机器"]').count()) === 1 &&
  (await page.locator('button[aria-label="压缩模型"]').count()) === 1;
check(
  'U1 设置 Agent tab 无「派发方式」行（僵尸控件负向钉），邻座机器/压缩模型行健在',
  dispatchRowCount === 0 && dispatchHeadingCount === 0 && neighborOk,
  'button=' + dispatchRowCount + ' heading=' + dispatchHeadingCount + ' neighbors=' + neighborOk,
);
await shot(page, '01-settings-agent-no-dispatch-row.png');
await browser.close();

// —— A REST 面：设置槽死态（回读确认律）—————————————————————
const patchLone = await sendJson(SERVER + '/api/teams/' + teamId + '/chief', {
  dispatchWithPlan: false,
}, 'PATCH');
check('A1 PATCH 单独 dispatchWithPlan → 400（不再是槽位）', patchLone.status === 400, 'status=' + patchLone.status);
const patchMixed = await sendJson(SERVER + '/api/teams/' + teamId + '/chief', {
  charter: '判定探针章程',
  dispatchWithPlan: false,
}, 'PATCH');
const envAfter = await getJson(SERVER + '/api/teams/' + teamId + '/chief');
check(
  'A2 PATCH 混发 → 200 且该键被剥离：charter 落、封套无 dispatchWithPlan 键',
  patchMixed.status === 200 &&
    envAfter.chief?.charter === '判定探针章程' &&
    !('dispatchWithPlan' in (envAfter.chief ?? {})),
  'status=' + patchMixed.status + ' keys=' + JSON.stringify(Object.keys(envAfter.chief ?? {})),
);
await saveJson('patch-reject-and-envelope.json', {
  patchLone: { status: patchLone.status, body: patchLone.body },
  patchMixed: { status: patchMixed.status },
  chiefEnvelope: envAfter.chief,
});

// —— E1 缺省腿：不带 withPlan → 先规划（fail-safe，D2）————————————
const t1 = await openChiefThread('开始任务「缺省腿探针」，直接派发执行。');
if (t1.status !== 201) throw new Error('chief threads → ' + t1.status);
const claimE1 = await claimChiefStep('E1');
const promptE1 = claimE1.payload?.chief?.systemPrompt ?? '';
const runBuildsDef = (claimE1.payload?.remoteTools ?? []).find((t) => t.name === 'run_builds');
const defProps = Object.keys(runBuildsDef?.parameters?.properties ?? {});
check(
  'E1a claim systemPrompt 派发判定节：Mika 纪律 + 三信号 + 审阅闸恒在 + 回执可推翻，且无写死直执行指令、无设置合成残留',
  JUDGMENT_MUSTS.every((s) => promptE1.includes(s)) &&
    !promptE1.includes('withPlan:false') &&
    !promptE1.includes('派发模式（团队设置'),
  'missing=' + JSON.stringify(JUDGMENT_MUSTS.filter((s) => !promptE1.includes(s))),
);
check(
  'E1b claim 载荷 run_builds 工具定义：withPlan + dispatchReason 参数在位、必填仅 todoIds（D1/D4 词表实物）',
  runBuildsDef !== undefined &&
    defProps.includes('withPlan') &&
    defProps.includes('dispatchReason') &&
    JSON.stringify(runBuildsDef.parameters?.required ?? []) === JSON.stringify(['todoIds']),
  'props=' + JSON.stringify(defProps) + ' required=' + JSON.stringify(runBuildsDef?.parameters?.required ?? []),
);
await saveJson('claim-e1.json', {
  stepId: claimE1.stepId,
  systemPromptJudgmentLines: promptE1
    .split('\n')
    .filter((l) => l.startsWith('- 派发判定') || l.startsWith('- 派发回执')),
  runBuildsToolDef: runBuildsDef ?? null,
});
const relayE1 = await relayTool(claimE1.stepId, 'run_builds', {
  todoIds: [TASK_A],
  // plan 槽必带：plan 步的 agent 无 modelId 会被 tryClaim 跳过（machines.ts
  // 「未指派 Agent = 不可执行」），收道腿的 claim 会长轮询到超时。
  assignment: { plan: { agentId: AGENT_ID }, build: { agentId: AGENT_ID } },
});
check(
  'E1c relay run_builds 缺省 withPlan → 响应 true（fail-safe）+ dispatchReason null + triggerSource chief',
  relayE1.withPlan === true && relayE1.dispatchReason === null && relayE1.triggerSource === 'chief',
  'withPlan=' + relayE1.withPlan + ' reason=' + JSON.stringify(relayE1.dispatchReason),
);
const rowsA = dispatchRows(TASK_A);
check(
  'E1d SQLite：build.withPlan=1 + 首步 kind=plan（缺省先规划实证）',
  rowsA.builds.length === 1 &&
    Number(rowsA.builds[0].withPlan) === 1 &&
    rowsA.builds[0].triggerSource === 'chief' &&
    rowsA.steps[0]?.kind === 'plan',
  JSON.stringify(rowsA),
);
await saveJson('relay-e1-default-plan.json', { relayResult: relayE1, sqlite: rowsA });
await cancelBuild(claimE1.stepId, relayE1.builds[0].id, 'E1');
await doneStep(claimE1.stepId, 'success');

// —— E2 直修腿：withPlan=false + 理由 → 判定生效 + 理由回显（D1/D4）————
const t2 = await openChiefThread('开始任务「直修腿探针」，直接派发执行。');
if (t2.status !== 201) throw new Error('chief threads → ' + t2.status);
const claimE2 = await claimChiefStep('E2');
const REASON_DIRECT = '缺陷有可复现步骤（信号一）→ 直接修';
const relayE2 = await relayTool(claimE2.stepId, 'run_builds', {
  todoIds: [TASK_B],
  assignment: { plan: { agentId: AGENT_ID }, build: { agentId: AGENT_ID } },
  withPlan: false,
  dispatchReason: REASON_DIRECT,
});
check(
  'E2a relay run_builds withPlan=false → 响应 false（判定权归 chief，无 clamp）+ dispatchReason 原样回显',
  relayE2.withPlan === false && relayE2.dispatchReason === REASON_DIRECT,
  'withPlan=' + relayE2.withPlan + ' reason=' + JSON.stringify(relayE2.dispatchReason),
);
const rowsB = dispatchRows(TASK_B);
check(
  'E2b SQLite：build.withPlan=0 + 首步 kind=build（直修实证；review 闸在合并路径，与本参数无涉）',
  rowsB.builds.length === 1 &&
    Number(rowsB.builds[0].withPlan) === 0 &&
    rowsB.builds[0].triggerSource === 'chief' &&
    rowsB.steps[0]?.kind === 'build',
  JSON.stringify(rowsB),
);
await saveJson('relay-e2-direct-reason.json', { relayResult: relayE2, sqlite: rowsB });
await cancelBuild(claimE2.stepId, relayE2.builds[0].id, 'E2');
await doneStep(claimE2.stepId, 'success');

// —— E3 显式规划腿：withPlan=true + 理由 → 回显 + 首步 plan ——————————
const t3 = await openChiefThread('开始任务「显式规划腿探针」，直接派发执行。');
if (t3.status !== 201) throw new Error('chief threads → ' + t3.status);
const claimE3 = await claimChiefStep('E3');
const REASON_PLAN = '引入新能力（信号二）→ 先规划';
const relayE3 = await relayTool(claimE3.stepId, 'run_builds', {
  todoIds: [TASK_C],
  assignment: { plan: { agentId: AGENT_ID }, build: { agentId: AGENT_ID } },
  withPlan: true,
  dispatchReason: REASON_PLAN,
});
check(
  'E3a relay run_builds withPlan=true + 理由 → 响应 true + dispatchReason 原样回显',
  relayE3.withPlan === true && relayE3.dispatchReason === REASON_PLAN,
  'withPlan=' + relayE3.withPlan + ' reason=' + JSON.stringify(relayE3.dispatchReason),
);
const rowsC = dispatchRows(TASK_C);
check(
  'E3b SQLite：build.withPlan=1 + 首步 kind=plan',
  rowsC.builds.length === 1 &&
    Number(rowsC.builds[0].withPlan) === 1 &&
    rowsC.steps[0]?.kind === 'plan',
  JSON.stringify(rowsC),
);
await saveJson('relay-e3-explicit-plan-reason.json', { relayResult: relayE3, sqlite: rowsC });
await cancelBuild(claimE3.stepId, relayE3.builds[0].id, 'E3');
await doneStep(claimE3.stepId, 'success');

const failed = checks.filter((c) => !c.ok);
writeFileSync(
  join(EVIDENCE, 'result.json'),
  JSON.stringify(
    {
      probe: '903-dispatch-judgment',
      ticket: '#903',
      adr: 'docs/adr/0014-chief派发判定-判定权归chief-判说可推翻.md',
      stack: { server: SERVER, web: WEB, repo: REPO, db: DB_PATH },
      ids: { teamId, projectId, agentId: AGENT_ID, todoA: TASK_A, todoB: TASK_B, todoC: TASK_C },
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
