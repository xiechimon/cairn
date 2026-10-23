// verify-cairn 定制 probe（#1108 机器并发上限 + 排队可见）：用户实测现场 =
// 看板连发两条任务钉本机，第二条 18 分钟静默 pending——本 probe 在活栈上把
// 「一个数 + 超过才排队 + 排队有呈现」证成实物。真 daemon + 门控 stub LLM
// （请求挂起 = 步在飞的受控时钟）+ Playwright 浏览器面。四族断言：
//   A 并行真跑：cap=2 + 3 条钉本机 chief 回合 → 前两步并发（daemon.log
//     canon 行 `(1 running)`/`(2 running)` + stub 请求区间重叠）。
//   B 排队可见：第三回合 pending + threads 查询带 turnQueue（位次/等待机器
//     的 running/capacity 快照）+ 抽屉在飞存在行渲染「排队中：等 …」+
//     机器页「执行中 2/2」读标注与「并发 2」控件。
//   C 空位交接：释放第一步 → done 落账 + finish wake → 第三步被认领
//     （canon 行再现 `(2 running)`——第二步未收尾位被顶上）。
//   D 写面：PATCH {maxConcurrent} 单字段落库回读 + 0/17 越界 400。
// 失败方式清单（先固化判别面）：
//   1. 闸不在 → 第三步也被认领（三行 canon、零 pending）→ A/B 红；
//   2. daemon 串行 → canon 行只有 (1 running)、stub 请求区间零重叠 → A 红；
//   3. 投影缺席 → threads 查询无 turnQueue / 抽屉仍「处理中...」谎报 → B 红；
//   4. 空位交接死等 → 第三步 pending 到超时（无 wake）→ C 红；
//   5. 写面漂移 → PATCH 连带字段 / 越界值放行 → D 红。
// 用法（栈须先 launch）：
//   node drive-1108-concurrency.mjs
// env：VERIFY_REPO_ROOT / VERIFY_RUN_DIR / VERIFY_EVIDENCE_DIR、
//      DAEMON_HOME（缺省 /tmp/cairn-1108-daemon-home）。
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
const DAEMON_HOME = process.env.DAEMON_HOME ?? '/tmp/cairn-1108-daemon-home';

const ts = new Date().toISOString().replace(/[:.]/g, '-');
const EVIDENCE = process.env.VERIFY_EVIDENCE_DIR ?? join(SCRIPT_REPO, `.claude/verify-evidence/${ts}-1108-concurrency`);
mkdirSync(EVIDENCE, { recursive: true });

const runTag = Date.now().toString(36);
const CAP = 2;

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
    probe: 'drive-1108-concurrency',
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

// —— 门控 stub LLM：每请求挂起到对应 gate resolve（在飞时钟的受控面）；
//    记录每请求 start/end 时间戳——重叠区间 = daemon 真并发 ————————

function startGatedStub() {
  const requests = []; // {index, startedAt, endedAt}
  const gates = []; // {promise, resolve}
  let next = 0;
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
      const index = next++;
      const entry = { index, startedAt: Date.now(), endedAt: null, promptHead: (JSON.parse(body).messages?.[0]?.content ?? '').slice(0, 40) };
      requests.push(entry);
      let resolve;
      const promise = new Promise((r) => {
        resolve = r;
      });
      gates.push({ promise, resolve });
      void promise.then(() => {
        entry.endedAt = Date.now();
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
        const base = {
          id: 'chatcmpl-stub',
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: 'stub-model',
        };
        const chunk = (payload) => `data: ${JSON.stringify(payload)}\n\n`;
        res.write(chunk({ ...base, choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }] }));
        const text = `回合 ${index + 1} 完成（#1108 并发探针）。`;
        for (const word of text.split(/(?<=。)/u)) {
          if (word !== '') res.write(chunk({ ...base, choices: [{ index: 0, delta: { content: word } }] }));
        }
        res.write(chunk({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }));
        res.write(
          chunk({
            ...base,
            choices: [],
            usage: { prompt_tokens: 12, completion_tokens: 30, total_tokens: 42, prompt_tokens_details: { cached_tokens: 0 } },
          }),
        );
        res.write('data: [DONE]\n\n');
        res.end();
      });
    });
  });
  return {
    url: undefined, // listen 后回填
    requests,
    release: (index) => {
      const g = gates[index];
      if (g) g.resolve();
    },
    close: () => new Promise((r) => server.close(r)),
    start: () =>
      new Promise((r) => {
        server.listen(0, '127.0.0.1', () => {
          r(`http://127.0.0.1:${server.address().port}/v1`);
        });
      }),
  };
}

