// verify-cairn 定制 probe（#708 步失败根因 + auto_retry 有界生命周期 +
// provider 配置即时生效）：live 栈（server + vite + 真 daemon + pi）+ 内嵌
// mock 网关（字节级请求日志 + 可切模式：storm400 / ok）走真机器面——
//   Phase A（失败方式 1+2）：mock 恒 400-with-body（不可适配）→ 步有界时间内
//     failed，build.errorMessage 携带 400 根因（非 stream timeout 收尸文案）；
//     请求发数钉死 ≤ 8（两会话 × (1+RETRY_STORM_MAX)）；UI 失败行截图带根因。
//   Phase B（用户故事闭环）：PATCH provider compat（补旋钮）→ 不重启 daemon，
//     新会话按新配置发请求（max_tokens / 无 store）→ 步 success。
//   Phase C（失败方式 3 判别式）：PATCH 移除旋钮 → 学习位不回流（请求回现代
//     字段 max_completion_tokens + store）→ 步 success。
// 证据：mock-requests.jsonl（逐请求 ts/mode/状态/请求体）+ 截图 + result.json。
//
// 前置：launch.mjs 起栈 + 真 daemon enroll（--server 指本栈端口；配方见
// features/stop-button.md：6 proxy env 全 unset、CAIRN_HOME scratch 透传）。
// 用法：VERIFY_REPO_ROOT=<worktree> node probe-error-lifecycle.mjs
//   env：MOCK_PORT（缺省 8799）/ VERIFY_EVIDENCE_DIR（缺省主仓
//       .claude/verify-evidence/<ts>-error-lifecycle）
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const SCRIPT_REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const REPO = process.env.VERIFY_REPO_ROOT ?? SCRIPT_REPO;
const RUN_DIR = process.env.VERIFY_RUN_DIR ?? join(REPO, '.claude/verify-run');
const ports = existsSync(join(RUN_DIR, 'ports.json'))
  ? JSON.parse(readFileSync(join(RUN_DIR, 'ports.json'), 'utf8'))
  : {};
// #951 维护轮修 stale（drive-stop 同款）：ports.json 键 = serverPort/webPort。
const SERVER = `http://127.0.0.1:${ports.serverPort ?? ports.server ?? process.env.VERIFY_PORT ?? 8791}`;
const WEB = `http://127.0.0.1:${ports.webPort ?? ports.web ?? process.env.VERIFY_WEB_PORT ?? 5273}`;
const MOCK_PORT = Number(process.env.MOCK_PORT ?? 8799);
const ts = new Date().toISOString().replace(/[:.]/g, '-');
const EVIDENCE =
  process.env.VERIFY_EVIDENCE_DIR ??
  join(SCRIPT_REPO, `.claude/verify-evidence/${ts}-error-lifecycle`);
mkdirSync(EVIDENCE, { recursive: true });

const checks = [];
function check(name, ok, detail) {
  checks.push({ name, ok: Boolean(ok), detail: detail ?? null });
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}\n`);
}

async function jget(path) {
  const res = await fetch(`${SERVER}${path}`);
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = await res.text();
  }
  return { status: res.status, body };
}
async function jreq(method, path, payload) {
  const res = await fetch(`${SERVER}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = await res.text();
  }
  return { status: res.status, body };
}

// —— 内嵌 mock 网关（#519 回放法：逐请求记字节级 body；模式可切）——————————
const requestLog = [];
const mockState = { mode: 'storm400', phase: 'A' };
// #519 relay 400 形的 SDK 可见等价物：OpenAI SDK 只读 body 的 error.message，
// 且 message 为对象时 JSON.stringify 进错误文案——得到
// `400 {"text":"…","type":"server_error"}`（含 server_error → pi 词表判可重试
// → auto_retry 循环；含协议签名 → #654 回落命中。实测定形见 result.json）。
const RELAY_400_BODY = {
  error: { message: { text: 'Model does not support this protocol.', type: 'server_error' } },
};
const mock = createServer((req, res) => {
  if (req.method !== 'POST' || !req.url?.endsWith('/chat/completions')) {
    res.writeHead(404).end();
    return;
  }
  let raw = '';
  req.on('data', (d) => {
    raw += d;
  });
  req.on('end', () => {
    const entry = {
      ts: new Date().toISOString(),
      phase: mockState.phase,
      mode: mockState.mode,
      body: raw.length > 0 ? JSON.parse(raw) : null,
    };
    requestLog.push(entry);
    appendFileSync(
      join(EVIDENCE, 'mock-requests.jsonl'),
      `${JSON.stringify(entry)}\n`,
      'utf8',
    );
    if (mockState.mode === 'storm400') {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify(RELAY_400_BODY));
      return;
    }
    // ok：即时 200 SSE（stub-llm 同形零延迟）
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    const base = {
      id: 'chatcmpl-stub',
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model: 'stub-model',
    };
    res.write(
      `data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: { role: 'assistant' } }] })}\n\n`,
    );
    res.write(
      `data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: { content: '探针通过' } }] })}\n\n`,
    );
    res.write(
      `data: ${JSON.stringify({
        ...base,
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
        usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 },
      })}\n\n`,
    );
    res.write('data: [DONE]\n\n');
    res.end();
  });
});
await new Promise((r) => {
  mock.listen(MOCK_PORT, '127.0.0.1', r);
});

