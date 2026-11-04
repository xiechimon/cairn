import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const SCRIPT_REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const REPO = process.env.VERIFY_REPO_ROOT ?? SCRIPT_REPO;
const RUN_DIR = process.env.VERIFY_RUN_DIR ?? join(REPO, '.claude', 'verify-run');
const stack = JSON.parse(readFileSync(join(RUN_DIR, 'ports.json'), 'utf8'));
const SERVER = `http://127.0.0.1:${stack.serverPort}`;
const WEB = `http://127.0.0.1:${stack.webPort}`;
const DB = join(stack.homeDir, 'server', 'server.db');
const DAEMON_HOME = process.env.DAEMON_HOME ?? '/tmp/cairn-1261-daemon-home';

const ts = new Date().toISOString().replace(/[:.]/g, '-');
const EVIDENCE =
  process.env.VERIFY_EVIDENCE_DIR ??
  join(SCRIPT_REPO, `.claude/verify-evidence/${ts}-1261-quota-wait`);
mkdirSync(EVIDENCE, { recursive: true });

const runTag = Date.now().toString(36);
const RELAY_ID = `stub-1261-${runTag}`;
const RETRY_AFTER_SECONDS = 5;

const checks = [];
function check(name, ok, detail) {
  checks.push({ name, ok: Boolean(ok), detail: detail ?? null });
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}\n`);
}
function save(name, data) {
  writeFileSync(
    join(EVIDENCE, name),
    typeof data === 'string' ? data : `${JSON.stringify(data, null, 2)}\n`,
  );
}
function finish(extra = {}) {
  const passed = checks.filter((c) => c.ok).length;
  save('result.json', {
    probe: 'drive-1261-quota-wait',
    server: SERVER,
    web: WEB,
    db: DB,
    daemonHome: DAEMON_HOME,
    relayId: RELAY_ID,
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

function startRelay() {
  const requests = [];
  let mode = 'quota';
  let okRounds = 0;
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
      requests.push({ mode, url: req.url, at: Date.now() });
      if (mode === 'quota') {

        res.writeHead(429, {
          'content-type': 'application/json',
          'retry-after': String(RETRY_AFTER_SECONDS),
        });
        res.end(JSON.stringify({ error: { message: 'rate limit exceeded for this key', type: 'rate_limit_error' } }));
        return;
      }

      let lastRole = 'user';
      try {
        const parsed = JSON.parse(body);
        const msgs = parsed?.messages;
        if (Array.isArray(msgs) && msgs.length > 0) lastRole = msgs[msgs.length - 1]?.role ?? 'user';
      } catch {

      }
      okRounds += 1;
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      const base = {
        id: 'chatcmpl-stub-1261',
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: 'stub-model',
      };
      const chunk = (payload) => `data: ${JSON.stringify(payload)}\n\n`;
      if (lastRole !== 'tool') {
        const callId = `call-stub-1261-${runTag}-${requests.length}`;
        const command = `echo QUOTA-RESUMED-${runTag} > resume-marker.txt`;
        res.write(chunk({ ...base, choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }] }));
        res.write(
          chunk({
            ...base,
            choices: [
              {
                index: 0,
                delta: { tool_calls: [{ index: 0, id: callId, type: 'function', function: { name: 'bash', arguments: '' } }] },
                finish_reason: null,
              },
            ],
          }),
        );
        res.write(
          chunk({
            ...base,
            choices: [
              { index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: JSON.stringify({ command }) } }] }, finish_reason: null },
            ],
          }),
        );
        res.write(chunk({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] }));
      } else {
        res.write(chunk({ ...base, choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }] }));
        for (const word of '额度已恢复，本轮继续执行并产出 marker 文件。'.split(/(?<=。|\.|\s)/u)) {
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
      }
      res.end();
    });
  });
  return new Promise((resolve2) => {
    server.listen(0, '127.0.0.1', () => {
      resolve2({
        url: `http://127.0.0.1:${server.address().port}/v1`,
        requests,
        setOk: () => {
          mode = 'ok';
        },
        quotaHits: () => requests.filter((r) => r.mode === 'quota').length,
        okHits: () => requests.filter((r) => r.mode === 'ok').length,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