// —— seed / daemon（drive-1025 同款骨架）—————————————————————————

let uniq = 0;
async function seed(stubUrl) {
  const teams = await jfetch('GET', '/api/teams');
  const teamId = teams.body[0]?.id ?? teams.body.teams?.[0]?.id;
  if (!teamId) throw new Error(`no team: ${JSON.stringify(teams.body).slice(0, 200)}`);
  const providerId = `stub-1108-${runTag}`;
  const provider = await jfetch('POST', `/api/teams/${teamId}/providers`, {
    body: {
      providerId,
      label: providerId,
      baseUrl: stubUrl,
      api: 'openai-completions',
      authHeader: true,
      compat: { supportsDeveloperRole: false },
      models: [{ id: 'stub-model', name: 'stub-model' }],
    },
  });
  if (provider.status >= 400) throw new Error(`provider create failed: ${provider.status}`);
  const agentRes = await jfetch('POST', `/api/teams/${teamId}/agents`, {
    body: { displayName: `probe-1108-${++uniq}`, provider: providerId, modelId: 'stub-model', skills: [] },
  });
  const agentId = agentRes.body?.id ?? agentRes.body?.agent?.id;
  if (!agentId) throw new Error(`agent create failed: ${agentRes.status}`);
  const keyRes = await jfetch('POST', `/api/teams/${teamId}/api-keys`, {
    body: { name: `probe-1108-${runTag}`, gitAccess: true, mcpAccess: false, toolGrants: { read: [], write: [] } },
  });
  const apiKey = keyRes.body?.plaintext ?? keyRes.body?.key;
  if (!apiKey) throw new Error(`api-key create failed: ${keyRes.status}`);
  return { teamId, agentId, apiKey };
}

