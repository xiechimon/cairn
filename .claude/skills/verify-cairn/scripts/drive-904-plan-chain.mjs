// verify-cairn 定制 probe（#904 plan.md 落库通道全链验证）：withPlan build →
// plan 表落行 → confirm 卡有物可看。真 daemon + stub LLM ×3 + Playwright
// 浏览器面全链取证。背景：#892 量闸实证 28 build / 0 行 plan.md / 0 样本——
// 「版本化方案文档」支柱零使用，本 probe 把「这条链真能跑通」证成实物
//（机制生效验收取实物，读码不算）。三条腿各钉一族失败方式：
//   A 腿（hosted repo）  正典形正向全链：plan 步入队 → 真 daemon 认领 →
//                        stub agent bash 写 plan.md → daemon 收集上传 →
//                        plan 行 v1 字节等值 + build.planDocId 置位 →
//                        step done → phase confirm + hasPlan 置位 →
//                        REST /api/builds/:id/plans 读面 → 浏览器 confirm
//                        卡（方案 · v1 + preview）+ 右栏方案面全文 marker
//                        上屏 + 打开方案钮。
//   B 腿（无 repo 裸目录）#703 修复面（此前无 repo withPlan 恒无方案）的
//                        活栈全链正向：同款落行 + confirm + 卡面。
//   C 腿（负对照）        agent 两轮都不写 plan.md → #113 自动补写轮
//                        （rewrite 步 prompt 含 plan.md）→ #703 闸 1 失败
//                        收尾：phase=failed、plan 行 0、build.errorMessage
//                        =「规划未产出方案」——「缺物必红」，证明 A/B 腿
//                        绿不是表演型绿（闸在，绿才有判别力）。
// 失败方式清单（先固化判别面；哪条红即指认断点 hop）：
//   1. plan 步没入队（withPlan:true 但首步 kind≠plan）→ A1 红；
//   2. plan 步没被真 daemon 认领（machineId 恒空）→ A2 红；
//   3. plan.md 没被收集/上传（worktree 或裸目录路径漂移、upload 4xx）→
//      A3/B1 红（plan 表 0 行——#892 的实证形态）；
//   4. 上传到达但 plan 行/planDocId 未落库（receivePlanUpload 断）→ A3 红；
//   5. plan 行在但 confirm 不翻 / hasPlan 不置（completeStep 相位机断）→
//      A4/B2 红；
//   6. REST 有行但 web 方案卡缺席（mapper/失效面，#666 断口回归）→ A6 红；
//   7. 方案卡在但右栏方案面无全文（plans content 槽 / DocPane 断）→ A7 红；
//   8. 无 repo 形 withPlan 恒无方案（#703 回归）→ B 腿红；
//   9. 无 plan.md 仍放行 confirm（#113/#703 闸失效——假绿）→ C 腿红。
// 用法（栈须先 launch；配方与判读见 docs/verify/904/README.md）：
//   node drive-904-plan-chain.mjs
// env：VERIFY_REPO_ROOT / VERIFY_RUN_DIR / VERIFY_EVIDENCE_DIR、
//      DAEMON_HOME（缺省 /tmp/cairn-904-daemon-home）。
// 探针自 spawn：stub LLM ×3（ephemeral 端口，每腿一只免轮次串扰）+ 真
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
const DAEMON_HOME = process.env.DAEMON_HOME ?? '/tmp/cairn-904-daemon-home';

const ts = new Date().toISOString().replace(/[:.]/g, '-');
const EVIDENCE = process.env.VERIFY_EVIDENCE_DIR ?? join(SCRIPT_REPO, `.claude/verify-evidence/${ts}-904-plan-chain`);
mkdirSync(EVIDENCE, { recursive: true });

const runTag = Date.now().toString(36);
const PLAN_FILE_NAME = 'plan.md';

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
    probe: 'drive-904-plan-chain',
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

// —— stub LLM（integration/test/stub-llm.ts 的 .mjs 最小移植，drive-918 同款：
//    脚本轮次 + delayMs 门控；call id 每次运行唯一防 message 主键跨运行复用）——

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
  return `PLAN-904-MARKER-${leg}-${runTag}`;
}
function planDoc(leg) {
  return [
    `# 方案：#904 全链探针（${leg} 腿）`,
    '',
    `Marker 行：${markerOf(leg)}`,
    'Changes: 在 plan.md 落一版方案（无其它改动）。',
    'Verification: confirm 卡与右栏方案面同屏有物即验证。',
    '',
  ].join('\n');
}
function writePlanCommand(content) {
  return `cat > ${PLAN_FILE_NAME} <<'PLANEOF'\n${content}PLANEOF`;
}

