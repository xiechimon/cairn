#!/usr/bin/env node
// drive-902-gate-actor — #902/#900/#901 三票联合 live 探针（纯 REST + 假机器
// wire + Playwright 拖拽，零 daemon 零 LLM）。
//
// 覆盖（--expect=new，lane 栈）：
//   A #902 人过闸记 actor：真机器 wire 把 todo1 推到 confirm（plan.md 上传 +
//     done success），REST steps {action:'confirm'} 过闸 → SQLite message 行
//     content='通过了确认' ∧ actor=seed 用户 displayName；GET messages wire
//     透出 actor；详情页时间线 note「Owner 通过了确认」截图。
//   B #901 拖拽 done 闸：build 步 done {hasChanges:true} → review；浏览器真
//     拖拽 卡片→已完成 列 → 确认弹层出现（截图 + 录像）→ 确认完成 → 落位 +
//     PATCH phase=done + DONE 审计行（actor=用户）+ 详情页时间线截图；
//     录像转 GIF（拖拽是动效，票面要求 GIF 证据）。
//   C #900 chief 不得自过闸 + #902 chief actor：todo2 同 wire 推到 confirm；
//     绑 chief（agent B）→ 建 chief 线程 → 假机器认领 chief 步 →
//     relay confirm_builds（回执 + CONFIRM 行 actor=chief Agent 名，不是
//     用户名）→ build 步 done → review → relay complete_todos → 回执
//     {skipped+reasons}（toolcall 侧回执，票面证据）∧ 相位仍 review。
//   D 落证：wire messages JSON（含 actor 位）+ SQLite message 行全量 dump。
//
// --expect=old（origin/main 基线栈）：同脚本重放 A/B 两相位的「before」面——
//   confirm 过闸零行、拖拽 review→done 静默落位（无弹层）、库里无 done 审计
//   行；录像转 before GIF。C/D 相位跳过（main 无对应面）。
//
// 用法：
//   VERIFY_REPO_ROOT=<lane worktree> node .claude/skills/verify-cairn/scripts/launch.mjs
//   node .claude/skills/verify-cairn/scripts/drive-902-gate-actor.mjs --expect=new
//   # before 基线（main 栈在 8793/5275，own RUN_DIR）：
//   VERIFY_RUN_DIR=<main 栈 run dir> node .../drive-902-gate-actor.mjs --expect=old
//
// 前置：栈已 launch（ports.json 在位）。证据落 VERIFY_EVIDENCE_DIR（缺省
// 主仓 .claude/verify-evidence/<ts>-902-gate-actor/）。GIF 转换要 ffmpeg。

