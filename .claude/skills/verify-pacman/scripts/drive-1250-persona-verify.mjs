#!/usr/bin/env node
// verify-pacman drive-1250-persona-verify — 角色名册 + verify 步 + 三视角
// fan-out + split_todo（#1250，ADR 0018 层 1/层 2）live 闭环。
//
// 四相位（失败方式先于断言固化）：
//   S 播种：全新库首启 → 六员 persona agent 自动落库（persona 位 + 档位 +
//     契约名）；REST PATCH 模型位（机器 claim 闸：Agent 在但无模型位 = 不可
//     领）。#1259 未落地 → 无归属机字段，前向兼容。
//   V 验证步：chief relay run_builds 四槽指派 → build 步成（非 PR 分支）→
//     review 关口抵达 + verify 步入队（agent 走 verify 槽）→ claim（new
//     session + 材料：证据目录/输出契约）→ done 带 verifyVerdict →
//     VERIFY_VERDICT 消息行 + phase 留 review。浏览器面：验证中 chip 截图 +
//     verdict 行三态截图。
//   F fan-out：浏览器真点击（AI 审核 → 三视角勾选 → 开始）→ 无 agentId 的
//     steps review 动作 → 三条 review 步各挂 persona agent（meta header +
//     本视角重点）→ 逐条 claim/done（非 blocking findings）→ 三份 verdict
//     消息、零重规划步。
//   P 拆解：chief relay split_todo → 子卡 + 依赖边 + 父方案文档 + 父停
//     confirm → confirm 派发无阻塞子卡 → 子卡 build→review→merge→done →
//     波次推进（B 自动派发）→ 全 done 父自动收 + DONE_ANNOUNCEMENT。
//
// 铺底全走公开 REST（drive-903 铺底律）；假机器 wire（claim/relay/done）零
// daemon 零 LLM。依赖全新库：重验 = 重 launch。
// 用法：VERIFY_REPO_ROOT=<worktree> node drive-1250-persona-verify.mjs

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
  join(SCRIPT_REPO, '.claude/verify-evidence/' + ts + '-1250-persona-verify');
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

const key = await sendJson(SERVER + '/api/teams/' + teamId + '/api-keys', {
  name: 'persona-probe',
  gitAccess: false,
  mcpAccess: false,
  toolGrants: { read: [], write: [] },
});
const keyPlain = key.body?.plaintext ?? key.body?.record?.plaintext ?? key.body?.token;
if (!keyPlain) throw new Error('api-key 无 plaintext：' + JSON.stringify(key.body));
const enroll = await sendJson(
  SERVER + '/api/machine/enroll',
  { teamId, name: 'persona-probe-machine', cliVersion: '0.1.0' },
  'POST',
  keyPlain,
);
const machineToken = enroll.body?.token ?? enroll.body?.machine?.token;
if (enroll.status !== 200 || !machineToken) throw new Error('enroll → ' + enroll.status);