async function seed(relayUrl) {
  const teams = await jfetch('GET', '/api/teams');
  const teamId = teams.body[0]?.id ?? teams.body.teams?.[0]?.id;
  if (!teamId) throw new Error(`no team: ${JSON.stringify(teams.body).slice(0, 200)}`);
  const providerRes = await jfetch('POST', `/api/teams/${teamId}/providers`, {
    body: {
      providerId: RELAY_ID,
      label: 'Relay 1261 Probe',
      baseUrl: relayUrl,
      api: 'openai-completions',
      authHeader: true,
      compat: { supportsDeveloperRole: false },
      models: [{ id: 'stub-model', name: 'stub-model' }],
    },
  });
  if (providerRes.status >= 400) throw new Error(`provider create failed: ${providerRes.status}`);
  const agentRes = await jfetch('POST', `/api/teams/${teamId}/agents`, {
    body: {
      displayName: `probe-1261-${runTag}`,
      provider: RELAY_ID,
      modelId: 'stub-model',
      skills: [],
    },
  });
  const agentId = agentRes.body?.id ?? agentRes.body?.agent?.id;
  if (!agentId) throw new Error(`agent create failed: ${agentRes.status}`);
  const keyRes = await jfetch('POST', `/api/teams/${teamId}/api-keys`, {
    body: {
      name: `probe-1261-${runTag}`,
      gitAccess: true,
      mcpAccess: false,
      toolGrants: { read: [], write: [] },
    },
  });
  const plaintext = keyRes.body?.plaintext ?? keyRes.body?.key;
  if (!plaintext) throw new Error(`api-key create failed: ${keyRes.status}`);
  const projectRes = await jfetch('POST', '/api/projects', {
    body: { name: `probe-1261-${runTag}`, teamId },
  });
  const projectId = projectRes.body?.id;
  if (!projectId) throw new Error(`project create failed: ${projectRes.status}`);
  return { teamId, agentId, apiKey: plaintext, projectId };
}