import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const SCRIPT_REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const REPO = process.env.VERIFY_REPO_ROOT ?? SCRIPT_REPO;
const RUN_DIR = process.env.VERIFY_RUN_DIR ?? join(REPO, '.claude/verify-run');
const EXPECT = process.argv.includes('--expect=old') ? 'old' : 'new';
const portsFile = join(RUN_DIR, 'ports.json');
if (!existsSync(portsFile)) {
  process.stderr.write('无栈：' + portsFile + ' 不存在。先跑 launch.mjs\n');
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
  join(SCRIPT_REPO, '.claude/verify-evidence/' + ts + '-902-gate-actor-' + EXPECT);
mkdirSync(EVIDENCE, { recursive: true });

// 宣告行 content canon（shared records/message.ts 同字面；old 栈上这些串
// 恒不出现 = before 证据的负断言基线）。
const CONFIRM_TEXT = '通过了确认';
const DONE_TEXT = '标记为已完成';
const MERGE_TEXT = '发起了合并';
const REVIEW_TEXT = '发起了 AI 审核';
const DIALOG_NAME = '把任务标记为已完成？';

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
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  const text = await res.text();
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }
  return { status: res.status, body: parsed };
}
async function sendJson(url, body, method, token) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = 'Bearer ' + token;
  const res = await fetch(url, {
    method: method ?? 'POST',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
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
function messageRows(conversationId) {
  return dbRead((db) => {
    const cols = db.prepare(`PRAGMA table_info(message)`).all().map((c) => c.name);
    const hasActor = cols.includes('actor');
    const sel = hasActor
      ? 'SELECT id, role, content, actor, createdAt FROM message WHERE conversationId = ? ORDER BY createdAt'
      : 'SELECT id, role, content, createdAt FROM message WHERE conversationId = ? ORDER BY createdAt';
    // drizzle json<> 列 = JSON 串存储（字符串值带引号）——比对 canon 前先解。
    const rows = db.prepare(sel).all(conversationId).map((r) => {
      if (typeof r.content !== 'string') return r;
      try {
        return { ...r, content: JSON.parse(r.content) };
      } catch {
        return r;
      }
    });
    return { hasActor, rows };
  });
}

// —— 机器 wire 助手（setup-review-seed / drive-agent-identity 同律）—————————
let MACHINE_TOKEN = null;
async function presence() {
  await sendJson(SERVER + '/api/machine/presence', {}, 'POST', MACHINE_TOKEN);
}
async function claimStep(expectKind) {
  await presence();
  const claim = await sendJson(SERVER + '/api/machine/tasks/claim', {}, 'POST', MACHINE_TOKEN);
  const claimed = claim.body?.step?.step ?? claim.body?.step;
  if (!claimed?.id) throw new Error('claim 失败：' + JSON.stringify(claim.body));
  if (expectKind && claimed.kind !== expectKind) {
    throw new Error('claim kind=' + claimed.kind + '，期望 ' + expectKind);
  }
  return claimed;
}
async function uploadPlan(stepId, content) {
  const urls = await sendJson(
    SERVER + '/api/machine/upload-urls/' + stepId,
    { files: [{ name: 'plan.md' }] },
    'POST',
    MACHINE_TOKEN,
  );
  if (urls.status !== 200) throw new Error('upload-urls → ' + urls.status);
  const up = urls.body.uploads[0];
  const put = await fetch(SERVER + up.url.replace(/^https?:\/\/[^/]+/, ''), {
    method: 'PUT',
    headers: { authorization: 'Bearer ' + MACHINE_TOKEN, 'content-type': 'text/markdown' },
    body: content,
  });
  if (put.status !== 200) throw new Error('plan PUT → ' + put.status);
}
async function doneStep(stepId, body) {
  const done = await sendJson(
    SERVER + '/api/machine/done/' + stepId,
    body ?? { status: 'success' },
    'POST',
    MACHINE_TOKEN,
  );
  if (done.status !== 200) throw new Error('done → ' + done.status + ' ' + JSON.stringify(done.body));
}
async function relayTool(stepId, name, params) {
  await presence();
  const res = await sendJson(
    SERVER + '/api/machine/tool/' + stepId,
    { name, params },
    'POST',
    MACHINE_TOKEN,
  );
  if (res.status !== 200) throw new Error('relay ' + name + ' → ' + res.status + ' ' + JSON.stringify(res.body));
  return JSON.parse(res.body.text);
}

/** 铺底一段：team/provider/agent/project/todo/build(withPlan) → confirm 相位
 *  （真机器 wire：claim plan 步 + plan.md 上传 + done success）。 */
async function seedToConfirm(label, agentId) {
  const teams = await getJson(SERVER + '/api/teams');
  const teamId = teams.body[0].id;
  const project = await sendJson(SERVER + '/api/projects', { name: '闸探针-' + label });
  if (project.status !== 201) throw new Error('project → ' + project.status);
  const projectId = project.body.id;
  const todo = await sendJson(SERVER + '/api/projects/' + projectId + '/todos', {
    title: label + '：过闸探针任务',
    spec: label + '：写一段示例代码，供 actor 审计面取证',
  });
  if (todo.status !== 201) throw new Error('todo → ' + todo.status);
  const todoId = todo.body.id;
  const build = await sendJson(SERVER + '/api/projects/' + projectId + '/builds', {
    todoIds: [todoId],
    assignment: { plan: { agentId }, build: { agentId } },
    withPlan: true,
  });
  if (build.status !== 201) throw new Error('builds → ' + build.status);
  const buildId = build.body.builds[0].id;
  const planStep = await claimStep('plan');
  await uploadPlan(planStep.id, '# ' + label + ' 方案\n\n过闸探针方案 v1\n');
  await doneStep(planStep.id);
  const face = await getJson(SERVER + '/api/todos/' + todoId);
  if (face.body.phase !== 'confirm') throw new Error('seed 后相位=' + face.body.phase + '，期望 confirm');
  return { teamId, projectId, todoId, buildId };
}

/** 铺底二段：confirm → building（REST 或 chief relay 过确认闸）→ build 步
 *  done {hasChanges:true} → review 相位。 */
async function advanceToReview(todoId) {
  const buildStep = await claimStep('build');
  await doneStep(buildStep.id, { status: 'success', hasChanges: true });
  const face = await getJson(SERVER + '/api/todos/' + todoId);
  if (face.body.phase !== 'review') throw new Error('推进后相位=' + face.body.phase + '，期望 review');
}

// —— 浏览器拖拽（B 相位）：卡片 → 已完成 列，e2e dragTo 同款指针序 ——————————
async function dragCardToDone(page, todoId) {
  const fromBox = await page.locator('[data-todo-id="' + todoId + '"]').first().boundingBox();
  if (fromBox == null) throw new Error('卡片不在板上：' + todoId);
  const list = await page.locator('[data-column-list="done"]').boundingBox();
  if (list == null) throw new Error('done 列不在');
  const sx = fromBox.x + fromBox.width / 2;
  const sy = fromBox.y + fromBox.height / 2;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move(sx + 8, sy + 6, { steps: 4 });
  await page.mouse.move(list.x + list.width / 2, list.y + list.height - 24, { steps: 12 });
  await page.waitForTimeout(200);
}

async function webmToGif(webmPath, gifName) {
  const gifPath = join(EVIDENCE, gifName);
  const res = spawnSync(
    'ffmpeg',
    [
      '-y',
      '-i',
      webmPath,
      '-vf',
      'fps=12,scale=860:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse',
      gifPath,
    ],
    { stdio: 'pipe' },
  );
  if (res.status !== 0) throw new Error('ffmpeg → ' + res.status + ' ' + res.stderr?.toString().slice(-400));
  artifacts.push(gifName);
  process.stdout.write('gif   ' + gifName + '\n');
}

// —— 主流程 ————————————————————————————————————————————————————————————————
const session = await getJson(SERVER + '/api/auth/session');
if (session.status !== 200) throw new Error('session → ' + session.status);
const USER_NAME = session.body.displayName;
check('seed 用户 displayName 可读', typeof USER_NAME === 'string' && USER_NAME !== '', USER_NAME);

const teams0 = await getJson(SERVER + '/api/teams');
const TEAM_ID = teams0.body[0].id;

// provider + agents（setup-review-seed 同律；409 = 已建，跳过）。
await sendJson(SERVER + '/api/teams/' + TEAM_ID + '/providers', {
  providerId: 'stub-gw',
  label: 'Stub Gateway',
  baseUrl: 'http://127.0.0.1:9/v1',
  api: 'openai-completions',
  authHeader: true,
  compat: { supportsDeveloperRole: false },
  models: [{ id: 'stub-model', name: 'stub-model' }],
});
async function makeAgent(name) {
  const agent = await sendJson(SERVER + '/api/teams/' + TEAM_ID + '/agents', {
    displayName: name,
    provider: 'stub-gw',
    modelId: 'stub-model',
  });
  if (![200, 201].includes(agent.status)) throw new Error('agent → ' + agent.status);
  const id = agent.body?.id ?? agent.body?.agentId ?? agent.body?.record?.id;
  if (!id) throw new Error('agent 无 id：' + JSON.stringify(agent.body));
  return id;
}
const AGENT_A = await makeAgent('verify-builder');

// api-key + enroll 假机器。
const key = await sendJson(SERVER + '/api/teams/' + TEAM_ID + '/api-keys', {
  name: 'gate-actor-probe',
  gitAccess: false,
  mcpAccess: false,
  toolGrants: { read: [], write: [] },
});
const keyPlain = key.body?.plaintext ?? key.body?.record?.plaintext ?? key.body?.token;
if (!keyPlain) throw new Error('api-key 无 plaintext');
const enroll = await sendJson(
  SERVER + '/api/machine/enroll',
  { teamId: TEAM_ID, name: 'gate-actor-machine', cliVersion: '0.1.0' },
  'POST',
  keyPlain,
);
MACHINE_TOKEN = enroll.body?.token ?? enroll.body?.machine?.token;
if (enroll.status !== 200 || !MACHINE_TOKEN) throw new Error('enroll → ' + enroll.status);

// —— A 相位：todo1 → confirm → REST 过闸 → actor 行 ————————————————
const t1 = await seedToConfirm('甲', AGENT_A);
const confirmRes = await sendJson(SERVER + '/api/builds/' + t1.buildId + '/steps', {
  action: 'confirm',
});
check(
  'A1 REST steps confirm = 202（真闸动作）',
  confirmRes.status === 202,
  'status=' + confirmRes.status,
);
const t1rows = messageRows(t1.buildId);
const confirmRow = t1rows.rows.find((r) => r.content === CONFIRM_TEXT);
if (EXPECT === 'new') {
  check('A2 #902 confirm 过闸落宣告行', confirmRow !== undefined, JSON.stringify(confirmRow ?? null));
  check(
    'A3 #902 行 actor = seed 用户（非空可读）',
    confirmRow?.actor === USER_NAME,
    'actor=' + JSON.stringify(confirmRow?.actor ?? null),
  );
} else {
  check('A2(before) main 栈 confirm 过闸零行（#892 病灶复现）', confirmRow === undefined);
  check('A3(before) main 栈 message 表无 actor 列', t1rows.hasActor === false);
}

// build 步 → review（wire done 带 hasChanges:true）。
await advanceToReview(t1.todoId);

// wire 面：GET messages 透出 actor（new）。
const wire = await getJson(SERVER + '/api/conversations/' + t1.buildId + '/messages');
await saveJson(EXPECT + '-wire-messages-todo1.json', wire.body);
if (EXPECT === 'new') {
  const wireRow = (wire.body.messages ?? []).find((m) => m.content === CONFIRM_TEXT);
  check('A4 #902 GET messages wire 行含 actor', wireRow?.actor === USER_NAME, JSON.stringify(wireRow ?? null));
}

// —— B 相位：浏览器拖拽 review→done（录像 + 弹层/静默分叉）————————————
const browser = await chromium.launch();
const videoDir = join(EVIDENCE, 'video-' + EXPECT);
const context = await browser.newContext({
  viewport: { width: 1440, height: 732 },
  recordVideo: { dir: videoDir, size: { width: 1440, height: 732 } },
});
const page = await context.newPage();
await page.goto(WEB + '/app', { waitUntil: 'domcontentloaded' });
await page
  .locator('[data-column="pending"] [data-todo-id="' + t1.todoId + '"]')
  .waitFor({ state: 'visible', timeout: 60000 });
await dragCardToDone(page, t1.todoId);
await page.mouse.up();
const dialog = page.getByRole('dialog', { name: DIALOG_NAME });
if (EXPECT === 'new') {
  await dialog.waitFor({ state: 'visible', timeout: 15000 });
  await shot(page, EXPECT + '-drag-done-dialog.png');
  check('B1 #901 弹层在 review(有变更)→done 落位出现', true);
  // 确认前零提交：卡片仍在源列。
  const stillSource = await page
    .locator('[data-column="pending"] [data-todo-id="' + t1.todoId + '"]')
    .isVisible();
  check('B2 #901 确认前零提交（卡停源列）', stillSource);
  await dialog.getByRole('button', { name: '确认完成' }).click();
} else {
  // before 面：无弹层，静默落位（等卡直接出现在 done 列）。
  await page.waitForTimeout(800);
  const dialogCount = await dialog.count();
  check('B1(before) main 栈拖拽零弹层（静默改相病灶复现）', dialogCount === 0);
}
await page
  .locator('[data-column="done"] [data-todo-id="' + t1.todoId + '"]')
  .waitFor({ state: 'visible', timeout: 20000 });
await page.waitForTimeout(600);
await shot(page, EXPECT + '-drag-done-landed.png');
const todoFace = await getJson(SERVER + '/api/todos/' + t1.todoId);
check('B3 落位后相位 = done', todoFace.body.phase === 'done', 'phase=' + todoFace.body.phase);

// 落位后审计行（new：DONE 行 + actor；old：零行）。
const t1rowsAfter = messageRows(t1.buildId);
const doneRow = t1rowsAfter.rows.find((r) => r.content === DONE_TEXT);
if (EXPECT === 'new') {
  check('B4 #901/#902 done 落地审计行在库', doneRow !== undefined, JSON.stringify(doneRow ?? null));
  check('B5 #902 审计行 actor = seed 用户', doneRow?.actor === USER_NAME, 'actor=' + JSON.stringify(doneRow?.actor ?? null));
  // 详情页时间线：两条 note（通过了确认 / 标记为已完成）可见。
  await page.goto(WEB + '/app/todo/' + t1.todoId, { waitUntil: 'domcontentloaded' });
  await page.getByText(CONFIRM_TEXT).first().waitFor({ state: 'visible', timeout: 30000 });
  await page.getByText(DONE_TEXT).first().waitFor({ state: 'visible', timeout: 15000 });
  await shot(page, EXPECT + '-detail-timeline-actor-notes.png');
  check('B6 #902 详情页时间线渲染两条 actor note', true);
} else {
  check('B4(before) main 栈 done 落地零审计行', doneRow === undefined);
}

// 收录像 → GIF（context 关闭才落 webm）。
const video = page.video();
await context.close();
await browser.close();
const webmPath = await video.path();
await webmToGif(webmPath, EXPECT + '-drag-review-to-done.gif');
rmSync(videoDir, { recursive: true, force: true });

// —— C 相位（仅 new）：chief 工具面 — actor 区分 + complete_todos 拒 ————
if (EXPECT === 'new') {
  const AGENT_B = await makeAgent('verify-chief');
  const bind = await sendJson(
    SERVER + '/api/teams/' + TEAM_ID + '/chief',
    { agent: { agentId: AGENT_B, thinkingLevel: null } },
    'PATCH',
  );
  check('C1 chief 绑定 agent B', bind.status === 200, 'status=' + bind.status);

  const t2 = await seedToConfirm('乙', AGENT_A);
  const thread = await sendJson(SERVER + '/api/teams/' + TEAM_ID + '/chief/threads', {
    content: '请推进乙号任务并汇报',
  });
  if (thread.status !== 201) throw new Error('chief threads → ' + thread.status);
  const threadId = thread.body?.thread?.id;
  const chiefStep = await claimStep('chief');

  // chief relay confirm_builds：过确认闸的 actor 必须记 chief Agent，不是用户。
  const confirmReceipt = await relayTool(chiefStep.id, 'confirm_builds', { buildIds: [t2.buildId] });
  await saveJson('new-chief-confirm-receipt.json', confirmReceipt);
  const t2rows = messageRows(t2.buildId);
  const chiefConfirmRow = t2rows.rows.find((r) => r.content === CONFIRM_TEXT);
  check(
    'C2 #902 chief confirm_builds 行 actor = chief Agent 名（不是用户名）',
    chiefConfirmRow?.actor === 'verify-chief',
    'actor=' + JSON.stringify(chiefConfirmRow?.actor ?? null),
  );

  await advanceToReview(t2.todoId);

  // chief relay complete_todos：review 闸自过必须被拒，回执带拒因。
  const rejectReceipt = await relayTool(chiefStep.id, 'complete_todos', { todoIds: [t2.todoId] });
  await saveJson('new-chief-complete-todos-receipt.json', rejectReceipt);
  check(
    'C3 #900 chief complete_todos review→done 被拒（skipped + 拒因）',
    Array.isArray(rejectReceipt.skipped) &&
      rejectReceipt.skipped.includes(t2.todoId) &&
      typeof rejectReceipt.reasons?.[t2.todoId] === 'string' &&
      rejectReceipt.reasons[t2.todoId].length > 0,
    JSON.stringify(rejectReceipt),
  );
  const t2face = await getJson(SERVER + '/api/todos/' + t2.todoId);
  check('C4 #900 拒后相位仍 review（卡停在闸上）', t2face.body.phase === 'review', 'phase=' + t2face.body.phase);
  const t2rowsAfter = messageRows(t2.buildId);
  check(
    'C5 #900 被拒的落地零审计行（没发生的事不进时间线）',
    t2rowsAfter.rows.find((r) => r.content === DONE_TEXT) === undefined,
  );

  // chief 步收尾（清 claim；失败不判）。
  await doneStep(chiefStep.id, { status: 'success' }).catch(() => {});

  // —— D 相位：SQLite 全量 dump（回读校验的库侧凭证）——————————————
  await saveJson('new-sqlite-message-rows.json', {
    todo1Build: t1.buildId,
    todo1Rows: messageRows(t1.buildId).rows,
    todo2Build: t2.buildId,
    todo2Rows: messageRows(t2.buildId).rows,
  });
  const allRows = [...messageRows(t1.buildId).rows, ...messageRows(t2.buildId).rows];
  const announcementRows = allRows.filter((r) =>
    [CONFIRM_TEXT, DONE_TEXT, MERGE_TEXT, REVIEW_TEXT].includes(r.content),
  );
  // 防空集假过（every 对空集恒 true）：本探针必产 3 条宣告行——todo1 人
  // confirm + todo1 done 落地 + todo2 chief confirm。
  const actorFilled =
    announcementRows.length >= 3 &&
    announcementRows.every((r) => typeof r.actor === 'string' && r.actor.length > 0);
  check(
    'D1 #902 全部宣告行 actor 非空可读（回读校验）',
    actorFilled,
    '宣告行数=' + announcementRows.length,
  );
} else {
  process.stdout.write('skip  C/D 相位（--expect=old：main 无 chief 闸面/actor 列）\n');
}

// —— 汇总 ————————————————————————————————————————————————————————————————
const failed = checks.filter((c) => !c.ok);
await saveJson('result.json', {
  probe: 'drive-902-gate-actor',
  expect: EXPECT,
  stack: { server: SERVER, web: WEB, runDir: RUN_DIR, db: DB_PATH },
  checks,
  artifacts,
});
process.stdout.write(
  '\n' + (failed.length === 0 ? 'ALL PASS' : 'FAILED ' + failed.length) + '  (' + checks.length + ' checks, expect=' + EXPECT + ')\n',
);
process.exit(failed.length === 0 ? 0 : 1);