// —— 假机器 wire（drive-903 同律，零 daemon 零 LLM）—————————————
async function claimOnce(tag) {
  const claim = await sendJson(SERVER + '/api/machine/tasks/claim', {}, 'POST', machineToken);
  const payload = claim.body?.step;
  const claimed = payload?.step ?? payload;
  if (!claimed?.id) throw new Error(tag + ' claim 空手：' + JSON.stringify(claim.body).slice(0, 200));
  return { stepId: claimed.id, claimed, payload };
}
// run_builds 派工即自动 watch（r5 §3.5）→ 相位一变 chief gate 回合步就插进
// 队列。认领要的是特定 kind 的 worker 步：中途领到 gate 回合就收掉它（空回
// 合 done success，同 drive-903 chief 收尾形）再领，直到目标 kind 出现。
async function claimUntil(tag, kind) {
  for (let i = 0; i < 8; i++) {
    const claim = await claimOnce(tag);
    if (claim.claimed.kind === kind) return claim;
    await doneStep(claim.stepId, { status: 'success' });
  }
  throw new Error(tag + ' 连领 8 步未见 kind=' + kind);
}
async function relayTool(stepId, name, params) {
  const res = await sendJson(
    SERVER + '/api/machine/tool/' + stepId,
    { name, params },
    'POST',
    machineToken,
  );
  if (res.status !== 200)
    throw new Error('relay ' + name + ' → ' + res.status + ' ' + JSON.stringify(res.body).slice(0, 300));
  return JSON.parse(res.body.text);
}
async function doneStep(stepId, body) {
  const res = await sendJson(
    SERVER + '/api/machine/done/' + stepId,
    body ?? { status: 'success' },
    'POST',
    machineToken,
  );
  if (res.status !== 200)
    throw new Error('done → ' + res.status + ' ' + JSON.stringify(res.body).slice(0, 300));
}
function openChiefThread(content) {
  return sendJson(SERVER + '/api/teams/' + teamId + '/chief/threads', { content });
}
function todoRow(todoId) {
  return dbRead((db) => db.prepare('SELECT * FROM todo WHERE id = ?').get(todoId));
}
function assignmentOf(todoId) {
  // assignment 列是 drizzle json 列——better-sqlite3 裸读给字符串，先 parse。
  return JSON.parse(todoRow(todoId).assignment ?? '{}');
}
function stepsOf(buildId) {
  return dbRead((db) =>
    db.prepare('SELECT * FROM step WHERE "buildId" = ? ORDER BY "createdAt"').all(buildId),
  );
}
function messagesOf(buildId) {
  // message 表无 buildId 列——conversationId ≡ buildId（CONTEXT.md 实体等式）。
  return dbRead((db) =>
    db
      .prepare('SELECT * FROM message WHERE "conversationId" = ? ORDER BY "createdAt"')
      .all(buildId)
      .map((m) => {
        let c = JSON.parse(m.content);
        // drizzle json 列存「字符串值」时带引号再包一层（#902 坑）：system
        // verdict 行是 JSON 串的 JSON 串——首解得 '{' 开头的字符串再解一次；
        // 纯文本宣告行首解即终值。
        if (typeof c === 'string' && c.startsWith('{')) c = JSON.parse(c);
        return { ...m, content: c };
      }),
  );
}

// ============ S 播种相位 =====================================================
const members = await getJson(SERVER + '/api/teams/' + teamId + '/members');
const personaRows = members.filter((m) => m.memberType === 'agent' && m.actor?.persona);
const byRole = Object.fromEntries(personaRows.map((m) => [m.actor.persona, m]));
const EXPECT_ROLES = [
  ['planner', 'Planner', 'xhigh'],
  ['implementer', 'Implementer', 'high'],
  ['code_reviewer', 'CodeReviewer', 'medium'],
  ['security_auditor', 'SecurityAuditor', 'medium'],
  ['test_engineer', 'TestEngineer', 'medium'],
  ['verifier', 'Verifier', 'medium'],
];
check(
  'S1 全新库首启 → 六员 persona agent 自动落库（persona 位 + 契约名 + 档位），modelId 缺省 null',
  EXPECT_ROLES.every(
    ([role, name, tier]) =>
      byRole[role]?.actor?.displayName === name && byRole[role]?.actor?.thinkingLevel === tier,
  ) &&
    personaRows.length === 6 &&
    personaRows.every((m) => m.actor.modelId == null),
  'roles=' + JSON.stringify(Object.keys(byRole)),
);

// 模型位补齐（Agent 设置面同字段；claim 闸：无模型位 = 不可领）。Implementer
// 额外补「合并分支」权限（默认仅 推送分支；子卡 merge 闸需要两开关）。
for (const [role] of EXPECT_ROLES) {
  const agentId = byRole[role].actorId;
  const tools =
    role === 'implementer' ? ['推送分支', '合并分支'] : byRole[role].actor.tools ?? [];
  const patch = await sendJson(
    SERVER + '/api/teams/' + teamId + '/agents/' + agentId,
    { provider: 'stub-gw', modelId: 'stub-model', tools },
    'PATCH',
  );
  if (patch.status !== 200)
    throw new Error('PATCH agent(' + role + ') → ' + patch.status + ' ' + JSON.stringify(patch.body));
}
const members2 = await getJson(SERVER + '/api/teams/' + teamId + '/members');
const byRole2 = Object.fromEntries(
  members2.filter((m) => m.memberType === 'agent' && m.actor?.persona).map((m) => [
    m.actor.persona,
    m.actor,
  ]),
);
check(
  'S2 REST PATCH 模型位回读齐（六员 provider/modelId；implementer 带合并+推送）',
  Object.values(byRole2).every((a) => a.provider === 'stub-gw' && a.modelId === 'stub-model') &&
    byRole2.implementer.tools.includes('合并分支') &&
    byRole2.implementer.tools.includes('推送分支'),
  JSON.stringify(byRole2.implementer?.tools),
);
const AGENTS = Object.fromEntries(Object.entries(byRole2).map(([r, a]) => [r, a.id]));
await saveJson('seeding-personas.json', {
  seeded: EXPECT_ROLES.map(([role, name, tier]) => ({
    role,
    displayName: byRole2[role]?.displayName,
    thinkingLevel: byRole2[role]?.thinkingLevel,
    provider: byRole2[role]?.provider,
    modelId: byRole2[role]?.modelId,
    tools: byRole2[role]?.tools,
  })),
});

