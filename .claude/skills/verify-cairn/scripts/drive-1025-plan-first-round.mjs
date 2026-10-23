// verify-cairn 定制 probe（#1025 首轮规划提示词注入 plan.md 契约）：契约
// 此前只存在于纠错提示词（补写轮 #113 / 驳回重规划 / 审核打回 / 失败重启），
// 首个 plan 步 prompt=null、agent 只拿到 title+spec——写不写 plan.md 全凭模型
// 自觉（#892 实测 28 build / 0 行 plan.md 的结构性根因）。本 probe 在活栈上把
// 「契约真的进了首轮会话」证成实物（机制生效验收取实物，读码不算）：真
// daemon + stub LLM + Playwright 浏览器面。两条腿各钉一族失败方式：
//   A 腿（正向）  stub 首轮即写 plan.md：claim → 真 daemon 认领 → 会话首条
//                 user 消息 = 任务文本 + 契约指令组合串（从 stub 收到的真实
//                 请求体断言，非读码「看着像」）→ plan 行 v1 首轮落库 → 恰一
//                 个 plan 步（无补写轮）→ confirm + hasPlan → wire 行同串 →
//                 浏览器面 confirm 卡有物 + 组合行不成用户气泡（#612 套娃面）。
//   B 腿（负对照）stub 收到契约仍不写 plan.md：链路行为有明确定义——
//                 #113 补写轮入队（第二个 plan 步，prompt = 补写指令）→ 仍无
//                 物 → #703 闸 1 失败收尾（phase=failed、plan 行 0、
//                 errorMessage=规划未产出方案）。「缺物必红」，A 腿绿不是表演
//                 型绿。
// 失败方式清单（先固化判别面；哪条红即指认断点 hop）：
//   1. 契约没进首轮会话（主 bug）：stub 首请求 user 消息 = 纯任务文本
//      （缺契约段）→ A1/A2 红；
//   2. 组合串形漂移：prompt ≠ composeTaskPromptWithInstruction 单源形状
//      （taskText 前缀 + \n\n + 契约殿后）→ A1 红；
//   3. wire 行与投递不同串：transcript user-<stepId> 行 ≠ 会话首条 → A5 红；
//   4. 首轮仍未落 plan：plan 行缺席 / 多一个补写步 → A3/A4 红；
//   5. 组合行冒名用户气泡（#612 套娃复辟）→ A6 红；
//   6. 负链路失守：首轮不写 plan.md 时补写轮缺位或闸放行（假绿）→ B2/B3 红。
// 用法（栈须先 launch；配方与判读见 docs/verify/1025/README.md）：
//   node drive-1025-plan-first-round.mjs
// env：VERIFY_REPO_ROOT / VERIFY_RUN_DIR / VERIFY_EVIDENCE_DIR、
//      DAEMON_HOME（缺省 /tmp/cairn-1025-daemon-home）。
// 探针自 spawn：stub LLM ×2（ephemeral 端口，每腿一只免轮次串扰）+ 真
// daemon（--server 指向本栈）；收尾全部回收（finally kill）。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const SCRIPT_REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const REPO = process.env.VERIFY_REPO_ROOT ?? SCRIPT_REPO;
const RUN_DIR = process.env.VERIFY_RUN_DIR ?? join(REPO, '.claude', 'verify-run');
const stack = JSON.parse(readFileSync(join(RUN_DIR, 'ports.json'), 'utf8'));
const SERVER = `http://127.0.0.1:${stack.serverPort}`;
const WEB = `http://127.0.0.1:${stack.webPort}`;
const DB = join(stack.homeDir, 'server', 'server.db');
const DAEMON_HOME = process.env.DAEMON_HOME ?? '/tmp/cairn-1025-daemon-home';

const ts = new Date().toISOString().replace(/[:.]/g, '-');
const EVIDENCE = process.env.VERIFY_EVIDENCE_DIR ?? join(SCRIPT_REPO, `.claude/verify-evidence/${ts}-1025-plan-first-round`);
mkdirSync(EVIDENCE, { recursive: true });