const FIELD = (entry, name) => entry.body?.[name] !== undefined;

async function pollUntil(label, fn, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await fn();
    if (last !== null && last !== undefined && last !== false) return last;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`poll timeout (${label}): last=${JSON.stringify(last)}`);
}

const browser = await chromium.launch();
try {
  // —— 数据面 seed ——
  const { body: teams } = await jget('/api/teams');
  const teamId = teams[0]?.id;
  check('team in session', Boolean(teamId), teamId);
  const providerId = 'mock-gw-708';
  const prov = await jreq('POST', `/api/teams/${teamId}/providers`, {
    providerId,
    label: 'Mock Gateway 708',
    baseUrl: `http://127.0.0.1:${MOCK_PORT}/v1`,
    api: 'openai-completions',
    authHeader: true,
    // 非空基线（失败方式 3 的快照对照位：B/C 两相的 PATCH 都改变它）
    compat: { supportsDeveloperRole: false },
    models: [{ id: 'stub-model', name: 'stub-model' }],
    apiKey: 'sk-stub-708',
  });
  check('provider created', prov.status === 201 || prov.status === 200, `status=${prov.status}`);
  const providerRecordId = prov.body?.id; // PATCH 寻址位 = 记录 id（providerId 是用户串）
  const agent = await jreq('POST', `/api/teams/${teamId}/agents`, {
    displayName: 'verify-708-builder',
    provider: providerId,
    modelId: 'stub-model',
  });
  const agentId = agent.body?.id;
  check('agent created', Boolean(agentId), `status=${agent.status}`);
  const project = await jreq('POST', '/api/projects', { name: '708 生命周期探针' });
  const projectId = project.body?.id;
  check('project created', Boolean(projectId), `status=${project.status}`);

  const newTodo = async (title) => {
    const t = await jreq('POST', `/api/projects/${projectId}/todos`, {
      title,
      spec: '探针任务：写一行说明',
    });
    const todoId = t.body?.id;
    const b = await jreq('POST', `/api/projects/${projectId}/builds`, {
      todoIds: [todoId],
      assignment: { plan: { agentId }, build: { agentId } },
      withPlan: true,
    });
    return { todoId, buildId: b.body?.builds?.[0]?.id, startedAt: Date.now() };
  };

  // —— Phase A：不可适配 400-with-body → 有界失败 + 根因直报 ————————————
  // todo 相位 = 终态信号（plan 步失败 → failed；成功 → confirm 闸，r5 §3.4）。
  mockState.mode = 'storm400';
  mockState.phase = 'A';
  const A = await newTodo('A 不可适配失败根因探针');
  const phaseTerminal = async (todoId, buildId) => {
    const t = await jget(`/api/todos/${todoId}`);
    const phase = t.body?.phase;
    if (phase === 'failed' || phase === 'confirm' || phase === 'done') {
      const b = await jget(`/api/builds/${buildId}`);
      const s = await jget(`/api/builds/${buildId}/steps`);
      const steps = Array.isArray(s.body) ? s.body : (s.body?.steps ?? []);
      return { phase, build: b.body, steps };
    }
    return null;
  };
  const terminalA = await pollUntil('todoA terminal', () => phaseTerminal(A.todoId, A.buildId), 120_000);
  const buildA = terminalA.build;
  const elapsedA = Date.now() - A.startedAt;
  const reqA = requestLog.filter((e) => e.phase === 'A');
  check(
    'A: 步 failed（有界时间内，非超时收尸）',
    terminalA.phase === 'failed' && terminalA.steps.some((s) => s.status === 'failed'),
    `phase=${terminalA.phase}`,
  );
  check('A: 失败用时 < 90s（旧行为 = 540s 墙 + ~9min 空转）', elapsedA < 90_000, `${(elapsedA / 1000).toFixed(1)}s`);
  check(
    'A: build.errorMessage 携带 400 根因（Model does not support this protocol）',
    typeof buildA.errorMessage === 'string' &&
      buildA.errorMessage.includes('Model does not support this protocol'),
    buildA.errorMessage,
  );
  check(
    'A: 根因不是被覆盖的超时文案（errorMessage 非 stream timeout 收尸形）',
    typeof buildA.errorMessage === 'string' && !buildA.errorMessage.startsWith('stream timeout'),
    buildA.errorMessage,
  );
  check(
    'A: 重试发数钉死 ≤ 8（两会话 × (1+RETRY_STORM_MAX)，旧行为 ~40 发/10min）',
    reqA.length <= 8,
    `requests=${reqA.length}`,
  );
  check(
    'A: 回落轮在场（前 4 发现代字段、后 4 发翻过 compat 的旧式形——#654 学习位飞行记录）',
    reqA.length >= 5 &&
      reqA.slice(0, 4).every((e) => FIELD(e, 'max_completion_tokens') && FIELD(e, 'store')) &&
      reqA.slice(4).every((e) => FIELD(e, 'max_tokens') && !FIELD(e, 'store')),
    reqA.map((e) => (FIELD(e, 'max_tokens') ? 'mt' : 'mct')).join(','),
  );

  // UI 失败行（r8 canon 橙色标题行）
  const page = await browser.newPage({ viewport: { width: 1440, height: 732 } });
  await page.goto(`${WEB}/app/todo/${A.todoId}`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.chat-para--fail', { timeout: 10_000 });
  const failText = (await page.textContent('.chat-para--fail')) ?? '';
  check(
    'A: UI 失败行携带 400 根因（.chat-para--fail 文本）',
    failText.includes('Model does not support this protocol'),
    failText.slice(0, 120),
  );
  await page.screenshot({ path: join(EVIDENCE, 'A-failure-line.png') });

  // —— Phase B：PATCH 补旋钮 → 不重启 daemon，新会话按新配置发请求 ——————
  mockState.mode = 'ok';
  mockState.phase = 'B';
  const patchB = await jreq('PATCH', `/api/teams/${teamId}/providers/${providerRecordId}`, {
    compat: {
      supportsDeveloperRole: false,
      maxTokensField: 'max_tokens',
      supportsStore: false,
    },
  });
  check('B: provider PATCH ok', patchB.status === 200 || patchB.status === 204, `status=${patchB.status}`);
  const B = await newTodo('B 配置即时生效探针');
  const terminalB = await pollUntil('todoB terminal', () => phaseTerminal(B.todoId, B.buildId), 90_000);
  const buildB = terminalB.build;
  const reqB = requestLog.filter((e) => e.phase === 'B');
  check(
    'B: plan 步成功到 confirm 闸（改完配置立刻可再跑；daemon 未重启）',
    terminalB.phase === 'confirm' && terminalB.steps.some((s) => s.status === 'done' && s.kind === 'plan'),
    `phase=${terminalB.phase}`,
  );
  check(
    'B: 新会话按新配置发请求（max_tokens 在位、现代字段缺席；daemon 未重启）',
    reqB.length > 0 &&
      reqB.every((e) => FIELD(e, 'max_tokens') && !FIELD(e, 'max_completion_tokens') && !FIELD(e, 'store')),
    `${reqB.length} requests`,
  );

  // —— Phase C：PATCH 移除旋钮 → 学习位不回流（判别式）——————————————
  mockState.phase = 'C';
  const patchC = await jreq('PATCH', `/api/teams/${teamId}/providers/${providerRecordId}`, {
    compat: { supportsDeveloperRole: false },
  });
  check('C: provider PATCH ok', patchC.status === 200 || patchC.status === 204, `status=${patchC.status}`);
  const C = await newTodo('C 旋钮移除回流探针');
  const terminalC = await pollUntil('todoC terminal', () => phaseTerminal(C.todoId, C.buildId), 90_000);
  const buildC = terminalC.build;
  const reqC = requestLog.filter((e) => e.phase === 'C');
  check(
    'C: plan 步成功到 confirm 闸',
    terminalC.phase === 'confirm' && terminalC.steps.some((s) => s.status === 'done' && s.kind === 'plan'),
    `phase=${terminalC.phase}`,
  );
  check(
    'C: 移除即回退（请求回现代字段 max_completion_tokens + store；学习位不把旧形填回——不重启 daemon）',
    reqC.length > 0 &&
      reqC.every((e) => FIELD(e, 'max_completion_tokens') && FIELD(e, 'store') && !FIELD(e, 'max_tokens')),
    `${reqC.length} requests`,
  );

  const result = {
    probe: 'error-lifecycle (#708)',
    stack: { server: SERVER, web: WEB, mock: `http://127.0.0.1:${MOCK_PORT}` },
    evidence: EVIDENCE,
    checks,
    summary: {
      phaseA: { requests: reqA.length, elapsedMs: elapsedA, build: buildA },
      phaseB: { requests: reqB.length, build: buildB },
      phaseC: { requests: reqC.length, build: buildC },
    },
  };
  writeFileSync(join(EVIDENCE, 'result.json'), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  const failed = checks.filter((c) => !c.ok).length;
  process.stdout.write(
    `\n${checks.length - failed}/${checks.length} checks passed; evidence: ${EVIDENCE}\n`,
  );
  process.exitCode = failed > 0 ? 1 : 0;
} finally {
  await browser.close();
  mock.close();
}