// 总管绑定（Chief 是既有 chief 机制，不在六员名册——ADR 0018 决策 0）：
// 独立第七员 + PATCH chief 绑定（drive-903 同律；未绑定 chief threads 409）。
const chiefAgent = await sendJson(SERVER + '/api/teams/' + teamId + '/agents', {
  displayName: '验证总管 1250',
  provider: 'stub-gw',
  modelId: 'stub-model',
});
if (![200, 201].includes(chiefAgent.status))
  throw new Error('chief agent → ' + chiefAgent.status + ' ' + JSON.stringify(chiefAgent.body));
const CHIEF_AGENT_ID = chiefAgent.body?.id ?? chiefAgent.body?.agentId ?? chiefAgent.body?.record?.id;
const bind = await sendJson(
  SERVER + '/api/teams/' + teamId + '/chief',
  { agent: { agentId: CHIEF_AGENT_ID, thinkingLevel: null } },
  'PATCH',
);
if (bind.status !== 200)
  throw new Error('chief bind → ' + bind.status + ' ' + JSON.stringify(bind.body));

// ============ V 验证步相位（todo V）==========================================
const proj = await sendJson(SERVER + '/api/projects', { name: 'probe-1250' });
const projectId = proj.body?.id ?? proj.body?.project?.id;
if (!projectId) throw new Error('project 无 id：' + JSON.stringify(proj.body));
const mk = async (title, spec) => {
  const res = await sendJson(SERVER + '/api/projects/' + projectId + '/todos', { title, spec });
  const id = res.body?.id;
  if (!id) throw new Error('todo 无 id：' + JSON.stringify(res.body));
  return id;
};
const TASK_V = await mk(
  '验证步探针',
  '用于 #1250 verify 步链实证：build 成 → 验证步入队 → verdict 落消息。',
);
const TASK_F = await mk(
  'fan-out 探针',
  '用于 #1250 三视角并行审核实证（浏览器真点击发起）。',
);
const TASK_P = await mk(
  '拆解探针',
  '用于 #1250 split_todo 拆解波次实证：A 直执行，B 依赖 A。',
);
check('S3 铺底：project + 三 todo 落库', Boolean(TASK_V && TASK_F && TASK_P), 'project=' + projectId);

async function chiefDispatch(todoId, tag) {
  const thread = await openChiefThread('开始任务「' + tag + '」，直接派发执行。');
  if (thread.status !== 201) throw new Error('chief threads → ' + thread.status);
  const { stepId, payload } = await claimOnce(tag);
  if (payload.step.kind !== 'chief')
    throw new Error(tag + ' claim 非 chief 步：' + JSON.stringify(payload.step).slice(0, 200));
  return { stepId, payload };
}

