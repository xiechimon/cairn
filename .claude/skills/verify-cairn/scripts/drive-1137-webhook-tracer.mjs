// drive-1137-webhook-tracer.mjs — #1137 GitHub webhook → 建 todo + orchestrate
// 事件入口 tracer 探针（纯 live 栈 + 真出站读 GitHub：issue 详情、标签、打标人
// 权限；零 daemon 零 LLM 零浏览器）。
//
// 票面（xiechimon/cairn#1137）：POST /api/webhook/github/:token 收 GitHub
// issues 事件（labeled + 触发 label `cairn`）→ 建 todo（importGithubIssue
// 真出站拉 issue 详情）→ orchestrateTodo（chief 线程 + 首条消息 + pending 步）。
// 三段 tracer 证据：请求段（响应 JSON + pino 日志行 deliveryId 键）／落库段
// （todo 行 sourceKind/sourceRef + webhook_token.lastUsedAt）／派发段
// （chief_thread/chief_message/step 行）。失败路径：错 token 401、重复投递
// （60s 窗口）、同 issue 重放（sourceRef 409 → 202 duplicate）、ping noop、
// 非触发 label ignored、repo 未映射 misconfigured。
// #1459（ADR 0021 D5）起投递带 sender（打标人），receiver 先核 sender 在
// VERIFY_GITHUB_REPO 上是 triage 及以上、项目没到在飞上限（3）才导入；拒收一律
// 202。本探针活体覆盖其中三种：no-sender（载荷不带 sender）、sender-below-
// triage（sender = ghost，GitHub 认不出人时的占位账号，permission 404）、at-cap
// （直插两张在飞的 github-issue 卡凑满 3 张）。permission-unreadable（权限读
// 5xx / 超时 / 形坏）与 rate-limited（429 / 带限流信号的 403）对真 GitHub 造不
// 出来，由 apps/server/test/webhook.test.ts 的 W4 / W4b 覆盖。打标人权限类拒收
// 的 202 detail 是同一句（不说哪种），原因码只在 server.log。
//
// 铺底走真 REST（POST /api/projects + POST /api/teams/:id/webhook-tokens）+
// 服务模块直达（github connection / agent / chief 行——REST 面无 connection
// 写入口（oauth 独占）、agent 创建被 #1259 归属机闸收紧，铺底不是被测面，
// 与 apps/server/test/webhook.test.ts 的直接 DB 行同形）。
//
// env：VERIFY_REPO_ROOT（stack 所在 worktree；缺省 = 本脚本所在仓）、
//      VERIFY_RUN_DIR（缺省 <REPO>/.claude/verify-run，读 ports.json）、
//      VERIFY_EVIDENCE_DIR（缺省 <REPO>/.claude/verify-evidence/<ts>-1137）、
//      GH_WEBHOOK_VERIFY_TOKEN（GitHub connection token，真出站拉 issue 与读
//      打标人权限用；不落任何证据文件）、VERIFY_GITHUB_REPO（缺省
//      xiechimon/cairn）、VERIFY_GITHUB_ISSUE（缺省 1137）、
//      VERIFY_GITHUB_SENDER（投递的 sender：在 VERIFY_GITHUB_REPO 上有 triage、
//      write、maintain 或 admin 的 login，且 GH_WEBHOOK_VERIFY_TOKEN 读得到它的
//      权限；缺省 = VERIFY_GITHUB_REPO 的 owner 段，个人仓的仓主是 admin，组织仓
//      必须显式给）。
// 前置：launch.mjs 已起栈。运行：vp.mjs drive github-webhook webhook-tracer --force，
//      或 cd apps/server && pnpm exec tsx <本脚本>（仓根没有 tsx，#1402 实测；
//      服务模块 import 一律 file:// 绝对 URL——bare 依赖从 apps/server 解析，
//      926 gotcha 同款）。

import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT_REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const REPO = process.env.VERIFY_REPO_ROOT ?? SCRIPT_REPO;
const RUN_DIR = process.env.VERIFY_RUN_DIR ?? join(REPO, '.claude', 'verify-run');
const stack = JSON.parse(readFileSync(join(RUN_DIR, 'ports.json'), 'utf8'));
const SERVER = `http://127.0.0.1:${stack.serverPort}`;
const DB_PATH = join(stack.homeDir, 'server', 'server.db');
const KEYFILE = join(stack.homeDir, 'server', 'secretbox.key');
const GH_TOKEN = process.env.GH_WEBHOOK_VERIFY_TOKEN;
const REPO_FULL = process.env.VERIFY_GITHUB_REPO ?? 'xiechimon/cairn';
const ISSUE_NUMBER = Number(process.env.VERIFY_GITHUB_ISSUE ?? 1137);
// #1459：打标人（webhook sender），须在 REPO_FULL 上 triage 及以上。
const SENDER = process.env.VERIFY_GITHUB_SENDER ?? REPO_FULL.split('/')[0];
const SOURCE_REF = `github:${REPO_FULL}#${ISSUE_NUMBER}`;