const runTag = Date.now().toString(36);
const PLAN_FILE_NAME = 'plan.md';
// 契约期望文本与 shared 单源同串（probe 独立于 daemon 源码重述一遍，断言面
// 才是「wire 上是什么」而不是「import 什么就是什么」——两边各自出现且逐字
// 相等才证明注入的是正典契约，而不是别的什么指令）。
const CONTRACT_TEXT = `本步的交接物是 ${PLAN_FILE_NAME}：结束本步前，将方案写入工作区根目录的 ${PLAN_FILE_NAME}（覆盖 Context/Changes/Edge cases/Verification 四段）。`;
const FOUR_SECTIONS = '（覆盖 Context/Changes/Edge cases/Verification 四段）';

const checks = [];
function check(name, ok, detail) {
  checks.push({ name, ok: Boolean(ok), detail: detail ?? null });
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}\n`);
}
function save(name, data) {
  writeFileSync(join(EVIDENCE, name), typeof data === 'string' ? data : `${JSON.stringify(data, null, 2)}\n`);
}
function finish(extra = {}) {
  const passed = checks.filter((c) => c.ok).length;
  save('result.json', {
    probe: 'drive-1025-plan-first-round',
    server: SERVER,
    web: WEB,
    db: DB,
    daemonHome: DAEMON_HOME,
    passed,
    total: checks.length,
    checks,
    ...extra,
  });
  process.stdout.write(`\n${passed}/${checks.length} checks passed → ${EVIDENCE}\n`);
  if (passed !== checks.length) process.exitCode = 1;
}

async function jfetch(method, path, opts = {}) {
  const headers = {};
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(`${SERVER}${path}`, {
    method,
    headers,
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
    signal: AbortSignal.timeout(15_000),
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

// —— stub LLM（integration/test/stub-llm.ts 的 .mjs 最小移植，drive-904 同款：
//    本轮次 + delayMs 门控；call id 每次运行唯一防 message 主键跨运行复用）——

function startStubLlm(responses) {
  const requests = [];
  let next = 0;
  const runId = `${runTag}-${Math.random().toString(36).slice(2, 8)}`;
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
      requests.push(JSON.parse(body));
      const rsp = responses[Math.min(next, responses.length - 1)] ?? { content: 'ok' };
      next += 1;
      const send = () => {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
        const base = {
          id: 'chatcmpl-stub',
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: 'stub-model',
        };
        const chunk = (payload) => `data: ${JSON.stringify(payload)}\n\n`;
        res.write(chunk({ ...base, choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }] }));
        if (rsp.toolCall) {
          const callId = `call-stub-${runId}-${requests.length}`;
          res.write(
            chunk({
              ...base,
              choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: callId, type: 'function', function: { name: rsp.toolCall.name, arguments: '' } }] }, finish_reason: null }],
            }),
          );
          res.write(
            chunk({
              ...base,
              choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: JSON.stringify(rsp.toolCall.arguments ?? {}) } }] }, finish_reason: null }],
            }),
          );
          res.write(chunk({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] }));
        } else {
          for (const word of (rsp.content ?? 'ok').split(/(?<=。|\.|\s)/u)) {
            if (word !== '') res.write(chunk({ ...base, choices: [{ index: 0, delta: { content: word } }] }));
          }
          res.write(chunk({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }));
        }
        res.write(
          chunk({
            ...base,
            choices: [],
            usage: { prompt_tokens: 12, completion_tokens: 40, total_tokens: 52, prompt_tokens_details: { cached_tokens: 0 } },
          }),
        );
        res.write('data: [DONE]\n\n');
        res.end();
      };
      if (rsp.delayMs) setTimeout(send, rsp.delayMs);
      else send();
    });
  });
  return new Promise((resolve2) => {
    server.listen(0, '127.0.0.1', () => {
      resolve2({
        url: `http://127.0.0.1:${server.address().port}/v1`,
        requests,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