const ASSIGNMENT4 = {
  plan: { agentId: AGENTS.planner },
  build: { agentId: AGENTS.implementer },
  review: { agentId: AGENTS.code_reviewer },
  verify: { agentId: AGENTS.verifier },
};
const chiefV = await chiefDispatch(TASK_V, '验证步探针');
// 词表实物：split_todo 工具定义随 chief claim 载荷下发（organize 族）。
const splitDef = (chiefV.payload.remoteTools ?? []).find((t) => t.name === 'split_todo');
check(
  'V0 claim 载荷 remoteTools 含 split_todo 定义（todoId + subtodos[].blockedBy 参数面）',
  splitDef !== undefined &&
    splitDef.parameters?.properties?.todoId !== undefined &&
    splitDef.parameters?.properties?.subtodos !== undefined &&
    (splitDef.parameters?.properties?.subtodos?.items?.properties?.blockedBy !== undefined),
  'blockedBy=' +
    JSON.stringify(
      splitDef?.parameters?.properties?.subtodos?.items?.properties?.blockedBy ?? null,
    ),
);
const relayV = await relayTool(chiefV.stepId, 'run_builds', {
  todoIds: [TASK_V],
  assignment: ASSIGNMENT4,
  withPlan: false,
  dispatchReason: '#1250 探针直修',
});
const buildV = relayV.builds[0].id;
const assignmentV = assignmentOf(TASK_V);
check(
  'V1 relay run_builds 四槽指派 → build 行落库 + assignment 四槽持久（todo 表）',
  assignmentV.plan?.agentId === AGENTS.planner &&
    assignmentV.build?.agentId === AGENTS.implementer &&
    assignmentV.review?.agentId === AGENTS.code_reviewer &&
    assignmentV.verify?.agentId === AGENTS.verifier &&
    stepsOf(buildV)[0]?.kind === 'build',
  'assignment=' + JSON.stringify(assignmentV),
);
await doneStep(chiefV.stepId, { status: 'success' });

const buildClaim = await claimUntil('V-build', 'build');
check(
  'V2 build 步认领：claim 载荷 agent 块 = assignment.build 槽（implementer persona）',
  buildClaim.claimed.kind === 'build' && buildClaim.payload.agent?.id === AGENTS.implementer,
  'kind=' + buildClaim.claimed.kind + ' agent=' + (buildClaim.payload.agent?.id ?? 'null'),
);
await doneStep(buildClaim.stepId, { status: 'success', hasChanges: true });

const stepsAfterBuild = stepsOf(buildV);
const verifyStep = stepsAfterBuild.find((s) => s.kind === 'verify');
check(
  'V3 build 成（非 PR 分支）→ verify 步入队（pending + 验证材料在 prompt；agent 解析在 claim 面 = V5）',
  verifyStep !== undefined &&
    verifyStep.status === 'pending' &&
    verifyStep.prompt.includes('docs/verify/') &&
    verifyStep.prompt.includes('输出契约'),
  'steps=' + JSON.stringify(stepsAfterBuild.map((s) => [s.kind, s.status])),
);
await saveJson('verify-step.json', {
  step: verifyStep,
  todoPhase: todoRow(TASK_V).phase,
});

// 浏览器面：验证步 pending → chip「验证中」。
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 732 } });
await page.route('**/api.dicebear.com/**', (route) =>
  route.fulfill({
    contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><rect width="24" height="24" fill="#888"/></svg>',
  }),
);
await page.goto(WEB + '/app/todo/' + TASK_V);
await page.locator('[data-testid="detail-title"]').waitFor({ state: 'visible', timeout: 10_000 });
// chip 文案与相位解耦（dhead）：verifyActive 优先于审核中——StatusChip 的
// 精确文本「验证中」即判据（无专用 testid，文案一级钉）。
let verifyChipOk = false;
try {
  await page.getByText('验证中', { exact: true }).first().waitFor({ timeout: 8000 });
  verifyChipOk = true;
} catch {
  verifyChipOk = false;
}
check('V4 浏览器：verify 步 pending → 头带 chip「验证中」（优先于审核中）', verifyChipOk);
await shot(page, '01-detail-verify-active.png');

