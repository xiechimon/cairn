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

upsertGithubConnection({ db, box }, { teamId, login: 'verify-1137', accessToken: GH_TOKEN, scope: 'repo' });

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

const dCreated = randomUUID();
const created = await receiver(hookToken, 'issues', dCreated, labeledPayload());
save('01-created.json', { deliveryId: dCreated, ...created });
check('A1 created 202 + result=created + todoId/threadId 回显', created.status === 202 && created.body?.result === 'created' && Boolean(created.body?.todoId) && typeof created.body?.threadId === 'string' && created.body.threadId.startsWith('chief-'), `status=${created.status} result=${created.body?.result}`);
check('A2 deliveryId 原样回显（请求段对账键）', created.body?.deliveryId === dCreated);
const todoId = created.body?.todoId ?? '';
const threadId = created.body?.threadId ?? '';

const todoRow = db.select().from(schema.todo).all().find((r) => r.id === todoId);
save('02-todo-row.json', todoRow ?? null);
check('B1 todo 行 sourceKind/sourceRef 落值（落库段）', todoRow?.sourceKind === 'github-issue' && todoRow?.sourceRef === SOURCE_REF, `sourceRef=${todoRow?.sourceRef}`);
check('B2 todo 行 phase=todo + projectId 归属', todoRow?.phase === 'todo' && todoRow?.projectId === projectId);
const tokenRow = db.select().from(schema.webhookToken).all().find((r) => r.id === tokenRes.body.id);
save('03-webhook-token-row.json', tokenRow ? { ...tokenRow, note: 'tokenHash 为 SHA-256；plaintext 永不落库' } : null);
check('B3 webhook_token.lastUsedAt 回写（落库段追踪位）', typeof tokenRow?.lastUsedAt === 'number' && tokenRow.lastUsedAt > 0, `lastUsedAt=${tokenRow?.lastUsedAt}`);
check('B4 token 只存哈希（masked 前缀 + tokenHash 非 plaintext）', typeof tokenRow?.masked === 'string' && tokenRow.masked.startsWith('cairn_wh_') && tokenRow?.tokenHash !== hookToken && /^[0-9a-f]{64}$/.test(String(tokenRow?.tokenHash)));

const threadRow = db.select().from(schema.chiefThread).all().find((r) => r.id === threadId);
const chiefRow = db.select().from(schema.chief).all().find((r) => r.id === chiefId);
const messages = db.select().from(schema.chiefMessage).all().filter((m) => m.threadId === threadId);

const steps = db.select().from(schema.step).all().filter((s) => s.buildId === threadId);
save('04-dispatch-rows.json', { chiefThread: threadRow ?? null, chiefMessages: messages, steps });
check('C1 chief_thread 行落库 + chief 绑定 agent（派发段）', threadRow?.id === threadId && threadRow?.chiefId === chiefId && chiefRow?.agentId === agentId, `threadId=${threadId}`);
check('C2 chief_message 首条用户消息含任务锚点（todo id）', messages.length >= 1 && messages.some((m) => typeof m.content === 'string' && m.content.includes(todoId)), `messages=${messages.length}`);
check('C3 step 行 kind=chief + pending（派发段）', steps.length >= 1 && steps.some((s) => s.kind === 'chief' && s.status === 'pending'), `steps=${steps.length}`);

const dupWindow = await receiver(hookToken, 'issues', dCreated, labeledPayload());
save('05-duplicate-window.json', { deliveryId: dCreated, ...dupWindow });
check('D1 重复投递 202 duplicate（60s 窗口）', dupWindow.status === 202 && dupWindow.body?.result === 'duplicate', `status=${dupWindow.status} result=${dupWindow.body?.result}`);

const dReplay = randomUUID();
const dupReplay = await receiver(hookToken, 'issues', dReplay, labeledPayload());
save('06-duplicate-sourceref.json', { deliveryId: dReplay, ...dupReplay });
check('E1 同 issue 重放 202 duplicate（sourceRef 持久闸）', dupReplay.status === 202 && dupReplay.body?.result === 'duplicate', `status=${dupReplay.status} result=${dupReplay.body?.result}`);
const todoCount = db.select().from(schema.todo).all().filter((r) => r.sourceRef === SOURCE_REF).length;
const threadCount = db.select().from(schema.chiefThread).all().length;
check('E2 重复两路零副作用（todo 恒 1 行 / chief 线程恒 1 条）', todoCount === 1 && threadCount === 1, `todos=${todoCount} threads=${threadCount}`);

const dWrong = randomUUID();
const wrong = await receiver(`${hookToken}sabotaged`, 'issues', dWrong, labeledPayload());
save('07-wrong-token.json', { deliveryId: dWrong, ...wrong });
check('F1 错 token 401', wrong.status === 401, `status=${wrong.status}`);