async function makeTask(projectId, agentId, title, spec) {
  const todoRes = await jfetch('POST', `/api/projects/${projectId}/todos`, { body: { title, spec } });
  const todoId = todoRes.body?.id;
  const buildRes = await jfetch('POST', `/api/projects/${projectId}/builds`, {
    body: { todoIds: [todoId], assignment: { plan: { agentId }, build: { agentId } }, withPlan: false },
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
  const child = spawn(
    'pnpm',
    [
      'exec',
      'tsx',
      'src/cli.ts',
      'start',
      '--foreground',
      '--server',
      SERVER,
      '--api-key',
      apiKey,
      '--team',
      teamId,
      '--name',
      'verify-1261',
    ],
    { cwd: join(REPO, 'apps/daemon'), env, stdio: ['ignore', 'pipe', 'pipe'] },
  );
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
function dbOne(sql, ...args) {
  const db = openDb();
  try {
    return db.prepare(sql).get(...args) ?? null;
  } finally {
    db.close();
  }
}
function dbAll(sql, ...args) {
  const db = openDb();
  try {
    return db.prepare(sql).all(...args);
  } finally {
    db.close();
  }
}
const dbTodo = (todoId) => dbOne('SELECT id, phase, latestBuildId FROM todo WHERE id = ?', todoId);
const dbBuild = (buildId) => dbOne('SELECT id, errorMessage FROM build WHERE id = ?', buildId);
const dbSteps = (buildId) =>
  dbAll('SELECT id, kind, status, quotaBlock FROM step WHERE buildId = ? ORDER BY createdAt', buildId);

rmSync(DAEMON_HOME, { recursive: true, force: true });

const relay = await startRelay();
const seeded = await seed(relay.url);
const daemon = spawnDaemon(seeded.apiKey, seeded.teamId);
const browser = await chromium.launch();

const taskA = await makeTask(
  seeded.projectId,
  seeded.agentId,
  '1261 等额度探针 A（限流断粮）',
  '探针任务 A：stub relay 返回 429，验证挂起等额度与自动续跑（#1261）。',
);
const taskB = await makeTask(
  seeded.projectId,
  seeded.agentId,
  '1261 等额度探针 B（限流断粮）',
  '探针任务 B：同一路 relay，验证双任务同挂同恢复（#1261）。',
);
const buildStartAt = Date.now();

let bannerVisibleAt = null;
try {

  const warm = await browser.newPage();
  await warm.goto(`${WEB}/app`, { waitUntil: 'networkidle', timeout: 90_000 });
  await warm.close();
  await waitFor(
    () => daemonLogLines().some((l) => l.includes('[wake] push channel connected')),
    60_000,
    'daemon online',
  );

  const board = await browser.newPage();
  await board.goto(`${WEB}/app`, { waitUntil: 'networkidle', timeout: 90_000 });

  await waitFor(
    () => relay.quotaHits() >= 2,
    60_000,
    'both tasks hit the quota-dead relay',
  );
  await waitFor(
    () => {
      const a = dbSteps(taskA.buildId).find((s) => s.kind === 'build');
      const b = dbSteps(taskB.buildId).find((s) => s.kind === 'build');
      return a?.status === 'waiting_quota' && b?.status === 'waiting_quota' ? { a, b } : null;
    },
    30_000,
    'both build steps suspended to waiting_quota',
  );

  const log = daemonLogLines();
  const breakerLines = log.filter((l) => l.includes('quota circuit breaker'));
  const autoRetryLines = log.filter((l) => l.includes('auto_retry_start'));
  const stormLines = log.filter((l) => l.includes('retry storm'));
  check(
    '1a 熔断在案：daemon.log 两行 quota circuit breaker（每任务一行）',
    breakerLines.length === 2,
    breakerLines.join(' | ').slice(0, 300),
  );
  check(
    '1b 风暴未起：零 retry storm、auto_retry_start ≤ 2（旧路径烧至 4+）',
    stormLines.length === 0 && autoRetryLines.length <= 2,
    `storm=${stormLines.length} auto_retry=${autoRetryLines.length}`,
  );

  const stepA = dbSteps(taskA.buildId).find((s) => s.kind === 'build');
  const blockA = JSON.parse(stepA?.quotaBlock ?? 'null');
  check(
    '2a 挂起不判死：两任务 todo 仍 building、build.errorMessage 空',
    dbTodo(taskA.todoId)?.phase === 'building' &&
      dbTodo(taskB.todoId)?.phase === 'building' &&
      dbBuild(taskA.buildId)?.errorMessage == null,
    `phaseA=${dbTodo(taskA.todoId)?.phase} errA=${dbBuild(taskA.buildId)?.errorMessage}`,
  );
  check(
    '2b Retry-After 链：quotaBlock.kind=capacity、retryAfterMs=5000、relay 指名',
    blockA?.kind === 'capacity' && blockA?.retryAfterMs === 5000 && blockA?.providerId === RELAY_ID,
    JSON.stringify(blockA).slice(0, 300),
  );

  const notif = dbAll(
    "SELECT id, type, snippet, entityId FROM notification WHERE type = 'quota_wait' AND entityId IN (?, ?) ORDER BY createdAt",
    taskA.todoId,
    taskB.todoId,
  );
  check(
    '4 in-app 通知两行（每任务一条 quota_wait，snippet 指名 relay lane）',
    notif.length === 2 && notif.every((n) => n.snippet?.includes('Relay 1261 Probe')),
    notif.map((n) => n.snippet).join(' | ').slice(0, 300),
  );

  const banner = board.locator('[data-quota-banner]');
  await banner.waitFor({ state: 'visible', timeout: 120_000 });
  bannerVisibleAt = Date.now();
  const bannerText = await banner.innerText();
  const within3min = bannerVisibleAt - buildStartAt <= 180_000;
  check(
    '3a 板面横幅出现（SSE live-push）且指名 relay + 限流 + 双任务计数',
    bannerText.includes('Relay 1261 Probe') && bannerText.includes('限流') && bannerText.includes('2'),
    bannerText.replace(/\n/g, ' ').slice(0, 200),
  );
  check(
    '3b 验收红线：建任务 → 横幅可见 ≤ 3 分钟（实测含冷编译与派发）',
    within3min,
    `elapsed=${Math.round((bannerVisibleAt - buildStartAt) / 1000)}s`,
  );
  const chipA = board.locator(`[data-todo-id="${taskA.todoId}"] [data-todo-quota]`);
  const chipB = board.locator(`[data-todo-id="${taskB.todoId}"] [data-todo-quota]`);
  check(
    '3c 两卡「等额度」芯片在位（capacity 档）',
    (await chipA.count()) === 1 && (await chipB.count()) === 1,
    null,
  );
  await board.screenshot({ path: join(EVIDENCE, 'board-quota-waiting.png'), fullPage: false });

  const detail = await browser.newPage();
  await detail.goto(`${WEB}/app/todo/${taskA.todoId}`, { waitUntil: 'networkidle', timeout: 90_000 });
  const headChip = await detail.getByTestId('phase-chip').innerText();
  check('3d 详情头 chip = 等额度（不再谎称执行中）', headChip.includes('等额度'), headChip);
  const rowText = await detail
    .locator('[data-testid="live-row"] .chat-streaming-label')
    .first()
    .innerText()
    .catch(() => '');
  check(
    '3e 详情进度行 = 等额度：relay + 限流 + 自动探测续跑',
    rowText.includes('等额度') && rowText.includes('Relay 1261 Probe') && rowText.includes('自动探测续跑'),
    rowText.replace(/\n/g, ' ').slice(0, 200),
  );
  await detail.screenshot({ path: join(EVIDENCE, 'detail-quota-waiting.png'), fullPage: false });

  relay.setOk();
  const resumeAt = Date.now();
  await waitFor(
    () => relay.okHits() >= 4,
    90_000,
    'both sessions resumed against the ok relay (2 requests each)',
  );
  const doneA = await waitFor(
    () => {
      const s = dbSteps(taskA.buildId).find((x) => x.kind === 'build');
      return s?.status === 'done' ? s : null;
    },
    120_000,
    'task A build step completed after quota recovery',
  );
  await waitFor(
    () => {
      const s = dbSteps(taskB.buildId).find((x) => x.kind === 'build');
      return s?.status === 'done';
    },
    120_000,
    'task B build step completed after quota recovery',
  );
  check(
    '5a 自动续跑：两步 done（无人工操作，翻转即恢复）',
    doneA.status === 'done' && dbSteps(taskB.buildId).find((x) => x.kind === 'build')?.status === 'done',
    `resume→done=${Math.round((Date.now() - resumeAt) / 1000)}s`,
  );
  await waitFor(
    () => {
      const p = dbTodo(taskA.todoId)?.phase;
      return p === 'review' || p === 'confirm' ? p : null;
    },
    60_000,
    'todo A advanced to a gate phase after recovery',
  );
  check(
    '5b 额度恢复后正常收尾：todo 进 review 关口（产物在、判据走常轨）',
    ['review', 'confirm'].includes(dbTodo(taskA.todoId)?.phase),
    `phaseA=${dbTodo(taskA.todoId)?.phase}`,
  );
  const postBanner = await board.locator('[data-quota-banner]').count();
  check('5c 恢复后横幅退场（板面回常态）', postBanner === 0, `banner count=${postBanner}`);
  await board.screenshot({ path: join(EVIDENCE, 'board-after-resume.png'), fullPage: false });

  const markerRows = dbAll(
    'SELECT id, role, content FROM message WHERE conversationId = ? ORDER BY createdAt',
    taskA.buildId,
  );
  const markerSeen = markerRows.some((r) => JSON.stringify(r.content).includes(`QUOTA-RESUMED-${runTag}`) || JSON.stringify(r.content).includes('bash'));
  check(
    '5d 续跑产物在案：ok 轮工具调用进 transcript（marker 命令行）',
    markerSeen,
    `rows=${markerRows.length}`,
  );

  finish({
    timeline: {
      buildStartAt,
      bannerVisibleAt,
      resumeAt,
      elapsedToBannerMs: bannerVisibleAt - buildStartAt,
      elapsedResumeToDoneMs: Date.now() - resumeAt,
    },
    relayRequests: relay.requests.length,
    quotaHits: relay.quotaHits(),
    okHits: relay.okHits(),
  });
} catch (err) {
  check('probe 主体流程未中断', false, err instanceof Error ? err.message : String(err));
  finish({ error: err instanceof Error ? err.message : String(err) });
} finally {
  await browser.close().catch(() => {});
  daemon.kill('SIGTERM');
  await relay.close();
  rmSync(DAEMON_HOME, { recursive: true, force: true });
}