const verifyClaim = await claimUntil('V-verify', 'verify');
// 材料载体 = claim 载荷 instruction（machines.ts：worker 步 prompt 拼 instruction
// 下发，step 记录本体不带 prompt）。
const verifyPrompt = verifyClaim.payload.instruction ?? '';
const headLine = verifyPrompt.split('\n')[0] ?? '';
check(
  'V5 verify 步认领：agent 块 = verify 槽（verifier persona）+ session=new + 材料含工作区纪律',
  verifyClaim.claimed.kind === 'verify' &&
    verifyClaim.payload.agent?.id === AGENTS.verifier &&
    verifyClaim.payload.session?.action === 'new' &&
    verifyPrompt.includes('git add / commit / push') &&
    headLine.startsWith('{') === false,
  'agent=' + (verifyClaim.payload.agent?.id ?? 'null') +
    ' session=' + JSON.stringify(verifyClaim.payload.session),
);
const VERDICT = {
  passed: false,
  conclusion: '两条失败用例需修复后复验。',
  evidence: [
    { path: 'docs/verify/1250/e2e.json', note: '923 条全过' },
    { path: 'docs/verify/1250/failures.txt' },
  ],
};
await doneStep(verifyClaim.stepId, { status: 'success', verifyVerdict: VERDICT });
const vMsgs = messagesOf(buildV).filter((m) => m.content?.kind === 'verify_verdict');
check(
  'V6 verify done 带 verifyVerdict → VERIFY_VERDICT 消息行（passed=false 有效结论）+ phase 留 review',
  vMsgs.length === 1 &&
    vMsgs[0].content.verdict.passed === false &&
    vMsgs[0].content.verdict.evidence.length === 2 &&
    todoRow(TASK_V).phase === 'review',
  'phase=' + todoRow(TASK_V).phase + ' msgs=' + vMsgs.length,
);
await saveJson('verify-verdict-message.json', vMsgs);

await page.goto(WEB + '/app/todo/' + TASK_V);
await page.getByText('验证未通过', { exact: true }).waitFor({ timeout: 10_000 });
const evidenceCount = await page.getByTestId('verify-evidence').count();
check('V7 浏览器：verdict 行「验证未通过」+ 证据条目 2 条渲染', evidenceCount === 2, 'evidence=' + evidenceCount);
await shot(page, '02-detail-verify-verdict.png');

// ============ F fan-out 相位（todo F，浏览器真点击）==========================
const chiefF = await chiefDispatch(TASK_F, 'fan-out 探针');
const relayF = await relayTool(chiefF.stepId, 'run_builds', {
  todoIds: [TASK_F],
  // fan-out 腿故意只给 plan/build（review/verify 槽空 → 无 verify 步、无槽回落）。
  assignment: { plan: { agentId: AGENTS.planner }, build: { agentId: AGENTS.implementer } },
  withPlan: false,
  dispatchReason: '#1250 fan-out 探针',
});
await doneStep(chiefF.stepId, { status: 'success' });
const buildF = relayF.builds[0].id;
const fBuildClaim = await claimUntil('F-build', 'build');
await doneStep(fBuildClaim.stepId, { status: 'success', hasChanges: true });
check(
  'F1 对照：review/verify 槽空 → build 成零 verify 步（槽空零动作，存量语义不变）',
  todoRow(TASK_F).phase === 'review' &&
    stepsOf(buildF).every((s) => s.kind !== 'verify'),
  'steps=' + JSON.stringify(stepsOf(buildF).map((s) => s.kind)),
);

// 浏览器真点击：AI 审核 → 勾选三视角 → 开始（无 agentId 提交）。
await page.goto(WEB + '/app/todo/' + TASK_F);
await page.locator('.composer-tool[aria-label="AI 审核"]').waitFor({ state: 'visible', timeout: 10_000 });
await page.locator('.composer-tool[aria-label="AI 审核"]').click();
await page.locator('[role="dialog"][aria-label="AI 审核"]').waitFor({ state: 'visible', timeout: 8000 });
const fanoutRow = page.getByTestId('review-fanout-toggle');
check('F2 浏览器：review 弹层出现「三视角并行审」行（persona 命中点亮）', (await fanoutRow.count()) === 1);
await shot(page, '03-review-dialog-fanout.png');
// registry Checkbox 原语藏了 native input（Base UI Root），勾选改点行——
// label 包裹整行，点行即翻勾。
await fanoutRow.click();
await page
  .locator('[role="dialog"][aria-label="AI 审核"]')
  .getByRole('button', { name: '开始三视角审核' })
  .click();
await page.locator('[role="dialog"][aria-label="AI 审核"]').waitFor({ state: 'hidden', timeout: 8000 });