const ts = new Date().toISOString().replaceAll(/[:.]/g, '-');
const EVIDENCE = process.env.VERIFY_EVIDENCE_DIR ?? join(SCRIPT_REPO, '.claude/verify-evidence', `${ts}-1137-webhook-tracer`);
mkdirSync(EVIDENCE, { recursive: true });

const checks = [];
function check(name, ok, detail) {
  checks.push({ name, ok: Boolean(ok), detail: detail ?? null });
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}\n`);
}
function save(name, data) {
  writeFileSync(join(EVIDENCE, name), typeof data === 'string' ? data : `${JSON.stringify(data, null, 2)}\n`);
}
function finish(extra = {}) {
  save('result.json', {
    probe: 'drive-1137-webhook-tracer',
    server: SERVER,
    db: DB_PATH,
    githubRepo: REPO_FULL,
    issueNumber: ISSUE_NUMBER,
    passed: checks.filter((c) => c.ok).length,
    total: checks.length,
    checks,
    ...extra,
  });
  process.stdout.write(`\n${checks.filter((c) => c.ok).length}/${checks.length} checks passed → ${EVIDENCE}\n`);
  if (checks.some((c) => !c.ok)) process.exitCode = 1;
}

/** 回环 API 直连（NO_PROXY 语义，仓内既有探针同款；不记 URL 防 token 进证据）。 */
async function jfetch(method, path, opts = {}) {
  const headers = {};
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  for (const [k, v] of Object.entries(opts.headers ?? {})) headers[k] = v;
  const res = await fetch(`${SERVER}${path}`, {
    method,
    headers,
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
    signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000),
  });
  const text = await res.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

function labeledPayload(overrides = {}) {
  return {
    action: 'labeled',
    issue: { number: ISSUE_NUMBER },
    label: { name: 'cairn' },
    repository: { full_name: REPO_FULL },
    sender: { login: SENDER, type: 'User' },
    ...overrides,
  };
}

// —— 铺底：服务模块直达（file:// 绝对 URL；bare 依赖从 apps/server 解析）————
const modUrl = (p) => pathToFileURL(join(REPO, p)).href;
const { openDbWithHandle } = await import(modUrl('apps/server/src/db/client.js'));
const { createKeyfileSecretBox } = await import(modUrl('apps/server/src/lib/secret-box.js'));
const { upsertGithubConnection } = await import(modUrl('apps/server/src/services/github-connection.js'));
const schema = await import(modUrl('apps/server/src/db/schema.js'));

if (!GH_TOKEN) {
  finish({ error: 'GH_WEBHOOK_VERIFY_TOKEN not set' });
  process.exit(1);
}
const opened = openDbWithHandle(DB_PATH);
const db = opened.db;
const box = createKeyfileSecretBox(KEYFILE);

const teamRow = db.select().from(schema.team).all()[0];
const userRow = db.select().from(schema.user).all()[0];
if (!teamRow || !userRow) {
  finish({ error: 'seed team/user missing' });
  process.exit(1);
}
const teamId = teamRow.id;

// github connection（token 密文落库；REST 面无写入口，oauth 独占——服务面直达）
upsertGithubConnection({ db, box }, { teamId, login: 'verify-1137', accessToken: GH_TOKEN, scope: 'repo' });
// chief 绑定 Agent（orchestrateTodo 前置；webhook.test.ts beforeEach 同形 seed）
const agentId = 'agent-verify-1137';
db.insert(schema.agent)
  .values({ id: agentId, teamId, displayName: 'agent-verify-1137', provider: 'stub-gw', modelId: 'stub-model' })
  .run();
const chiefId = `chief-${userRow.id}-${teamId}`;
db.insert(schema.chief)
  .values({
    id: chiefId,
    userId: userRow.id,
    teamId,
    agentId,
    charter: '',
    watches: [],
    wakes: [],
    createdAt: Date.now(),
  })
  .run();

// 项目（github 形态）+ webhook token：真 REST 真用户路径
const projectRes = await jfetch('POST', '/api/projects', {
  body: { name: 'verify-1137', kind: 'github', githubRepo: REPO_FULL },
});
if (projectRes.status !== 201) {
  finish({ error: `project create failed: ${projectRes.status}` });
  process.exit(1);
}
const projectId = projectRes.body.id;
const tokenRes = await jfetch('POST', `/api/teams/${teamId}/webhook-tokens`, { body: { name: 'verify-1137' } });
if (tokenRes.status !== 201) {
  finish({ error: `webhook token create failed: ${tokenRes.status}` });
  process.exit(1);
}
const hookToken = tokenRes.body.plaintext;
save('00-setup.json', { teamId, projectId, webhookTokenId: tokenRes.body.id, masked: tokenRes.body.masked });

const receiver = (token, event, deliveryId, body) =>
  jfetch('POST', `/api/webhook/github/${token}`, {
    headers: { 'x-github-event': event, 'x-github-delivery': deliveryId },
    body,
    timeoutMs: 60_000,
  });

// —— 投递 1：正 token + 触发 label → created 全链（含真出站拉 issue）——————
const dCreated = randomUUID();
const created = await receiver(hookToken, 'issues', dCreated, labeledPayload());
save('01-created.json', { deliveryId: dCreated, ...created });
check('A1 created 202 + result=created + todoId/threadId 回显', created.status === 202 && created.body?.result === 'created' && Boolean(created.body?.todoId) && typeof created.body?.threadId === 'string' && created.body.threadId.startsWith('chief-'), `status=${created.status} result=${created.body?.result}`);
check('A2 deliveryId 原样回显（请求段对账键）', created.body?.deliveryId === dCreated);
const todoId = created.body?.todoId ?? '';
const threadId = created.body?.threadId ?? '';

// —— 落库段：todo 行 + webhook_token 行 ————————————————————————————————
const todoRow = db.select().from(schema.todo).all().find((r) => r.id === todoId);
save('02-todo-row.json', todoRow ?? null);
check('B1 todo 行 sourceKind/sourceRef 落值（落库段）', todoRow?.sourceKind === 'github-issue' && todoRow?.sourceRef === SOURCE_REF, `sourceRef=${todoRow?.sourceRef}`);
check('B2 todo 行 phase=todo + projectId 归属', todoRow?.phase === 'todo' && todoRow?.projectId === projectId);
const tokenRow = db.select().from(schema.webhookToken).all().find((r) => r.id === tokenRes.body.id);
save('03-webhook-token-row.json', tokenRow ? { ...tokenRow, note: 'tokenHash 为 SHA-256；plaintext 永不落库' } : null);
check('B3 webhook_token.lastUsedAt 回写（落库段追踪位）', typeof tokenRow?.lastUsedAt === 'number' && tokenRow.lastUsedAt > 0, `lastUsedAt=${tokenRow?.lastUsedAt}`);
check('B4 token 只存哈希（masked 前缀 + tokenHash 非 plaintext）', typeof tokenRow?.masked === 'string' && tokenRow.masked.startsWith('cairn_wh_') && tokenRow?.tokenHash !== hookToken && /^[0-9a-f]{64}$/.test(String(tokenRow?.tokenHash)));

// —— 派发段：chief_thread / chief_message / step 行 ————————————————————————
const threadRow = db.select().from(schema.chiefThread).all().find((r) => r.id === threadId);
const chiefRow = db.select().from(schema.chief).all().find((r) => r.id === chiefId);
const messages = db.select().from(schema.chiefMessage).all().filter((m) => m.threadId === threadId);
// chief 步挂在编排线程上（webhook.test.ts 同律：step.buildId = threadId）。
const steps = db.select().from(schema.step).all().filter((s) => s.buildId === threadId);
save('04-dispatch-rows.json', { chiefThread: threadRow ?? null, chiefMessages: messages, steps });
check('C1 chief_thread 行落库 + chief 绑定 agent（派发段）', threadRow?.id === threadId && threadRow?.chiefId === chiefId && chiefRow?.agentId === agentId, `threadId=${threadId}`);
check('C2 chief_message 首条用户消息含任务锚点（todo id）', messages.length >= 1 && messages.some((m) => typeof m.content === 'string' && m.content.includes(todoId)), `messages=${messages.length}`);
check('C3 step 行 kind=chief + pending（派发段）', steps.length >= 1 && steps.some((s) => s.kind === 'chief' && s.status === 'pending'), `steps=${steps.length}`);

// —— 投递 2：同 delivery 60s 窗口内重投 → duplicate ————————————————————————
const dupWindow = await receiver(hookToken, 'issues', dCreated, labeledPayload());
save('05-duplicate-window.json', { deliveryId: dCreated, ...dupWindow });
check('D1 重复投递 202 duplicate（60s 窗口）', dupWindow.status === 202 && dupWindow.body?.result === 'duplicate', `status=${dupWindow.status} result=${dupWindow.body?.result}`);

// —— 投递 3：同 issue 不同 delivery（重放）→ sourceRef 409 → duplicate ——————
const dReplay = randomUUID();
const dupReplay = await receiver(hookToken, 'issues', dReplay, labeledPayload());
save('06-duplicate-sourceref.json', { deliveryId: dReplay, ...dupReplay });
check('E1 同 issue 重放 202 duplicate（sourceRef 持久闸）', dupReplay.status === 202 && dupReplay.body?.result === 'duplicate', `status=${dupReplay.status} result=${dupReplay.body?.result}`);
const todoCount = db.select().from(schema.todo).all().filter((r) => r.sourceRef === SOURCE_REF).length;
const threadCount = db.select().from(schema.chiefThread).all().length;
check('E2 重复两路零副作用（todo 恒 1 行 / chief 线程恒 1 条）', todoCount === 1 && threadCount === 1, `todos=${todoCount} threads=${threadCount}`);

// —— 投递 4：错 token → 401 ————————————————————————————————————————————
const dWrong = randomUUID();
const wrong = await receiver(`${hookToken}sabotaged`, 'issues', dWrong, labeledPayload());
save('07-wrong-token.json', { deliveryId: dWrong, ...wrong });
check('F1 错 token 401', wrong.status === 401, `status=${wrong.status}`);

// —— 投递 5：ping → 202 ignored noop —————————————————————————————————————
const dPing = randomUUID();
const ping = await receiver(hookToken, 'ping', dPing, { zen: 'verify' });
save('08-ping.json', { deliveryId: dPing, ...ping });
check('G1 ping 202 ignored（重试风暴防御）', ping.status === 202 && ping.body?.result === 'ignored', `status=${ping.status} result=${ping.body?.result}`);

// —— 投递 6：非触发 label → 202 ignored ————————————————————————————————————
const dLabel = randomUUID();
const otherLabel = await receiver(hookToken, 'issues', dLabel, labeledPayload({ label: { name: 'bug' } }));
save('09-ignored-label.json', { deliveryId: dLabel, ...otherLabel });
check('H1 非触发 label 202 ignored（信噪比闸）', otherLabel.status === 202 && otherLabel.body?.result === 'ignored', `status=${otherLabel.status} result=${otherLabel.body?.result}`);

// —— 投递 7：repo 未映射项目 → 202 misconfigured ———————————————————————————
const dMisconf = randomUUID();
const misconf = await receiver(hookToken, 'issues', dMisconf, labeledPayload({ repository: { full_name: 'xiechimon/no-such-verify-repo' } }));
save('10-misconfigured.json', { deliveryId: dMisconf, ...misconf });
check('I1 repo 未映射 202 misconfigured（不喂重试风暴）', misconf.status === 202 && misconf.body?.result === 'misconfigured', `status=${misconf.status} result=${misconf.body?.result}`);

// —— #1459 拒收（ADR 0021 D5 + 在飞上限）：一律 202，不导入 ——————————————
const SENDER_REFUSED_DETAIL = 'sender not confirmed for import (reason in the server log)';
const todosNow = () => db.select().from(schema.todo).all().filter((r) => r.sourceKind === 'github-issue').length;
const beforeRefusals = todosNow();

// 投递 8：载荷不带 sender → no-sender（零出站）
const dNoSender = randomUUID();
const { sender: _dropped, ...withoutSender } = labeledPayload();
const noSender = await receiver(hookToken, 'issues', dNoSender, withoutSender);
save('12-no-sender.json', { deliveryId: dNoSender, ...noSender });
check('K1 载荷不带 sender 202 ignored「event has no sender」（no-sender）', noSender.status === 202 && noSender.body?.result === 'ignored' && noSender.body?.detail === 'event has no sender', `status=${noSender.status} result=${noSender.body?.result}`);

// 投递 9：sender = ghost（permission 404 = 不到 triage）→ sender-below-triage
const dGhost = randomUUID();
const ghost = await receiver(hookToken, 'issues', dGhost, labeledPayload({ sender: { login: 'ghost', type: 'User' } }));
save('13-sender-below-triage.json', { deliveryId: dGhost, ...ghost });
check('K2 sender 不到 triage 202 ignored，detail 不说是哪种拒收（原因码见 L2）', ghost.status === 202 && ghost.body?.result === 'ignored' && ghost.body?.detail === SENDER_REFUSED_DETAIL, `status=${ghost.status} detail=${ghost.body?.detail}`);

// 投递 10：项目凑满在飞上限（已导入 1 张 + 直插 2 张在飞卡）→ at-cap（零出站）
let seq = 900_000;
for (const n of [990_001, 990_002]) {
  seq += 1;
  db.insert(schema.todo)
    .values({ id: `todo-verify-1459-${n}`, teamId, projectId, title: `verify at-cap ${n}`, spec: '', phase: 'todo', phaseAt: Date.now(), seqNum: seq, sourceKind: 'github-issue', sourceRef: `github:${REPO_FULL}#${n}`, createdBy: userRow.id })
    .run();
}
const dCap = randomUUID();
const atCap = await receiver(hookToken, 'issues', dCap, labeledPayload());
save('14-at-cap.json', { deliveryId: dCap, ...atCap });
check('K3 项目到在飞上限 202 ignored（at-cap）', atCap.status === 202 && atCap.body?.result === 'ignored' && atCap.body?.detail === 'project at the in-flight cap (3 open github-issue tasks)', `status=${atCap.status} detail=${atCap.body?.detail}`);
check('K4 三种拒收都没建卡', todosNow() === beforeRefusals + 2, `github-issue todos=${todosNow()} (before=${beforeRefusals}, +2 seeded for K3)`);

