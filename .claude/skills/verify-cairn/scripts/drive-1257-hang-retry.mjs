#!/usr/bin/env node
// verify-cairn 定制 probe（#1257 无人认领挂起 + 额度挂起 + 流断续跑）：活栈
// 全链取证，三腿——
//   A（等机器）  建 todo/build 后**不启 daemon**，等 130s（旧 120s 判死窗）：
//     步仍 pending、todo 不落 failed、errorMessage 空、todo.waitingOn={on:
//     machine}；板面「等机器」chip 截图。然后启 daemon → 无人工操作自动
//     续跑：plan 步被领、stub 写 plan.md、步 done、todo 到 confirm。
//   B（等额度）  stub LLM 首请求回 402 quota → daemon 报失败 → server 挂起
//     （pending + holdReason=quota + holdUntil、todo 不落 failed、conv 等额度
//     system 行、板面「等额度」chip）→ 退避 60s 到期自动重领 → stub 第二次
//     起回正常应答 → 步 done、todo 到 confirm（零人工操作跑完）。
//   C（流断续跑）stub 前两次请求流中段断连（写部分 SSE 后 destroy）→ 第三
//     次正常应答 → 步 done（会话续跑不断会话：stub 收到的第 2/3 次请求体
//     含第 1 次已产出的内容 = 同一会话在续）。
// 断言面：SQLite step/build/todo 行 + REST todo record + Playwright 板面
// 截图 + daemon.log（provider network retry 行）。双向：before 证据 =
// 单测红态（docs/verify/1257/before-*.txt，本 probe 不复放旧判死——旧码在
// 本 worktree 已改，before 由单测面承担）。

import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const SCRIPT_REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const REPO = process.env.VERIFY_REPO_ROOT ?? SCRIPT_REPO;
const RUN_DIR = process.env.VERIFY_RUN_DIR ?? join(REPO, '.claude', 'verify-run');
const portsFile = join(RUN_DIR, 'ports.json');
if (!existsSync(portsFile)) {
  process.stderr.write(`无栈：${portsFile} 不存在。先跑 launch.mjs\n`);
  process.exit(1);
}
const stack = JSON.parse(readFileSync(portsFile, 'utf8'));
const SERVER = `http://127.0.0.1:${stack.serverPort}`;
const WEB = `http://127.0.0.1:${stack.webPort}`;
const HOME_DIR = stack.homeDir;
const DB_PATH = join(HOME_DIR, 'server', 'server.db');
const require2 = createRequire(join(REPO, 'apps/server/package.json'));
const Database = require2('better-sqlite3');

const runTag = `${Date.now().toString(36)}`;
const EVIDENCE = process.env.VERIFY_EVIDENCE_DIR ?? join(SCRIPT_REPO, `.claude/verify-evidence/${runTag}-1257`);
mkdirSync(EVIDENCE, { recursive: true });
const DAEMON_HOME = join(RUN_DIR, 'daemon-home-1257');

const checks = [];
function check(name, ok, detail) {
  if (typeof ok !== 'boolean') throw new TypeError(`check ok must be boolean: ${name}`);
  checks.push({ name, ok, detail: detail ?? null });
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}\n`);
}
const artifacts = [];
function save(name, data) {
  writeFileSync(join(EVIDENCE, name), typeof data === 'string' ? data : `${JSON.stringify(data, null, 2)}\n`);
  artifacts.push(name);
}

async function jfetch(method, path, body) {
  const res = await fetch(`${SERVER}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
  let text = await res.text();
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* keep text */
  }
  return { status: res.status, body: parsed, text };
}