const fanoutSteps = stepsOf(buildF).filter((s) => s.kind === 'review');
const FANOUT_ROLES = ['code_reviewer', 'security_auditor', 'test_engineer'];
check(
  'F3 提交（无 agentId）→ 三条 review 步各挂 persona agent（prompt meta header 首行 JSON；步行 agentId 列恒 null——agentId 走 meta 载体）',
  fanoutSteps.length === 3 &&
    FANOUT_ROLES.every((role) =>
      fanoutSteps.some((s) => {
        try {
          return JSON.parse((s.prompt ?? '').split('\n')[0]).agentId === AGENTS[role];
        } catch {
          return false;
        }
      }),
    ) &&
    fanoutSteps.every((s) => s.agentId == null),
  'meta=' +
    JSON.stringify(
      fanoutSteps.map((s) => {
        try {
          return JSON.parse((s.prompt ?? '').split('\n')[0]).agentId;
        } catch {
          return 'no-meta';
        }
      }),
    ),
);
await saveJson('fanout-steps.json', fanoutSteps);

const FOCUS_KEYWORDS = {
  code_reviewer: '五轴 review',
  security_auditor: 'OWASP',
  test_engineer: '测试覆盖缺口',
};
const seenRoles = [];
for (let i = 0; i < 3; i++) {
  const claim = await claimUntil('F-review-' + i, 'review');
  const prompt = claim.payload.instruction ?? '';
  const head = JSON.parse(prompt.split('\n')[0]);
  const role = FANOUT_ROLES.find((r) => AGENTS[r] === head.agentId);
  seenRoles.push(role);
  check(
    'F4.' + (i + 1) + ' review 步认领（' + role + '）：材料含「本视角重点：' + FOCUS_KEYWORDS[role] + '」',
    prompt.includes(FOCUS_KEYWORDS[role]),
  );
  await doneStep(claim.stepId, {
    status: 'success',
    findings: {
      conclusion: role + ' 视角：非阻塞建议一条。',
      findings: [{ id: '1', severity: 'suggestion', summary: '建议补充边界测试' }],
    },
  });
}
const reviewMsgs = messagesOf(buildF).filter((m) => m.content?.kind === 'review_verdict');
const replanSteps = stepsOf(buildF).filter((s) => s.kind === 'plan');
check(
  'F5 三份 verdict 消息并行落会话 + 零 blocking → 零重规划步',
  reviewMsgs.length === 3 && replanSteps.length === 0 && seenRoles.length === 3,
  'msgs=' + reviewMsgs.length + ' replan=' + replanSteps.length + ' roles=' + JSON.stringify(seenRoles),
);
await page.goto(WEB + '/app/todo/' + TASK_F);
await page.getByText('非阻塞建议一条。', { exact: false }).first().waitFor({ timeout: 10_000 });
await shot(page, '04-detail-fanout-verdicts.png');

// ============ P 拆解相位（todo P）============================================
const chiefP = await chiefDispatch(TASK_P, '拆解探针');
const split = await relayTool(chiefP.stepId, 'split_todo', {
  todoId: TASK_P,
  subtodos: [
    { title: '子卡 A', spec: '独立执行 A', agentId: AGENTS.implementer },
    { title: '子卡 B', spec: '依赖 A 完成', agentId: AGENTS.implementer, blockedBy: [1] },
  ],
});
await doneStep(chiefP.stepId, { status: 'success' });
const parentBuild = split.parentBuildId;
const parentRow = todoRow(TASK_P);
const childA = split.children[0].id;
const childB = split.children[1].id;
const blockedByB = JSON.parse(todoRow(childB).blockedBy ?? '[]');
check(
  'P1 split_todo → 子卡两张（sourceTodo/blockedBy 依赖边）+ 父停 confirm（hasPlan + 方案文档）',
  split.children.length === 2 &&
    parentRow.phase === 'confirm' &&
    parentRow.hasPlan === 1 &&
    todoRow(childA).sourceTodo === TASK_P &&
    todoRow(childB).sourceTodo === TASK_P &&
    JSON.stringify(blockedByB) === JSON.stringify([childA]),
  'parent=' + parentRow.phase + ' blockedBy=' + JSON.stringify(blockedByB),
);
const plans = await getJson(SERVER + '/api/builds/' + parentBuild + '/plans').catch(() => null);
const planText = Array.isArray(plans)
  ? (plans[0]?.content ?? null)
  : (plans?.records?.[0]?.content ?? null);