const dPing = randomUUID();
const ping = await receiver(hookToken, 'ping', dPing, { zen: 'verify' });
save('08-ping.json', { deliveryId: dPing, ...ping });
check('G1 ping 202 ignored（重试风暴防御）', ping.status === 202 && ping.body?.result === 'ignored', `status=${ping.status} result=${ping.body?.result}`);

const dLabel = randomUUID();
const otherLabel = await receiver(hookToken, 'issues', dLabel, labeledPayload({ label: { name: 'bug' } }));
save('09-ignored-label.json', { deliveryId: dLabel, ...otherLabel });
check('H1 非触发 label 202 ignored（信噪比闸）', otherLabel.status === 202 && otherLabel.body?.result === 'ignored', `status=${otherLabel.status} result=${otherLabel.body?.result}`);

const dMisconf = randomUUID();
const misconf = await receiver(hookToken, 'issues', dMisconf, labeledPayload({ repository: { full_name: 'xiechimon/no-such-verify-repo' } }));
save('10-misconfigured.json', { deliveryId: dMisconf, ...misconf });
check('I1 repo 未映射 202 misconfigured（不喂重试风暴）', misconf.status === 202 && misconf.body?.result === 'misconfigured', `status=${misconf.status} result=${misconf.body?.result}`);

const SENDER_REFUSED_DETAIL = 'sender not confirmed for import (reason in the server log)';
const todosNow = () => db.select().from(schema.todo).all().filter((r) => r.sourceKind === 'github-issue').length;
const beforeRefusals = todosNow();

const dNoSender = randomUUID();
const { sender: _dropped, ...withoutSender } = labeledPayload();
const noSender = await receiver(hookToken, 'issues', dNoSender, withoutSender);
save('12-no-sender.json', { deliveryId: dNoSender, ...noSender });
check('K1 载荷不带 sender 202 ignored「event has no sender」（no-sender）', noSender.status === 202 && noSender.body?.result === 'ignored' && noSender.body?.detail === 'event has no sender', `status=${noSender.status} result=${noSender.body?.result}`);

const dGhost = randomUUID();
const ghost = await receiver(hookToken, 'issues', dGhost, labeledPayload({ sender: { login: 'ghost', type: 'User' } }));
save('13-sender-below-triage.json', { deliveryId: dGhost, ...ghost });
check('K2 sender 不到 triage 202 ignored，detail 不说是哪种拒收（原因码见 L2）', ghost.status === 202 && ghost.body?.result === 'ignored' && ghost.body?.detail === SENDER_REFUSED_DETAIL, `status=${ghost.status} detail=${ghost.body?.detail}`);

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

const serverLog = readFileSync(join(RUN_DIR, 'server.log'), 'utf8');
const consumed = [dCreated, dReplay, dPing, dLabel, dMisconf, dNoSender, dGhost, dCap];
const lines = serverLog.split('\n');
const deliveryLineIdx = lines.map((l, i) => ({ l, i })).filter(({ l }) => consumed.some((d) => l.includes(d)));
const keep = new Set();

for (const { i } of deliveryLineIdx) {
  for (let j = Math.max(0, i - 1); j <= Math.min(lines.length - 1, i + 8); j++) keep.add(j);
}
const logEntries = [...keep].sort((a, b) => a - b).map((i) => lines[i]);
save('11-tracer-server-log.txt', logEntries.join('\n') + '\n');
const missingDeliveries = consumed.filter((d) => !lines.some((l) => l.includes(d)));
check('J1 server.log 里每条被消费的投递都有 deliveryId 追踪记录（8 条投递）', missingDeliveries.length === 0, `missing=${missingDeliveries.length} lines=${deliveryLineIdx.length}`);
check('J2 created 投递记录带 result: "created"（pino 结构化）', lines.some((l, i) => l.includes(dCreated) && (lines[i + 1] ?? '').includes('"created"')));

const refusalReason = (deliveryId, reason) =>
  lines.some((l, i) => l.includes(deliveryId) && lines.slice(i, i + 9).some((n) => n.includes(`"${reason}"`)));
check('L1 no-sender 投递的日志原因码 no-sender', refusalReason(dNoSender, 'no-sender'));
check('L2 ghost 投递的日志原因码 sender-below-triage（不是 permission-unreadable / rate-limited）', refusalReason(dGhost, 'sender-below-triage'));
check('L3 at-cap 投递的日志原因码 at-cap', refusalReason(dCap, 'at-cap'));

opened.close();
finish({
  note: '铺底（connection/agent/chief）经服务模块直达——REST 面无 connection 写入口（oauth 独占），agent 创建被 #1259 归属机闸收紧，铺底非被测面，与 webhook.test.ts 同形。token plaintext 不落任何证据文件。',
});