// —— plan.md 内容（字节等值断言的期望值；heredoc 写入 = 内容以 \n 结尾）——

function markerOf(leg) {
  return `PLAN-1025-MARKER-${leg}-${runTag}`;
}
function planDoc() {
  return [
    '# 方案：#1025 首轮契约探针',
    '',
    `Marker 行：${markerOf('A')}`,
    'Changes: 首轮即落 plan.md（无补写轮）。',
    'Verification: plan 行 v1 + confirm 卡有物即验证。',
    '',
  ].join('\n');
}
function writePlanCommand(content) {
  return `cat > ${PLAN_FILE_NAME} <<'PLANEOF'\n${content}PLANEOF`;
}

// —— user wire 消息文本（openai 双形：纯 string 或 text parts 数组——pi 会话
//    首条 user 恒走 parts 形，m7-failed-send 同款实测钉）——
function userWireText(m) {
  if (typeof m.content === 'string') return m.content;
  if (Array.isArray(m.content)) {
    const parts = m.content.filter(
      (p) => typeof p === 'object' && p !== null && p.type === 'text',
    );
    return parts.length > 0 ? parts.map((p) => p.text).join('') : null;
  }
  return null;
}

// —— seed / daemon / SQLite（drive-904 同款骨架）—————————————————————

let uniq = 0;
async function seed(stubUrls) {
  const teams = await jfetch('GET', '/api/teams');
  const teamId = teams.body[0]?.id ?? teams.body.teams?.[0]?.id;
  if (!teamId) throw new Error(`no team: ${JSON.stringify(teams.body).slice(0, 200)}`);
  const provider = async (id, baseUrl) => {
    const r = await jfetch('POST', `/api/teams/${teamId}/providers`, {
      body: {
        providerId: id,
        label: id,
        baseUrl,
        api: 'openai-completions',
        authHeader: true,
        compat: { supportsDeveloperRole: false },
        models: [{ id: 'stub-model', name: 'stub-model' }],
      },
    });
    if (r.status >= 400) throw new Error(`provider create failed: ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
  };
  const providerIds = {};
  for (const leg of ['a', 'b']) {
    providerIds[leg] = `stub-1025-${leg}-${runTag}`;
    await provider(providerIds[leg], stubUrls[leg]);
  }
  const agent = async (name, providerId) => {
    const r = await jfetch('POST', `/api/teams/${teamId}/agents`, {
      body: { displayName: `${name}-${++uniq}`, provider: providerId, modelId: 'stub-model', skills: [] },
    });
    const id = r.body?.id ?? r.body?.agent?.id;
    if (!id) throw new Error(`agent create failed: ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
    return id;
  };
  const agentA = await agent('probe-1025-first-round', providerIds.a);
  const agentB = await agent('probe-1025-noplan', providerIds.b);
  const keyRes = await jfetch('POST', `/api/teams/${teamId}/api-keys`, {
    body: { name: `probe-1025-${runTag}`, gitAccess: true, mcpAccess: false, toolGrants: { read: [], write: [] } },
  });
  const plaintext = keyRes.body?.plaintext ?? keyRes.body?.key;
  if (!plaintext) throw new Error(`api-key create failed: ${keyRes.status}`);
  const project = async (name, extra = {}) => {
    const r = await jfetch('POST', '/api/projects', { body: { name, teamId, ...extra } });
    const id = r.body?.id;
    if (!id) throw new Error(`project create failed: ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
    return id;
  };
  const projectA = await project(`probe-1025-hosted-${runTag}`, { repoKind: 'hosted' });
  const projectB = await project(`probe-1025-noplan-${runTag}`);
  return { teamId, agents: { a: agentA, b: agentB }, apiKey: plaintext, projects: { a: projectA, b: projectB } };
}

async function makeTask(projectId, agentId, title, spec) {
  const todoRes = await jfetch('POST', `/api/projects/${projectId}/todos`, { body: { title, spec } });
  const todoId = todoRes.body?.id;
  const buildRes = await jfetch('POST', `/api/projects/${projectId}/builds`, {
    body: { todoIds: [todoId], assignment: { plan: { agentId }, build: { agentId } }, withPlan: true },
  });
  const buildId = buildRes.body?.builds?.[0]?.id;
  if (!todoId || !buildId) throw new Error(`task seed failed: ${JSON.stringify(buildRes.body).slice(0, 200)}`);
  return { todoId, buildId };
}

function spawnDaemon(apiKey, teamId) {
  const env = { ...process.env };
  for (const k of ['http_proxy', 'https_proxy', 'all_proxy', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY']) delete env[k];
  env.NO_PROXY = '*';
  env.CAIRN_HOME = DAEMON_HOME;
  const out = join(EVIDENCE, 'daemon-console.log');
  writeFileSync(out, '');
  const child = spawn('pnpm', ['exec', 'tsx', 'src/cli.ts', 'start', '--foreground', '--server', SERVER, '--api-key', apiKey, '--team', teamId, '--name', 'verify-1025'], {
    cwd: join(REPO, 'apps/daemon'),
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (d) => appendFileSync(out, d));
  child.stderr.on('data', (d) => appendFileSync(out, d));
  child.on('exit', (code) => appendFileSync(out, `\n[probe] daemon exited code=${code}\n`));
  return child;
}

function daemonLogLines() {
  const p = join(DAEMON_HOME, 'daemon.log');
  if (!existsSync(p)) return [];
  return readFileSync(p, 'utf8').split('\n').filter(Boolean);
}

async function waitFor(pred, timeoutMs, label) {
  const started = Date.now();
  for (;;) {
    const v = await pred();
    if (v) return v;
    if (Date.now() - started > timeoutMs) throw new Error(`waitFor timeout: ${label}`);
    await new Promise((r) => setTimeout(r, 500));
  }
}

function openDb() {
  const require2 = createRequire(join(REPO, 'apps/server/package.json'));
  const Database = require2('better-sqlite3');
  return new Database(DB, { readonly: true });
}
function dbTodo(todoId) {
  const db = openDb();
  try {
    return db.prepare('SELECT id, phase, hasPlan FROM todo WHERE id = ?').get(todoId) ?? null;
  } finally {
    db.close();
  }
}
function dbBuild(buildId) {
  const db = openDb();
  try {
    return db.prepare('SELECT id, withPlan, planDocId, errorMessage FROM build WHERE id = ?').get(buildId) ?? null;
  } finally {
    db.close();
  }
}
function dbSteps(buildId) {
  const db = openDb();
  try {
    return db.prepare('SELECT id, kind, status, prompt, machineId, sessionId FROM step WHERE buildId = ? ORDER BY createdAt').all(buildId);
  } finally {
    db.close();
  }
}
function dbPlans(buildId) {
  const db = openDb();
  try {
    return db.prepare('SELECT id, buildId, version, content, createdAt FROM plan WHERE buildId = ? ORDER BY version').all(buildId);
  } finally {
    db.close();
  }
}
function dbMessageRows(buildId) {
  const db = openDb();
  try {
    return db.prepare('SELECT id, role, content FROM message WHERE conversationId = ? ORDER BY createdAt').all(buildId);
  } finally {
    db.close();
  }
}
async function waitPhase(todoId, phases, timeoutMs, label) {
  return waitFor(
    () => {
      const row = dbTodo(todoId);
      return row && phases.includes(row.phase) ? row : null;
    },
    timeoutMs,
    label,
  );
}

// —— main ———————————————————————————————————————————————————————————

rmSync(DAEMON_HOME, { recursive: true, force: true });

const PLAN_A = planDoc();
const TASK_TITLE_A = '1025 首轮契约探针 · hosted 腿';
const TASK_SPEC_A = '首轮规划：按提示词契约把方案写进 plan.md（#1025 探针任务）。';
const TASK_TEXT_A = `${TASK_TITLE_A}\n\n${TASK_SPEC_A}`;
const EXPECTED_PROMPT_A = `${TASK_TEXT_A}\n\n${CONTRACT_TEXT}`;

const stubA = await startStubLlm([
  { toolCall: { name: 'bash', arguments: { command: writePlanCommand(PLAN_A) } }, delayMs: 1_500 },
  { content: '方案已就绪：请确认。', delayMs: 500 },
]);
// B 腿：收到契约仍不写 plan.md——两轮都只有话、零写类工具行。
const stubB = await startStubLlm([
  { content: '这一轮我不写方案文件。', delayMs: 500 },
  { content: '仍然不写方案文件。', delayMs: 500 },
]);

const seeded = await seed({ a: stubA.url, b: stubB.url });
const daemon = spawnDaemon(seeded.apiKey, seeded.teamId);
const browser = await chromium.launch();

try {
  // vite dev 首访冷编译可达数十秒——先暖机再建任务（drive-918 同款）。
  const warm = await browser.newPage();
  await warm.goto(`${WEB}/app`, { waitUntil: 'networkidle', timeout: 90_000 });
  await warm.close();
  await waitFor(() => daemonLogLines().some((l) => l.includes('[wake] push channel connected')), 60_000, 'daemon online');
  // waitFor 超时即抛 → catch 兜底成红 check；此处再读同一事实让 check 本身承载断言。
  check(
    '真 daemon 上线（--server 指本栈，wake 通道连通）',
    daemonLogLines().some((l) => l.includes('[wake] push channel connected')),
    DAEMON_HOME,
  );

  // ——— A 腿：首轮契约注入 + 首轮即落 plan 行 v1 ———
  const taskA = await makeTask(seeded.projects.a, seeded.agents.a, TASK_TITLE_A, TASK_SPEC_A);
  const firstStepA = await waitFor(() => {
    const rows = dbSteps(taskA.buildId);
    return rows.length > 0 ? rows[0] : null;
  }, 30_000, 'leg A first step row');
  check('A0：withPlan build 首步 kind=plan 且 claim 前零 prompt（server 不动，注入归 daemon）', firstStepA.kind === 'plan' && firstStepA.prompt === null, `kind=${firstStepA.kind} prompt=${JSON.stringify(firstStepA.prompt)}`);

  // 主验收（可断言）：从 stub 收到的真实请求体里抓首轮会话 prompt。
  const reqA = await waitFor(() => stubA.requests[0] ?? null, 120_000, 'leg A first stub request');
  const userTextsA = reqA.messages.filter((m) => m.role === 'user').map(userWireText);
  const firstUserA = userTextsA[0] ?? null;
  check(
    'A1：首轮会话 prompt = 任务文本 + 契约指令组合串（compose 单源形状，指令殿后）',
    firstUserA === EXPECTED_PROMPT_A,
    firstUserA === null ? 'no user message' : `len=${firstUserA.length} prefixOk=${firstUserA.startsWith(TASK_TEXT_A)}`,
  );
  save('leg-a-first-request-user-text.json', { expected: EXPECTED_PROMPT_A, actual: firstUserA });
  check(
    'A2：契约段在位（plan.md 文件名 + 四段名逐字）',
    firstUserA?.includes(PLAN_FILE_NAME) === true && firstUserA?.includes(FOUR_SECTIONS) === true && firstUserA?.includes(CONTRACT_TEXT) === true,
    `file=${firstUserA?.includes(PLAN_FILE_NAME)} sections=${firstUserA?.includes(FOUR_SECTIONS)}`,
  );

  const todoA = await waitPhase(taskA.todoId, ['confirm', 'failed'], 300_000, 'leg A confirm');
  const stepsA = dbSteps(taskA.buildId);
  const planStepsA = stepsA.filter((s) => s.kind === 'plan');
  const plansA = dbPlans(taskA.buildId);
  const buildRowA = dbBuild(taskA.buildId);
  check(
    'A3：plan 行 v1 首轮落库 + build.planDocId 指向该行（#904 A 腿同面，对照「首次规划即落 v1」）',
    plansA.length === 1 && plansA[0].version === 1 && plansA[0].content === PLAN_A && buildRowA.planDocId === plansA[0].id,
    `rows=${plansA.length} byteEqual=${plansA[0]?.content === PLAN_A}`,
  );
  check(
    'A4：恰一个 plan 步且 done（首轮产出方案，无补写轮——契约在正典提示词里就不需要它）',
    planStepsA.length === 1 && planStepsA[0].status === 'done' && Boolean(planStepsA[0].machineId),
    `planSteps=${planStepsA.length} status=${planStepsA[0]?.status}`,
  );
  const promptRowA = dbMessageRows(taskA.buildId).find((m) => m.id === `user-${planStepsA[0].id}`);
  // message.content 是 drizzle json 列——字符串值带引号存储（#902 实测坑），
  // canon 比对前先 JSON.parse 剥引号，裸等值恒假阴性。
  let rowTextA = null;
  if (typeof promptRowA?.content === 'string') {
    try {
      rowTextA = JSON.parse(promptRowA.content);
    } catch {
      rowTextA = promptRowA.content;
    }
  }
  check(
    'A5：transcript wire 行 user-<stepId> = 同一组合串（呈现层与对账面看到的就是 agent 收到的）',
    rowTextA === EXPECTED_PROMPT_A,
    rowTextA === null ? `row=${JSON.stringify(promptRowA)?.slice(0, 120)}` : `len=${rowTextA.length} equal=${rowTextA === EXPECTED_PROMPT_A}`,
  );
  save('leg-a-steps.json', stepsA);
  save('leg-a-build.json', buildRowA);
  save('leg-a-plan-row.json', plansA);
  save('leg-a-todo.json', todoA);
  save('leg-a-message-rows.json', dbMessageRows(taskA.buildId));

  const pageA = await browser.newPage({ viewport: { width: 1440, height: 732 } });
  await pageA.goto(`${WEB}/app/todo/${taskA.todoId}`);
  const chip = pageA.locator('.detail-chip');
  await chip.first().waitFor({ timeout: 60_000 });
  await pageA.locator('.detail-chip', { hasText: '确认' }).first().waitFor({ timeout: 30_000 });
  const cardTitle = await pageA.locator('.chat-plan-title').last().innerText();
  check('A6a：web confirm 卡「方案 · v1」上屏（首轮方案有物可看）', cardTitle.includes('方案 · v1'), cardTitle);
  // 套娃负例（#612 面）：首轮组合行（任务文本 + 契约指令）不成用户气泡。
  const bubbleWithTask = await pageA.getByTestId('user-bubble').filter({ hasText: TASK_TITLE_A }).count();
  const bubbleWithContract = await pageA.getByTestId('user-bubble').filter({ hasText: '本步的交接物是' }).count();
  check('A6b：首轮契约组合行退场——任务原文/契约段都不成用户气泡（套娃负例）', bubbleWithTask === 0 && bubbleWithContract === 0, `taskBubble=${bubbleWithTask} contractBubble=${bubbleWithContract}`);
  const docBody = pageA.locator('[data-testid="doc-body"]');
  await docBody.waitFor({ timeout: 30_000 });
  const docText = await docBody.innerText();
  check('A6c：右栏方案面全文含 marker（confirm 有物可看）', docText.includes(markerOf('A')), `${markerOf('A')} in ${docText.length} chars`);
  await pageA.screenshot({ path: join(EVIDENCE, 'leg-a-confirm.png') });
  await pageA.close();

  // ——— B 腿：负对照（契约已送达仍不写 → 补写轮兜住、闸红）———
  const TASK_TITLE_B = '1025 首轮契约探针 · 负对照腿';
  const TASK_SPEC_B = '收到契约也不写 plan.md（#1025 探针负对照）。';
  const TASK_TEXT_B = `${TASK_TITLE_B}\n\n${TASK_SPEC_B}`;
  const taskB = await makeTask(seeded.projects.b, seeded.agents.b, TASK_TITLE_B, TASK_SPEC_B);
  const reqB = await waitFor(() => stubB.requests[0] ?? null, 120_000, 'leg B first stub request');
  const firstUserB = reqB.messages.filter((m) => m.role === 'user').map(userWireText)[0] ?? null;
  check(
    'B1：负对照成立前提——首轮请求同样携带契约（agent 是「被告知后仍不写」，不是没被告知）',
    firstUserB === `${TASK_TEXT_B}\n\n${CONTRACT_TEXT}`,
    `equal=${firstUserB === `${TASK_TEXT_B}\n\n${CONTRACT_TEXT}`}`,
  );
  save('leg-b-first-request-user-text.json', { actual: firstUserB });

  const todoB = await waitPhase(taskB.todoId, ['failed', 'confirm'], 240_000, 'leg B terminal');
  const stepsB = dbSteps(taskB.buildId);
  const planStepsB = stepsB.filter((s) => s.kind === 'plan');
  const rewrite = planStepsB[1];
  check(
    'B2：首轮不写 → #113 补写轮入队（第二个 plan 步，prompt = 补写指令，含 plan.md）',
    planStepsB.length === 2 && typeof rewrite?.prompt === 'string' && rewrite.prompt.includes(PLAN_FILE_NAME) && rewrite.prompt.includes('规划步未产出'),
    `planSteps=${planStepsB.length} rewritePrompt=${JSON.stringify(rewrite?.prompt)?.slice(0, 80)}`,
  );
  const plansB = dbPlans(taskB.buildId);
  const buildRowB = dbBuild(taskB.buildId);
  check(
    'B3：补写轮仍无物 → #703 闸 1 失败收尾（phase=failed、plan 行 0、errorMessage=规划未产出方案）',
    todoB.phase === 'failed' && plansB.length === 0 && Boolean(buildRowB.errorMessage?.includes('规划未产出方案')) && !todoB.hasPlan,
    `phase=${todoB.phase} planRows=${plansB.length} errorMessage=${buildRowB.errorMessage}`,
  );
  save('leg-b-build.json', buildRowB);
  save('leg-b-steps.json', stepsB);
  save('leg-b-todo.json', todoB);
  const pageB = await browser.newPage({ viewport: { width: 1440, height: 732 } });
  await pageB.goto(`${WEB}/app/todo/${taskB.todoId}`);
  await pageB.locator('.detail-chip').first().waitFor({ timeout: 60_000 });
  await pageB.screenshot({ path: join(EVIDENCE, 'leg-b-failed.png') });
  await pageB.close();

  // daemon 日志关键行存档（[step] 家族 = 收集/上传/done 的运行时旁证）。
  save('daemon-log-step-lines.txt', daemonLogLines().filter((l) => l.includes('[step]') || l.includes('plan')).join('\n'));

  finish({ legA: taskA, legB: taskB, runTag });
} catch (err) {
  check(`探针异常：${err instanceof Error ? err.message : String(err)}`, false);
  try {
    for (const p of browser.contexts().flatMap((c) => c.pages())) {
      await p.screenshot({ path: join(EVIDENCE, `fail-${Date.now()}.png`) }).catch(() => {});
    }
    save('fail-daemon-log.txt', daemonLogLines().slice(-40).join('\n'));
  } catch {
    // 诊断失败不掩盖原始异常
  }
  finish({ error: err instanceof Error ? err.stack : String(err) });
} finally {
  daemon.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 2_000));
  if (daemon.exitCode === null) daemon.kill('SIGKILL');
  await stubA.close();
  await stubB.close();
  await browser.close();
}