check(
  'P2 父方案文档（拆解方案：子卡清单 + 依赖 + agent 名）+ SPLIT_ANNOUNCEMENT 宣告行',
  String(planText ?? '').includes('拆解方案') &&
    String(planText ?? '').includes('子卡 A') &&
    String(planText ?? '').includes('Implementer') &&
    messagesOf(parentBuild).some((m) => m.content === '发起了拆解'),
  'planHead=' + String(planText ?? '').slice(0, 60),
);
await page.goto(WEB + '/app/todo/' + TASK_P);
await page.locator('[data-testid="detail-title"]').waitFor({ state: 'visible', timeout: 10_000 });
await shot(page, '05-split-parent-confirm.png');

const confirmRes = await sendJson(SERVER + '/api/builds/' + parentBuild + '/steps', {
  action: 'confirm',
});
check(
  'P3 confirm → 派发无阻塞子卡（A queued + build 步）+ 阻塞子卡 B 不动 + 父进 building',
  confirmRes.status === 202 &&
    todoRow(TASK_P).phase === 'building' &&
    todoRow(childA).phase === 'queued' &&
    todoRow(childB).phase === 'todo' &&
    dbRead((db) => db.prepare('SELECT id FROM build WHERE "todoId" = ?').get(childA)) !== undefined,
  'confirm=' + confirmRes.status + ' A=' + todoRow(childA).phase + ' B=' + todoRow(childB).phase,
);

async function runChild(todoId, tag) {
  const buildRow = dbRead((db) =>
    db.prepare('SELECT id FROM build WHERE "todoId" = ? ORDER BY "createdAt"').get(todoId),
  );
  const claim = await claimUntil(tag + '-build', 'build');
  await doneStep(claim.stepId, { status: 'success', hasChanges: true });
  check(
    tag + ' 子卡 build 成 → review 关口（无 verify 槽零 verify 步）',
    todoRow(todoId).phase === 'review' &&
      stepsOf(buildRow.id).every((s) => s.kind !== 'verify'),
    'phase=' + todoRow(todoId).phase,
  );
  const mergeRes = await sendJson(SERVER + '/api/builds/' + buildRow.id + '/merge', undefined, 'POST');
  if (mergeRes.status !== 202)
    throw new Error(tag + ' merge → ' + mergeRes.status + ' ' + JSON.stringify(mergeRes.body));
  const mergeClaim = await claimUntil(tag + '-merge', 'merge');
  check(tag + ' merge 步认领（kind=merge）', mergeClaim.claimed.kind === 'merge');
  await doneStep(mergeClaim.stepId, { status: 'success' });
}

await runChild(childA, 'P4');
check(
  'P5 子卡 A done → 波次推进：B 解锁自动派发（queued + build 步入队）',
  todoRow(childA).phase === 'done' && todoRow(childB).phase === 'queued',
  'A=' + todoRow(childA).phase + ' B=' + todoRow(childB).phase,
);
await runChild(childB, 'P6');
check(
  'P7 全子卡 done → 父自动收（done + DONE_ANNOUNCEMENT「标记为已完成」actor=Chief）',
  todoRow(TASK_P).phase === 'done' &&
    messagesOf(parentBuild).some(
      (m) => m.content === '标记为已完成' && m.actor === 'Chief',
    ),
  'parent=' + todoRow(TASK_P).phase,
);
await page.goto(WEB + '/app/todo/' + TASK_P);
await page.getByText('发起了拆解').first().waitFor({ timeout: 10_000 });
await shot(page, '06-split-parent-done.png');
await browser.close();

const failed = checks.filter((c) => !c.ok);
writeFileSync(
  join(EVIDENCE, 'result.json'),
  JSON.stringify(
    {
      probe: '1250-persona-verify',
      ticket: '#1250',
      adr: 'docs/adr/0018-多agent团队三层与机器能力闸.md',
      stack: { server: SERVER, web: WEB, repo: REPO, db: DB_PATH },
      ids: { teamId, projectId, TASK_V, TASK_F, TASK_P, buildV, buildF, parentBuild },
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