// —— stub LLM：三个独立 server（每腿一个，baseUrl 直连——pi 会往 baseUrl
//    追加 /chat/completions，query 串切腿会被拼进路径打到 404，实测坑）：
//    ok = 正常应答（bash heredoc 写 plan.md）；quotaFirst = 首请求回 402 配额、
//    之后正常；cutTwice = 前两次请求 SSE 中段 destroy、之后正常。
//    toolCall 形 = drive-1025 同款。—————————————————————————————
function startStubServer(behavior, log) {
  const server = createServer((req, res) => {
    if (req.method !== 'POST' || !req.url?.endsWith('/chat/completions')) {
      res.writeHead(404).end();
      return;
    }
    let body = '';
    req.on('data', (d) => {
      body += d;
    });
    req.on('end', () => {
      log.push(JSON.parse(body));
      const base = {
        id: 'chatcmpl-stub',
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: 'stub-model',
      };
      const chunk = (payload) => `data: ${JSON.stringify(payload)}\n\n`;
      const toolCall = MODE_TOOLCALL[behavior];
      // 轮次交替（drive-1025 同律）：首个真应答 = 写 plan.md 的 toolcall，
      // 其后一律纯文本收轮——stub 恒回 toolcall 会把会话顶成无限工具环。
      const prelude = behavior === 'quota-first' ? 1 : behavior === 'cut-twice' ? 2 : 0;
      const send = () => {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
        res.write(chunk({ ...base, choices: [{ index: 0, delta: { role: 'assistant', content: '开工。' }, finish_reason: null }] }));
        if (log.length === prelude + 1) {
          const callId = `call-${behavior}-${runTag}-${log.length}`;
          res.write(chunk({ ...base, choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: callId, type: 'function', function: { name: toolCall.name, arguments: '' } }] }, finish_reason: null }] }));
          res.write(chunk({ ...base, choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: JSON.stringify(toolCall.arguments ?? {}) } }] }, finish_reason: null }] }));
          res.write(chunk({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] }));
        } else {
          res.write(chunk({ ...base, choices: [{ index: 0, delta: { content: '探针规划完成。' }, finish_reason: null }] }));
          res.write(chunk({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }));
        }
        res.write(chunk({ ...base, choices: [], usage: { prompt_tokens: 12, completion_tokens: 40, total_tokens: 52 } }));
        res.write('data: [DONE]\n\n');
        res.end();
      };
      if (behavior === 'quota-first' && log.length === 1) {
        res.writeHead(402, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ message: 'insufficient quota: usage limit reached for this billing period', code: 'quota_exceeded' }));
        return;
      }
      if (behavior === 'cut-twice' && log.length <= 2) {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
        res.write(chunk({ ...base, choices: [{ index: 0, delta: { role: 'assistant', content: '写了一半' }, finish_reason: null }] }));
        res.destroy();
        return;
      }
      send();
    });
  });
  return new Promise((resolve2) => {
    server.listen(0, '127.0.0.1', () => {
      resolve2({
        url: `http://127.0.0.1:${server.address().port}/v1`,
        requests: log,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

const PLAN_MARKER = `PLAN-1257-MARKER-${runTag}`;
const PLAN_CONTENT = [
  '# 方案：#1257 挂起续跑探针',
  '',
  `Marker 行：${PLAN_MARKER}`,
  'Changes: 挂起恢复后首轮即落 plan.md。',
  'Verification: plan 行 v1 + confirm 卡有物即验证。',
  '',
].join('\n');
const MODE_TOOLCALL = {
  ok: { name: 'bash', arguments: { command: `cat > plan.md <<'PLANEOF'\n${PLAN_CONTENT}PLANEOF` } },
  'quota-first': { name: 'bash', arguments: { command: `cat > plan.md <<'PLANEOF'\n${PLAN_CONTENT}PLANEOF` } },
  'cut-twice': { name: 'bash', arguments: { command: `cat > plan.md <<'PLANEOF'\n${PLAN_CONTENT}PLANEOF` } },
};

function spawnDaemon(apiKey, teamId) {
  const env = { ...process.env };
  for (const k of ['http_proxy', 'https_proxy', 'all_proxy', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY']) delete env[k];
  env.NO_PROXY = '*';
  env.CAIRN_HOME = DAEMON_HOME;
  const out = join(EVIDENCE, 'daemon-console.log');
  writeFileSync(out, '');
  const child = spawn('pnpm', ['exec', 'tsx', 'src/cli.ts', 'start', '--foreground', '--server', SERVER, '--api-key', apiKey, '--team', teamId, '--name', 'verify-1257'], {
    cwd: join(REPO, 'apps/daemon'),
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (d) => appendFileSync(out, d));
  child.stderr.on('data', (d) => appendFileSync(out, d));
  child.on('exit', (code) => appendFileSync(out, `\n[probe] daemon exited code=${code}\n`));
  return child;
}

function openDb() {
  return new Database(DB_PATH, { readonly: true });
}
function stepRows(db, buildId) {
  return db.prepare('SELECT * FROM step WHERE buildId = ? ORDER BY createdAt').all(buildId);
}
function todoRow(db, todoId) {
  return db.prepare('SELECT * FROM todo WHERE id = ?').get(todoId);
}
function buildRow(db, buildId) {
  return db.prepare('SELECT * FROM build WHERE id = ?').get(buildId);
}
function convRows(db, conversationId) {
  return db.prepare('SELECT id, role, content FROM message WHERE conversationId = ? ORDER BY createdAt').all(conversationId);
}
function planRows(db, buildId) {
  return db.prepare("SELECT id, version, content FROM plan WHERE buildId = ? ORDER BY version").all(buildId);
}

async function waitFor(pred, timeoutMs, label) {
  const started = Date.now();
  for (;;) {
    const v = await pred();
    if (v) return v;
    if (Date.now() - started > timeoutMs) throw new Error(`waitFor timeout: ${label}`);
    await new Promise((r) => setTimeout(r, 1000));
  }
}

async function boardShot(todoId, name) {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`${WEB}/app`, { waitUntil: 'networkidle' });
  const card = page.locator(`[data-todo-id="${todoId}"]`);
  await card.waitFor({ state: 'visible', timeout: 15000 });
  await page.screenshot({ path: join(EVIDENCE, name), fullPage: false });
  const chipText = await card.locator('span, div').filter({ hasText: /^等机器$|^等额度$/ }).allTextContents();
  await browser.close();
  artifacts.push(name);
  return chipText;
}

let stub = null;
let daemon = null;
let browser = null;
try {
  const logA = [];
  const logB = [];
  const logC = [];
  const stubOk = await startStubServer('ok', logA);
  const stubQuota = await startStubServer('quota-first', logB);
  const stubCut = await startStubServer('cut-twice', logC);
  stub = { requests: [], close: async () => { await stubOk.close(); await stubQuota.close(); await stubCut.close(); } };

  // —— seed：provider（三腿各一，baseUrl query 切模式）+ agent + api-key ——
  const teams = await jfetch('GET', '/api/teams');
  const teamId = teams.body[0]?.id ?? teams.body.teams?.[0]?.id;
  const modeUrls = { a: stubOk.url, b: stubQuota.url, c: stubCut.url };
  const agents = {};
  for (const leg of ['a', 'b', 'c']) {
    const pid = `stub-1257-${leg}-${runTag}`;
    const pr = await jfetch('POST', `/api/teams/${teamId}/providers`, {
      providerId: pid,
      label: pid,
      baseUrl: modeUrls[leg],
      api: 'openai-completions',
      authHeader: true,
      compat: { supportsDeveloperRole: false },
      models: [{ id: 'stub-model', name: 'stub-model' }],
    });
    if (pr.status >= 400) throw new Error(`provider ${leg} create failed: ${pr.status} ${JSON.stringify(pr.body).slice(0, 300)}`);
    const ar = await jfetch('POST', `/api/teams/${teamId}/agents`, {
      displayName: `probe-1257-${leg}`,
      provider: pid,
      modelId: 'stub-model',
      skills: [],
    });
    agents[leg] = ar.body?.id ?? ar.body?.agent?.id;
    if (!agents[leg]) throw new Error(`agent ${leg} create failed: ${ar.status}`);
  }
  const keyRes = await jfetch('POST', `/api/teams/${teamId}/api-keys`, {
    name: `probe-1257-${runTag}`,
    gitAccess: true,
    mcpAccess: false,
    toolGrants: { read: [], write: [] },
  });
  const apiKey = keyRes.body?.plaintext ?? keyRes.body?.key;
  if (!apiKey) throw new Error(`api-key create failed: ${keyRes.status}`);

  async function makeTask(leg, title) {
    const projRes = await jfetch('POST', '/api/projects', { name: `probe-1257-${leg}-${runTag}`, teamId, repoKind: 'hosted' });
    const projectId = projRes.body?.id;
    const todoRes = await jfetch('POST', `/api/projects/${projectId}/todos`, { title, spec: '挂起续跑探针。' });
    const todoId = todoRes.body?.id;
    const buildRes = await jfetch('POST', `/api/projects/${projectId}/builds`, {
      todoIds: [todoId],
      assignment: { plan: { agentId: agents[leg] }, build: { agentId: agents[leg] } },
      withPlan: true,
    });
    const buildId = buildRes.body?.builds?.[0]?.id;
    if (!todoId || !buildId) throw new Error(`task ${leg} seed failed`);
    return { todoId, buildId };
  }

  // ============ Leg A：等机器（无 daemon → 挂起 → daemon 回来续跑）============
  const taskA = await makeTask('a', '1257A 等机器探针');
  save('a-seed.json', { taskA });
  // 无 daemon：等过旧的 120s 判死窗（+10s 余量）。
  process.stdout.write('legA: waiting 130s with no daemon (old fail window was 120s)…\n');
  await new Promise((r) => setTimeout(r, 130_000));
  {
    const db = openDb();
    const steps = stepRows(db, taskA.buildId);
    const t = todoRow(db, taskA.todoId);
    const b = buildRow(db, taskA.buildId);
    check('A1 超判死窗后步仍 pending（挂起不判死）', steps.length > 0 && steps.every((s) => s.status === 'pending'), `statuses=${steps.map((s) => s.status).join(',')}`);
    check('A2 todo 不落 failed（相位在飞）', ['queued', 'planning'].includes(t.phase), `phase=${t.phase}`);
    check('A3 build.errorMessage 为空（无失败痕迹）', b.errorMessage == null, `errorMessage=${b.errorMessage}`);
    db.close();
  }
  const todoApi = await jfetch('GET', `/api/todos/${taskA.todoId}`);
  check(
    'A4 REST todo.waitingOn = 等机器',
    todoApi.body?.waitingOn?.on === 'machine',
    `waitingOn=${JSON.stringify(todoApi.body?.waitingOn)}`,
  );
  const chipA = await boardShot(taskA.todoId, 'a-board-waiting-machine.png');
  check('A5 板面「等机器」chip 可见', chipA.includes('等机器'), `chips=${JSON.stringify(chipA)}`);
  save('a-todo-record.json', todoApi.body);

  // daemon 回来：无人工操作自动续跑 → plan 步 done + plan.md 行 + todo confirm。
  daemon = spawnDaemon(apiKey, teamId);
  const dbA = openDb();
  await waitFor(
    () => {
      const t = todoRow(dbA, taskA.todoId);
      return t.phase === 'confirm' ? t : null;
    },
    150_000,
    'legA plan step completion → confirm',
  );
  const stepsA = stepRows(dbA, taskA.buildId);
  const plansA = planRows(dbA, taskA.buildId);
  check('A6 daemon 回来后 plan 步自动 done', stepsA.some((s) => s.kind === 'plan' && s.status === 'done'), `steps=${stepsA.map((s) => `${s.kind}:${s.status}`).join(',')}`);
  check('A7 plan.md 落库（自动续跑产出真产物）', plansA.length >= 1 && plansA[0].content.includes(PLAN_MARKER), `plans=${plansA.length}`);
  check('A8 todo 到 confirm（续跑成功收口）', todoRow(dbA, taskA.todoId).phase === 'confirm');
  save('a-final.json', { steps: stepsA, plans: plansA });
  dbA.close();

  // ============ Leg B：等额度（402 → 挂起 → 退避到期自动续跑跑完）============
  const taskB = await makeTask('b', '1257B 等额度探针');
  // 等 quota 失败上报 + 挂起落位（daemon 在跑）。
  const dbB = openDb();
  const held = await waitFor(
    () => {
      const rows = stepRows(dbB, taskB.buildId);
      const s = rows.find((r) => r.kind === 'plan');
      return s && s.status === 'pending' && s.holdReason === 'quota' ? s : null;
    },
    90_000,
    'legB quota hold lands',
  );
  check('B1 402 配额失败 → 步挂起（pending + holdReason=quota）', held.status === 'pending' && held.holdReason === 'quota', `holdUntil=${held.holdUntil} holdCount=${held.holdCount}`);
  check('B2 holdCount=1（首档退避 60s）', held.holdCount === 1, `holdCount=${held.holdCount}`);
  check('B3 sessionId 在位（重领续跑面）', typeof held.sessionId === 'string' && held.sessionId.length > 0, `sessionId=${held.sessionId}`);
  const tB = todoRow(dbB, taskB.todoId);
  const bB = buildRow(dbB, taskB.buildId);
  check('B4 todo 不落 failed', tB.phase !== 'failed', `phase=${tB.phase}`);
  check('B5 build.errorMessage 为空', bB.errorMessage == null, `errorMessage=${bB.errorMessage}`);
  const holdMsg = convRows(dbB, taskB.buildId).find((m) => m.id === `quota-hold-${held.id}`);
  check('B6 会话「等额度」system 行在位（含下次尝试）', holdMsg != null && String(holdMsg.content).includes('等额度') && String(holdMsg.content).includes('下次尝试'), `content=${String(holdMsg?.content).slice(0, 80)}`);
  const todoApiB = await jfetch('GET', `/api/todos/${taskB.todoId}`);
  check('B7 REST todo.waitingOn = 等额度', todoApiB.body?.waitingOn?.on === 'quota', `waitingOn=${JSON.stringify(todoApiB.body?.waitingOn)}`);
  const chipB = await boardShot(taskB.todoId, 'b-board-waiting-quota.png');
  check('B8 板面「等额度」chip 可见', chipB.includes('等额度'), `chips=${JSON.stringify(chipB)}`);
  save('b-hold.json', { step: held, todo: tB, build: bB });
  save('b-todo-record.json', todoApiB.body);

  // 退避 60s 到期 → 自动重领 → stub 第二次正常 → 跑完。
  process.stdout.write('legB: waiting for 60s backoff to expire and step to auto-complete…\n');
  await waitFor(
    () => {
      const t = todoRow(dbB, taskB.todoId);
      return t.phase === 'confirm' ? t : null;
    },
    200_000,
    'legB auto-resume after backoff → confirm',
  );
  const stepsB = stepRows(dbB, taskB.buildId);
  const plansB = planRows(dbB, taskB.buildId);
  const stepB = stepsB.find((s) => s.kind === 'plan');
  check('B9 退避到期自动重领且挂起位清零', stepB.status === 'done' && stepB.holdReason == null && stepB.holdUntil == null, `status=${stepB.status} hold=${stepB.holdReason}`);
  check('B10 额度恢复后自动跑完（plan.md 落库）', plansB.length >= 1 && plansB[0].content.includes(PLAN_MARKER), `plans=${plansB.length}`);
  check('B11 todo 到 confirm（零人工操作）', todoRow(dbB, taskB.todoId).phase === 'confirm');
  save('b-final.json', { steps: stepsB, plans: plansB });
  dbB.close();

  // ============ Leg C：流断续跑（两次中段断连 → 第三次成功）============
  const taskC = await makeTask('c', '1257C 流断续跑探针');
  const dbC = openDb();
  await waitFor(
    () => {
      const t = todoRow(dbC, taskC.todoId);
      return t.phase === 'confirm' ? t : null;
    },
    200_000,
    'legC stream-cut retries → confirm',
  );
  const stepsC = stepRows(dbC, taskC.buildId);
  const plansC = planRows(dbC, taskC.buildId);
  const cuts = logC.length;
  const retryLines = readFileSync(join(DAEMON_HOME, 'daemon.log'), 'utf8')
    .split('\n')
    .filter((l) => l.includes('provider network retry'));
  check('C1 两次断流后第三发成功（stub 收到 ≥3 次请求）', cuts >= 3, `cutModeRequests=${cuts}`);
  check('C2 步 done（流断不判死）', stepsC.some((s) => s.kind === 'plan' && s.status === 'done'), `steps=${stepsC.map((s) => `${s.kind}:${s.status}`).join(',')}`);
  check('C3 会话续跑产出 plan.md（第三发落物）', plansC.length >= 1 && plansC[0].content.includes(PLAN_MARKER), `plans=${plansC.length}`);
  check('C4 todo 到 confirm', todoRow(dbC, taskC.todoId).phase === 'confirm');
  save('c-final.json', { steps: stepsC, plans: plansC, networkRetryLogLines: retryLines, cutRequests: cuts });
  dbC.close();
  // 断流重试层的可见证据：runner 重试行或 pi auto_retry 行（任一层吸收都算
  // 续跑成功；runner 层的行样 = `provider network retry N`）。
  const autoRetryLines = readFileSync(join(DAEMON_HOME, 'daemon.log'), 'utf8')
    .split('\n')
    .filter((l) => l.includes('auto_retry_start') || l.includes('provider network retry'));
  check('C5 重试层的日志在位（runner 续跑行或 pi auto_retry）', autoRetryLines.length > 0, `lines=${autoRetryLines.length}`);
  save('c-retry-evidence.json', { networkRetry: retryLines, anyRetry: autoRetryLines.slice(-10) });

  save('stub-requests-summary.json', { a: logA.length, b: logB.length, c: logC.length });
} finally {
  try {
    if (daemon && daemon.exitCode === null) daemon.kill('SIGTERM');
  } catch {}
  try {
    if (stub) await stub.close();
  } catch {}
  try {
    if (browser) await browser.close();
  } catch {}
}

const failed = checks.filter((c) => !c.ok);
process.stdout.write(`\n${failed.length === 0 ? 'ALL PASS' : 'HAS FAILURES'}: ${checks.length - failed.length}/${checks.length}\n`);
if (failed.length > 0) {
  for (const f of failed) process.stdout.write(`FAIL  ${f.name}  — ${f.detail}\n`);
  process.exitCode = 1;
}