function spawnDaemon(apiKey, teamId) {
  const env = { ...process.env };
  for (const k of ['http_proxy', 'https_proxy', 'all_proxy', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY']) delete env[k];
  env.NO_PROXY = '*';
  env.CAIRN_HOME = DAEMON_HOME;
  const out = join(EVIDENCE, 'daemon-console.log');
  writeFileSync(out, '');
  const child = spawn('pnpm', ['exec', 'tsx', 'src/cli.ts', 'start', '--foreground', '--server', SERVER, '--api-key', apiKey, '--team', teamId, '--name', 'verify-1108'], {
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
    await new Promise((r) => setTimeout(r, 300));
  }
}

function openDb() {
  const require2 = createRequire(join(REPO, 'apps/server/package.json'));
  const Database = require2('better-sqlite3');
  return new Database(DB, { readonly: true });
}
function dbChiefSteps() {
  const db = openDb();
  try {
    return db
      .prepare("SELECT id, buildId, status, machineId FROM step WHERE kind = 'chief' ORDER BY createdAt")
      .all();
  } finally {
    db.close();
  }
}

// —— main ———————————————————————————————————————————————————————————

rmSync(DAEMON_HOME, { recursive: true, force: true });

const stub = startGatedStub();
const stubUrl = await stub.start();
stub.url = stubUrl;

const seeded = await seed(stubUrl);
const daemon = spawnDaemon(seeded.apiKey, seeded.teamId);
let browser = null;
try {
  // daemon 上线 + enroll（machine 行就位）。
  await waitFor(
    () => daemonLogLines().some((l) => l.includes('Online (machineId=')),
    30_000,
    'daemon online',
  );
  const machinesRes = await jfetch('GET', `/api/teams/${seeded.teamId}/machines`);
  const machine = (machinesRes.body ?? []).find((m) => m.name === 'verify-1108');
  if (!machine) throw new Error('verify-1108 machine row missing after enroll');
  save('machine-after-enroll.json', machinesRes.body);

  // D1：enroll 缺省 cap = 3（migration DEFAULT 同值）。
  check('D1: enroll 缺省 maxConcurrent = 3（历史默认值）', machine.maxConcurrent === 3, `got ${machine.maxConcurrent}`);

  // D2：PATCH 单字段 maxConcurrent=2 落库回读 + 机器记录 runningSteps。
  const patchRes = await jfetch('PATCH', `/api/machines/${machine.id}`, { body: { maxConcurrent: CAP } });
  check('D2: PATCH {maxConcurrent:2} → 200 + 回读 maxConcurrent=2 + runningSteps=0', patchRes.status === 200 && patchRes.body?.maxConcurrent === CAP && patchRes.body?.runningSteps === 0, JSON.stringify(patchRes.body ?? null).slice(0, 160));
  // D3：越界值 400（shared schema 值域 1..16）。
  const bad1 = await jfetch('PATCH', `/api/machines/${machine.id}`, { body: { maxConcurrent: 0 } });
  const bad2 = await jfetch('PATCH', `/api/machines/${machine.id}`, { body: { maxConcurrent: 17 } });
  check('D3: PATCH maxConcurrent 0 / 17 → 400（值域闸）', bad1.status === 400 && bad2.status === 400, `${bad1.status}/${bad2.status}`);

  // chief 绑 Agent + 主力机（新线程缺省钉选链）。
  const chiefPatch = await jfetch('PATCH', `/api/teams/${seeded.teamId}/chief`, {
    body: { agent: { agentId: seeded.agentId, thinkingLevel: null }, machineId: machine.id },
  });
  check('D0: chief 绑 Agent + 主力机 PATCH → 200', chiefPatch.status === 200, `status ${chiefPatch.status}`);

  // 发 3 条新线程（回合全钉本机——主力机缺省链）。
  const threads = [];
  for (let i = 1; i <= 3; i++) {
    const r = await jfetch('POST', `/api/teams/${seeded.teamId}/chief/threads`, {
      body: { content: `#1108 并发探针 · 第 ${i} 条：请简单回应。` },
    });
    threads.push({ id: r.body?.thread?.id, title: r.body?.thread?.title });
  }
  save('threads-created.json', threads);

  // —— A 并行真跑：等前两步 claimed + 第三步 pending ——
  await waitFor(
    () => {
      const steps = dbChiefSteps();
      return steps.filter((s) => s.status === 'claimed').length === 2 && steps.filter((s) => s.status === 'pending').length === 1 ? steps : null;
    },
    30_000,
    'two claimed + one pending',
  );
  const stepsA = dbChiefSteps();
  save('steps-phase-a.json', stepsA);
  check('A1: cap=2 → 恰两步 claimed、第三步 pending（超 N 才排队）', stepsA.filter((s) => s.status === 'claimed').length === 2 && stepsA.filter((s) => s.status === 'pending').length === 1);

  // A2：daemon canon 行——第一步 (1 running)、第二步 (2 running)。
  const linesA = daemonLogLines();
  const run1 = linesA.find((l) => /step \S+ for conv chief-\S+ \(1 running\)/.test(l));
  const run2 = linesA.find((l) => /step \S+ for conv chief-\S+ \(2 running\)/.test(l));
  check('A2: daemon.log canon 行 (1 running) + (2 running)（并行执行实物）', Boolean(run1 && run2), `${run1 ?? '—'} | ${run2 ?? '—'}`);

  // A3：stub 请求区间重叠（两个 LLM 会话同时在飞）。
  await waitFor(() => stub.requests.length >= 2, 20_000, 'two stub requests in flight');
  const [r0, r1] = stub.requests;
  const overlap = r0 && r1 && r1.startedAt < (r0.endedAt ?? Number.POSITIVE_INFINITY);
  check('A3: stub 两请求区间重叠（并发会话实物）', Boolean(overlap), `r0 ${r0?.startedAt}~${r0?.endedAt ?? 'held'} r1 ${r1?.startedAt}~${r1?.endedAt ?? 'held'}`);

  // —— B 排队可见 ——
  // B1：threads 查询的 turnQueue（位次 + 等待机器快照）。
  const threadsRes = await jfetch('GET', `/api/teams/${seeded.teamId}/chief/threads`);
  const pendingThread = (threadsRes.body ?? []).find((t) => t.turnQueue != null);
  save('threads-phase-b.json', threadsRes.body);
  const tq = pendingThread?.turnQueue;
  check(
    'B1: pending 回合线程带 turnQueue（位次 1 + 等待机器 running/capacity 快照）',
    Boolean(tq && tq.position === 1 && tq.waitingFor && tq.waitingFor.running === 2 && tq.waitingFor.capacity === CAP && tq.waitingFor.name === 'verify-1108'),
    JSON.stringify(tq ?? null),
  );

  // B2：机器记录 runningSteps = 2（`执行中 2/2` 数据源）。
  const machinesB = await jfetch('GET', `/api/teams/${seeded.teamId}/machines`);
  const mB = (machinesB.body ?? []).find((m) => m.id === machine.id);
  check('B2: 机器记录 runningSteps=2 / maxConcurrent=2（满载读数）', mB?.runningSteps === 2 && mB?.maxConcurrent === CAP, JSON.stringify({ runningSteps: mB?.runningSteps, maxConcurrent: mB?.maxConcurrent }));

  // —— 浏览器面 ——
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 732 } });

  // B3：chief 抽屉——pending 回合渲染「排队中：等 …」+ 位次 + 机器读数。
  await page.goto(`${WEB}/app?chief=${pendingThread.id}`);
  const queueRow = page.getByText(/排队中：等 verify-1108（2\/2 在跑，前面 0 个）/);
  await queueRow.waitFor({ state: 'visible', timeout: 15_000 });
  check('B3: 抽屉在飞存在行渲染「排队中：等 verify-1108（2/2 在跑，前面 0 个）」', true);
  await page.screenshot({ path: join(EVIDENCE, 'chief-drawer-queued.png') });

  // B4：机器页——「执行中 2/2」读标注 + 「并发 2」控件在探针机行内（按
  // data-machine-id 钉位：本机 seed 行排首，`.first()` 会抓错行）。
  await page.goto(`${WEB}/app/resources/machines`);
  const readout = page.getByText('执行中 2/2');
  await readout.waitFor({ state: 'visible', timeout: 15_000 });
  const capTrigger = page.locator(`button[aria-label="并发上限"][data-machine-id="${machine.id}"]`);
  const capText = await capTrigger.innerText();
  check('B4: 机器页「执行中 2/2」读标注 + 并发控件显示 2', capText.includes('2'), capText.replace(/\n/g, ' '));
  await page.screenshot({ path: join(EVIDENCE, 'machines-running-2of2.png') });

  // —— C 空位交接：释放第一步 → 第三步被认领 ——
  stub.release(0);
  await waitFor(
    () => {
      const steps = dbChiefSteps();
      return steps.filter((s) => s.status === 'claimed').length === 2 && steps.filter((s) => s.status === 'pending').length === 0 ? steps : null;
    },
    60_000,
    'third step claimed after slot freed',
  );
  const stepsC = dbChiefSteps();
  save('steps-phase-c.json', stepsC);
  const claimedC = stepsC.filter((s) => s.status === 'claimed');
  check('C1: 释放空位 → 第三步被认领（claimed 回 2、pending 归零）', claimedC.length === 2 && stepsC.filter((s) => s.status === 'pending').length === 0);

  // C2：canon 行再现 (2 running)（新步顶上空位；第二步仍未收尾）。
  const linesC = daemonLogLines();
  const run2again = linesC.filter((l) => /step \S+ for conv chief-\S+ \(2 running\)/.test(l));
  check('C2: 空位交接后 daemon.log 再现 (2 running)（新步顶位）', run2again.length >= 2, `count ${run2again.length}`);

  // C3：抽屉排队行退场（被领取 → 回落处理中语义）。
  await page.goto(`${WEB}/app?chief=${pendingThread.id}`);
  const queueRowAfter = page.getByText(/排队中：等 verify-1108（2\/2 在跑，前面 0 个）/);
  await queueRowAfter.waitFor({ state: 'hidden', timeout: 15_000 });
  check('C3: 被领取后抽屉排队行退场（不再谎称排队）', true);

  // 收尾：释放其余门（回合全部收完，daemon 优雅退出走 allSettled 契约）。
  stub.release(1);
  stub.release(2);
  await waitFor(
    () => dbChiefSteps().every((s) => s.status === 'done' || s.status === 'failed'),
    90_000,
    'all chief steps terminal',
  );
  const stepsFinal = dbChiefSteps();
  save('steps-final.json', stepsFinal);
  check('C4: 全部回合收尾成功（stub 回应 → done）', stepsFinal.every((s) => s.status === 'done'), JSON.stringify(stepsFinal.map((s) => s.status)));

  save('stub-requests.json', stub.requests);
  save('daemon-log-tail.txt', daemonLogLines().slice(-60).join('\n'));
  finish({ machineId: machine.id, threadIds: threads.map((t) => t.id) });
} catch (err) {
  save('probe-error.txt', `${err?.stack ?? err}\n`);
  finish({ error: String(err?.message ?? err) });
  throw err;
} finally {
  await browser?.close().catch(() => {});
  daemon?.kill('SIGTERM');
  await stub.close().catch(() => {});
}