// —— 请求段日志：pino 每投递一条结构化记录（pretty 多行形态：头行 msg +
// deliveryId 行 + result 行），按 deliveryId 键落 server.log ————————————
const serverLog = readFileSync(join(RUN_DIR, 'server.log'), 'utf8');
const consumed = [dCreated, dReplay, dPing, dLabel, dMisconf, dNoSender, dGhost, dCap];
const lines = serverLog.split('\n');
const deliveryLineIdx = lines.map((l, i) => ({ l, i })).filter(({ l }) => consumed.some((d) => l.includes(d)));
const keep = new Set();
// 拒收行（'github webhook import refused'）的 reason / detail 在 deliveryId 之后
// 几行（pretty 形态每个字段一行），窗口取到 +8 行。
for (const { i } of deliveryLineIdx) {
  for (let j = Math.max(0, i - 1); j <= Math.min(lines.length - 1, i + 8); j++) keep.add(j);
}
const logEntries = [...keep].sort((a, b) => a - b).map((i) => lines[i]);
save('11-tracer-server-log.txt', logEntries.join('\n') + '\n');
const missingDeliveries = consumed.filter((d) => !lines.some((l) => l.includes(d)));
check('J1 server.log 里每条被消费的投递都有 deliveryId 追踪记录（8 条投递）', missingDeliveries.length === 0, `missing=${missingDeliveries.length} lines=${deliveryLineIdx.length}`);
check('J2 created 投递记录带 result: "created"（pino 结构化）', lines.some((l, i) => l.includes(dCreated) && (lines[i + 1] ?? '').includes('"created"')));
// #1459 拒收的原因码只在日志里（202 的 detail 对打标人权限类拒收只有同一句）。
// pretty 形态字段在 deliveryId 之后几行，JSON 形态在同一行：两种都认。
const refusalReason = (deliveryId, reason) =>
  lines.some((l, i) => l.includes(deliveryId) && lines.slice(i, i + 9).some((n) => n.includes(`"${reason}"`)));
check('L1 no-sender 投递的日志原因码 no-sender', refusalReason(dNoSender, 'no-sender'));
check('L2 ghost 投递的日志原因码 sender-below-triage（不是 permission-unreadable / rate-limited）', refusalReason(dGhost, 'sender-below-triage'));
check('L3 at-cap 投递的日志原因码 at-cap', refusalReason(dCap, 'at-cap'));

opened.close();
finish({
  note: '铺底（connection/agent/chief）经服务模块直达——REST 面无 connection 写入口（oauth 独占），agent 创建被 #1259 归属机闸收紧，铺底非被测面，与 webhook.test.ts 同形。token plaintext 不落任何证据文件。',
});