// —— seed / daemon / SQLite（drive-918 同款骨架）—————————————————————

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
  for (const leg of ['a', 'b', 'c']) {
    providerIds[leg] = `stub-904-${leg}-${runTag}`;
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
  const agentA = await agent('probe-904-hosted', providerIds.a);
  const agentB = await agent('probe-904-bare', providerIds.b);
  const agentC = await agent('probe-904-noplan', providerIds.c);
  const keyRes = await jfetch('POST', `/api/teams/${teamId}/api-keys`, {
    body: { name: `probe-904-${runTag}`, gitAccess: true, mcpAccess: false, toolGrants: { read: [], write: [] } },
  });
  const plaintext = keyRes.body?.plaintext ?? keyRes.body?.key;
  if (!plaintext) throw new Error(`api-key create failed: ${keyRes.status}`);
  const project = async (name, extra = {}) => {
    const r = await jfetch('POST', '/api/projects', { body: { name, teamId, ...extra } });
    const id = r.body?.id;
    if (!id) throw new Error(`project create failed: ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
    return id;
  };
  const projectA = await project(`probe-904-hosted-${runTag}`, { repoKind: 'hosted' });
  const projectB = await project(`probe-904-bare-${runTag}`);
  const projectC = await project(`probe-904-noplan-${runTag}`);
  return { teamId, agents: { a: agentA, b: agentB, c: agentC }, apiKey: plaintext, projects: { a: projectA, b: projectB, c: projectC } };
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
  const child = spawn('pnpm', ['exec', 'tsx', 'src/cli.ts', 'start', '--foreground', '--server', SERVER, '--api-key', apiKey, '--team', teamId, '--name', 'verify-904'], {
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

// —— 浏览器面公共断言（confirm 卡 + 右栏方案面）———————————————————————

async function assertConfirmSurface(page, todoId, leg, shotName) {
  await page.goto(`${WEB}/app/todo/${todoId}`);
  const chip = page.locator('.detail-chip');
  await chip.first().waitFor({ timeout: 60_000 });
  await page.locator('.detail-chip', { hasText: '确认' }).first().waitFor({ timeout: 30_000 });
  const cardTitle = page.locator('.chat-plan-title').last();
  await cardTitle.waitFor({ timeout: 30_000 });
  const titleText = await cardTitle.innerText();
  check(`${leg}：web confirm 卡「方案 · v1」上屏（#666 断口面正向）`, titleText.includes('方案 · v1'), titleText);
  const previewText = await page.locator('.chat-preview').last().innerText();
  check(`${leg}：confirm 卡 preview = plan.md 首个有效行`, previewText.includes(`#904 全链探针（${leg} 腿）`), previewText);
  // 右栏方案面（confirm 相位 docMode 缺省 'plan'，paneView 缺省 'doc'）：
  // 全文 = plans 读面 content 槽 → mapPlanDoc 渲染，marker 行必须在屏。
  const docBody = page.locator('[data-testid="doc-body"]');
  await docBody.waitFor({ timeout: 30_000 });
  const docText = await docBody.innerText();
  check(`${leg}：右栏方案面全文含 marker（confirm 有物可看）`, docText.includes(markerOf(leg)), `${markerOf(leg)} in ${docText.length} chars`);
  await page.screenshot({ path: join(EVIDENCE, `${shotName}-confirm.png`) });
  // 打开方案钮（transcript plan 卡激活右栏 plan 面，#366 AC）——点击后仍钉
  // marker（planView 强制 plan 面不空转）。
  const openBtn = page.locator('button[aria-label="打开方案"]').last();
  await openBtn.click();
  await page.waitForTimeout(500);
  const docText2 = await page.locator('[data-testid="doc-body"]').innerText();
  check(`${leg}：「打开方案」点击后方案面仍持全文`, docText2.includes(markerOf(leg)));
  await page.screenshot({ path: join(EVIDENCE, `${shotName}-docpane.png`) });
}

// —— main ———————————————————————————————————————————————————————————

rmSync(DAEMON_HOME, { recursive: true, force: true });

const PLAN_A = planDoc('A');
const PLAN_B = planDoc('B');
const stubA = await startStubLlm([
  { toolCall: { name: 'bash', arguments: { command: writePlanCommand(PLAN_A) } }, delayMs: 1_500 },
  { content: '方案已就绪：请确认。', delayMs: 500 },
]);
const stubB = await startStubLlm([
  { toolCall: { name: 'bash', arguments: { command: writePlanCommand(PLAN_B) } }, delayMs: 1_500 },
  { content: '方案已就绪：请确认。', delayMs: 500 },
]);
// C 腿：两轮都只有话、零写类工具行——plan.md 永不落盘（闸的输入面）。
const stubC = await startStubLlm([
  { content: '这一轮我不写方案文件。', delayMs: 500 },
  { content: '仍然不写方案文件。', delayMs: 500 },
]);

const seeded = await seed({ a: stubA.url, b: stubB.url, c: stubC.url });
const daemon = spawnDaemon(seeded.apiKey, seeded.teamId);
const browser = await chromium.launch();

try {
  // vite dev 首访冷编译可达数十秒——先暖机再建任务（drive-918 同款）。
  const warm = await browser.newPage();
  await warm.goto(`${WEB}/app`, { waitUntil: 'networkidle', timeout: 90_000 });
  await warm.close();
  await waitFor(() => daemonLogLines().some((l) => l.includes('[wake] push channel connected')), 60_000, 'daemon online');
  check('真 daemon 上线（--server 指本栈）', true, DAEMON_HOME);

  // ——— A 腿：hosted repo 正典形 ———
  const taskA = await makeTask(seeded.projects.a, seeded.agents.a, '904 全链探针 · hosted 腿', '在 plan.md 落一版方案（#904 探针任务）。');
  const stepRowsA = await waitFor(() => {
    const rows = dbSteps(taskA.buildId);
    return rows.length > 0 ? rows : null;
  }, 30_000, 'leg A first step row');
  const buildRowA0 = dbBuild(taskA.buildId);
  check('A1：withPlan build 首步入队即 kind=plan（build 步不先行）', stepRowsA[0].kind === 'plan' && buildRowA0.withPlan === 1, `kind=${stepRowsA[0].kind} withPlan=${buildRowA0.withPlan}`);
  const todoA = await waitPhase(taskA.todoId, ['confirm', 'failed'], 300_000, 'leg A confirm');
  const stepsA = dbSteps(taskA.buildId);
  const planStepA = stepsA.find((s) => s.kind === 'plan');
  check('A2：plan 步被真 daemon 认领且 done 收尾', Boolean(planStepA?.machineId) && planStepA?.status === 'done', `machineId=${planStepA?.machineId} status=${planStepA?.status}`);
  const plansA = dbPlans(taskA.buildId);
  const buildRowA = dbBuild(taskA.buildId);
  check(
    'A3：plan 表落行 v1 且 content 与 agent 所写逐字节等值 + build.planDocId 指向该行',
    plansA.length === 1 && plansA[0].version === 1 && plansA[0].content === PLAN_A && buildRowA.planDocId === plansA[0].id,
    `rows=${plansA.length} byteEqual=${plansA[0]?.content === PLAN_A} planDocId=${buildRowA.planDocId === plansA[0]?.id}`,
  );
  check('A4：phase=confirm 且 hasPlan 置位（#703 闸 1 过闸必有产物）', todoA.phase === 'confirm' && Boolean(todoA.hasPlan), `phase=${todoA.phase} hasPlan=${todoA.hasPlan}`);
  const restA = await jfetch('GET', `/api/builds/${taskA.buildId}/plans`);
  const restPlansA = Array.isArray(restA.body) ? restA.body : [];
  check('A5：REST /api/builds/:id/plans 200 且恰一版、content 字节等值', restA.status === 200 && restPlansA.length === 1 && restPlansA[0].content === PLAN_A, `status=${restA.status} rows=${restPlansA.length}`);
  save('leg-a-build.json', buildRowA);
  save('leg-a-plan-row.json', plansA);
  save('leg-a-steps.json', stepsA);
  save('leg-a-plans-rest.json', restA.body);
  save('leg-a-todo.json', todoA);
  const pageA = await browser.newPage({ viewport: { width: 1440, height: 732 } });
  await assertConfirmSurface(pageA, taskA.todoId, 'A', 'leg-a');
  await pageA.close();

  // ——— B 腿：无 repo 裸任务目录（#703 修复面）———
  const taskB = await makeTask(seeded.projects.b, seeded.agents.b, '904 全链探针 · 裸目录腿', '在 plan.md 落一版方案（#904 探针任务）。');
  const todoB = await waitPhase(taskB.todoId, ['confirm', 'failed'], 240_000, 'leg B confirm');
  const plansB = dbPlans(taskB.buildId);
  const buildRowB = dbBuild(taskB.buildId);
  check(
    'B1：无 repo 形 plan 表照样落行（#703：裸目录收集上传，此前恒无方案）',
    plansB.length === 1 && plansB[0].content === PLAN_B && buildRowB.planDocId === plansB[0].id,
    `rows=${plansB.length} byteEqual=${plansB[0]?.content === PLAN_B}`,
  );
  check('B2：无 repo 形 phase=confirm + hasPlan 置位', todoB.phase === 'confirm' && Boolean(todoB.hasPlan), `phase=${todoB.phase} hasPlan=${todoB.hasPlan}`);
  const restB = await jfetch('GET', `/api/builds/${taskB.buildId}/plans`);
  const restPlansB = Array.isArray(restB.body) ? restB.body : [];
  check('B3：无 repo 形 REST plans 读面 200 恰一版', restB.status === 200 && restPlansB.length === 1 && restPlansB[0].content === PLAN_B, `status=${restB.status} rows=${restPlansB.length}`);
  save('leg-b-build.json', buildRowB);
  save('leg-b-plan-row.json', plansB);
  save('leg-b-steps.json', dbSteps(taskB.buildId));
  save('leg-b-todo.json', todoB);
  const pageB = await browser.newPage({ viewport: { width: 1440, height: 732 } });
  await assertConfirmSurface(pageB, taskB.todoId, 'B', 'leg-b');
  await pageB.close();

  // ——— C 腿：负对照（agent 永不写 plan.md → 闸必须红）———
  const taskC = await makeTask(seeded.projects.c, seeded.agents.c, '904 全链探针 · 负对照腿', '不要写 plan.md（#904 探针负对照）。');
  const todoC = await waitPhase(taskC.todoId, ['failed', 'confirm'], 240_000, 'leg C terminal');
  const stepsC = dbSteps(taskC.buildId);
  const planStepsC = stepsC.filter((s) => s.kind === 'plan');
  const rewrite = planStepsC[1];
  check(
    'C1：首轮无 plan.md → #113 自动补写轮入队（第二个 plan 步，prompt 含 plan.md）',
    planStepsC.length === 2 && planStepsC[0].status === 'done' && typeof rewrite?.prompt === 'string' && rewrite.prompt.includes(PLAN_FILE_NAME),
    `planSteps=${planStepsC.length} rewritePromptHasPlanFile=${rewrite?.prompt?.includes(PLAN_FILE_NAME)}`,
  );
  const plansC = dbPlans(taskC.buildId);
  const buildRowC = dbBuild(taskC.buildId);
  check(
    'C2：补写轮仍无 plan.md → #703 闸 1 失败收尾（phase=failed、plan 行 0、errorMessage=规划未产出方案）',
    todoC.phase === 'failed' && plansC.length === 0 && Boolean(buildRowC.errorMessage?.includes('规划未产出方案')) && !todoC.hasPlan,
    `phase=${todoC.phase} planRows=${plansC.length} errorMessage=${buildRowC.errorMessage}`,
  );
  save('leg-c-build.json', buildRowC);
  save('leg-c-steps.json', stepsC);
  save('leg-c-todo.json', todoC);
  const pageC = await browser.newPage({ viewport: { width: 1440, height: 732 } });
  await pageC.goto(`${WEB}/app/todo/${taskC.todoId}`);
  await pageC.locator('.detail-chip').first().waitFor({ timeout: 60_000 });
  await pageC.waitForTimeout(2_000);
  const chipTextC = await pageC.locator('.detail-chip').first().innerText();
  const cardCountC = await pageC.locator('.chat-plan-title').count();
  check('C3：缺物不放行——chip 非「确认」且零方案卡（假绿排除）', !chipTextC.includes('确认') && cardCountC === 0, `chip=${chipTextC} cards=${cardCountC}`);
  await pageC.screenshot({ path: join(EVIDENCE, 'leg-c-failed.png') });
  await pageC.close();

  // daemon 日志关键行存档（[step] 家族 = 收集/上传/done 的运行时旁证）。
  save('daemon-log-step-lines.txt', daemonLogLines().filter((l) => l.includes('[step]') || l.includes('plan')).join('\n'));

  finish({ legA: taskA, legB: taskB, legC: taskC, runTag });
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
  await stubC.close();
  await browser.close();
}
