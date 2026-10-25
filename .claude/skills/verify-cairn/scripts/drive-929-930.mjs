import { spawn, execSync } from 'node:child_process';
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
const DAEMON_HOME = process.env.DAEMON_HOME ?? '/tmp/cairn-929-930-daemon-home';
const MCP_HOME = process.env.MCP_HOME ?? '/tmp/cairn-929-930-mcp';
const MCP_CONFIG = join(MCP_HOME, 'claude.json');
const SKILLS_DIR = join(MCP_HOME, 'skills-empty');

const ts = new Date().toISOString().replace(/[:.]/g, '-');
const EVIDENCE = process.env.VERIFY_EVIDENCE_DIR ?? join(SCRIPT_REPO, `.claude/verify-evidence/${ts}-929-930`);
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
  const passed = checks.filter((c) => c.ok).length;
  save('result.json', {
    probe: 'drive-929-930',
    server: SERVER,
    web: WEB,
    db: DB,
    daemonHome: DAEMON_HOME,
    mcpConfig: MCP_CONFIG,
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

function startStubLlm(responses) {
  const requests = [];
  let next = 0;
  const runId = Date.now().toString(36);
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
        const base = { id: 'chatcmpl-stub', object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: 'stub-model' };
        const chunk = (payload) => `data: ${JSON.stringify(payload)}\n\n`;
        res.write(chunk({ ...base, choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }] }));
        if (rsp.toolCall) {
          const callId = `call-stub-${runId}-${requests.length}`;
          res.write(chunk({ ...base, choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: callId, type: 'function', function: { name: rsp.toolCall.name, arguments: '' } }] }, finish_reason: null }] }));
          res.write(chunk({ ...base, choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: JSON.stringify(rsp.toolCall.arguments ?? {}) } }] }, finish_reason: null }] }));
          res.write(chunk({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] }));
        } else {
          for (const word of (rsp.content ?? 'ok').split(/(?<=。|\.|\s)/u)) {
            if (word !== '') res.write(chunk({ ...base, choices: [{ index: 0, delta: { content: word } }] }));
          }
          res.write(chunk({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }));
        }
        res.write(chunk({ ...base, choices: [], usage: { prompt_tokens: 12, completion_tokens: 40, total_tokens: 52, prompt_tokens_details: { cached_tokens: 0 } } }));
        res.write('data: [DONE]\n\n');
        res.end();
      };
      if (rsp.delayMs) setTimeout(send, rsp.delayMs);
      else send();
    });
  });
  return new Promise((resolve2) => {
    server.listen(0, '127.0.0.1', () => {
      resolve2({ url: `http://127.0.0.1:${server.address().port}/v1`, requests, close: () => new Promise((r) => server.close(r)) });
    });
  });
}

const MCP_SERVER_MARKER = `verify-echo-${Date.now().toString(36)}`;
const MCP_SERVER_FILE = join(REPO, 'apps', 'daemon', `verify-929-930-mcp-server-${Date.now().toString(36)}.mjs`);
const MCP_SERVER_SRC = `
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
const server = new McpServer({ name: 'verify-929-930', version: '0.0.1' });
server.registerTool('echo', { description: 'Echo text back.', inputSchema: { text: z.string() } }, async (args) => ({
  content: [{ type: 'text', text: '${MCP_SERVER_MARKER}:' + args.text }],
}));
server.resource('note', 'demo://note', { description: 'A demo note resource (#930).' }, async () => ({
  contents: [{ uri: 'demo://note', text: 'demo-note-content' }],
}));
await server.connect(new StdioServerTransport());
`;

let uniq = 0;
async function seed(stubUrl) {
  const teams = await jfetch('GET', '/api/teams');
  const teamId = teams.body[0]?.id ?? teams.body.teams?.[0]?.id;
  if (!teamId) throw new Error(`no team: ${JSON.stringify(teams.body).slice(0, 200)}`);
  const runTag = Date.now().toString(36);
  const providerId = `stub-929-930-${runTag}`;
  const provRes = await jfetch('POST', `/api/teams/${teamId}/providers`, {
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
  if (provRes.status >= 400) throw new Error(`provider create failed: ${provRes.status}`);
  const agentRes = await jfetch('POST', `/api/teams/${teamId}/agents`, {
    body: {
      displayName: `probe-929-930-${++uniq}`,
      provider: providerId,
      modelId: 'stub-model',
      skills: [],
      mcpServers: ['demo', 'dead', 'ghost'],
    },
  });
  const agentId = agentRes.body?.id ?? agentRes.body?.agent?.id;
  if (!agentId) throw new Error(`agent create failed: ${agentRes.status} ${JSON.stringify(agentRes.body).slice(0, 200)}`);
  const keyRes = await jfetch('POST', `/api/teams/${teamId}/api-keys`, {
    body: { name: `probe-929-930-${Date.now()}`, gitAccess: false, mcpAccess: false, toolGrants: { read: [], write: [] } },
  });
  const plaintext = keyRes.body?.plaintext ?? keyRes.body?.key;
  if (!plaintext) throw new Error(`api-key create failed: ${keyRes.status}`);
  const projRes = await jfetch('POST', '/api/projects', { body: { name: `probe-929-930-${Date.now()}` } });
  return { teamId, agentId, apiKey: plaintext, projectId: projRes.body?.id };
}

async function makeTask(projectId, agentId, title) {
  const todoRes = await jfetch('POST', `/api/projects/${projectId}/todos`, {
    body: { title, spec: '按 stub 脚本跑一步（#929/#930 探针任务）' },
  });
  const todoId = todoRes.body?.id;
  const buildRes = await jfetch('POST', `/api/projects/${projectId}/builds`, {
    body: { todoIds: [todoId], assignment: { plan: null, build: { agentId } }, withPlan: false },
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
  env.CAIRN_MCP_CONFIG = MCP_CONFIG;
  env.CAIRN_SKILLS_DIR = SKILLS_DIR;
  const out = join(EVIDENCE, 'daemon-console.log');
  writeFileSync(out, '');
  const child = spawn('pnpm', ['exec', 'tsx', 'src/cli.ts', 'start', '--foreground', '--server', SERVER, '--api-key', apiKey, '--team', teamId, '--name', 'verify-929-930'], {
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

async function waitStepTerminal(buildId, timeoutMs = 180_000) {
  return waitFor(
    () => {
      const db = openDb();
      try {
        const rows = db.prepare('SELECT id, kind, status FROM step WHERE buildId = ? ORDER BY createdAt').all(buildId);
        const terminal = rows.filter((r) => ['done', 'failed', 'stopped'].includes(r.status));
        if (terminal.length === 0) return null;
        const build = db.prepare('SELECT id, errorMessage FROM build WHERE id = ?').get(buildId);
        return { rows, terminal: { ...terminal[terminal.length - 1], buildErrorMessage: build?.errorMessage ?? null } };
      } finally {
        db.close();
      }
    },
    timeoutMs,
    `step terminal for ${buildId}`,
  );
}

rmSync(DAEMON_HOME, { recursive: true, force: true });
rmSync(MCP_HOME, { recursive: true, force: true });
mkdirSync(MCP_HOME, { recursive: true });
mkdirSync(SKILLS_DIR, { recursive: true });
writeFileSync(MCP_SERVER_FILE, MCP_SERVER_SRC);
writeFileSync(
  MCP_CONFIG,
  JSON.stringify({
    mcpServers: {
      demo: { command: process.execPath, args: [MCP_SERVER_FILE] },
      dead: { url: 'http://127.0.0.1:1/mcp' },
    },
  }),
  'utf8',
);
check('MCP 本机 config fixture 落盘（demo=stdio 活端点 + dead=死端点）', existsSync(MCP_CONFIG), MCP_CONFIG);

const stub = await startStubLlm([

  { toolCall: { name: 'bash', arguments: { command: 'rm -rf /' } }, delayMs: 4_000 },

  { toolCall: { name: 'read_mcp_resource', arguments: { server: 'demo', uri: 'demo://note' } }, delayMs: 4_000 },

  { toolCall: { name: 'mcp__demo__echo', arguments: { text: 'live-gate' } }, delayMs: 6_000 },

  { toolCall: { name: 'bash', arguments: { command: 'printf "verify 929 30\\n" >> README.md' } }, delayMs: 6_000 },

  { content: '闸与桥双向验证完成。', delayMs: 2_000 },
]);

const seeded = await seed(stub.url);
const daemon = spawnDaemon(seeded.apiKey, seeded.teamId);
const browser = await chromium.launch();
let task = null;

const mcpChildCount = () => {
  try {
    return Number(
      execSync(`pgrep -f "${MCP_SERVER_FILE}" | wc -l`, { encoding: 'utf8' }).trim(),
    );
  } catch {
    return 0;
  }
};

try {

  const warm = await browser.newPage();
  await warm.goto(`${WEB}/app`, { waitUntil: 'networkidle', timeout: 90_000 });
  await warm.close();

  await waitFor(() => daemonLogLines().some((l) => l.includes('[wake] push channel connected')), 60_000, 'daemon online');
  check('真 daemon 上线（--server 指本栈，CAIRN_MCP_CONFIG 指 fixture）', true, DAEMON_HOME);

  task = await makeTask(seeded.projectId, seeded.agentId, '929/930 闸与桥探针');
  const page = await browser.newPage({ viewport: { width: 1440, height: 732 } });
  await page.goto(`${WEB}/app/todo/${task.todoId}`);
  await page.getByTestId('live-row').first().waitFor({ timeout: 90_000 });

  await page.waitForTimeout(15_000);
  await page.screenshot({ path: join(EVIDENCE, 'live-mcp.png') }).catch(() => {});

  const terminal = await waitStepTerminal(task.buildId);
  check('步以 done 收尾（闸拒 + 死端点 + ghost 全不阻断会话；产物闸被放行 bash 满足）', terminal.terminal?.status === 'done', JSON.stringify(terminal.terminal));

  const lines = daemonLogLines();
  save('daemon.log', lines.join('\n'));
  check('#929 拒绝：[gate] canon 行（rule + command）', lines.some((l) => l.includes('[gate] ask: rule=ask-rm-rf-root command=rm -rf /')), 'daemon.log');
  const db = openDb();
  let dbRows;
  try {
    dbRows = db.prepare('SELECT id, role, content FROM message WHERE conversationId = ?').all(task.buildId);
  } finally {
    db.close();
  }
  const flat = JSON.stringify(dbRows);
  save('messages.json', dbRows);
  check('#929 拒绝：改道文案进 transcript 工具行（模型可见 reason，非空 tool error）', flat.includes('command gate (ask-rm-rf-root)') && flat.includes('requires approval, and this daemon runs unattended'), `messages=${dbRows.length}`);
  check('#929 放行：合法 bash 照跑（printf 改动落 README.md，进 transcript）', flat.includes('verify 929 30'), null);

  const firstRequest = stub.requests[0] ?? {};
  const declared = (firstRequest.tools ?? []).map((t) => t?.function?.name ?? '').filter((n) => n !== '');
  save('first-request-tools.json', declared);
  check('#930 声明面：首轮请求 tools 含 bash + mcp__demo__echo + read_mcp_resource（MCP 工具直报模型）', declared.includes('bash') && declared.includes('mcp__demo__echo') && declared.includes('read_mcp_resource'), declared.join(','));
  check('#930 放行：mcp__demo__echo 真调（命名与旧桥逐字节同形；回文 marker 落 transcript）', flat.includes('mcp__demo__echo') && flat.includes(`${MCP_SERVER_MARKER}:live-gate`), null);
  check('#930 新能力：resources 工具可用（read_mcp_resource 读回 note 内容落 transcript）', flat.includes('demo-note-content'), null);
  check('#930 拒绝：死端点降级 canon 行（带 reason，单点失败不阻断）', lines.some((l) => l.includes('[mcp] dead: connect failed — its tools are unavailable this turn')), 'daemon.log');
  check('#930 拒绝：未命中 slug 扩展行（ghost not in local config）', lines.some((l) => l.includes('[mcp] ghost: not in local config — its tools are unavailable this turn')), 'daemon.log');
  check('#930 装载行：实际加载集与来源文件（demo, dead）', lines.some((l) => l.includes(`[mcp] loaded from ${MCP_CONFIG}: demo, dead`)), 'daemon.log');

  await waitFor(() => mcpChildCount() === 0, 30_000, 'mcp stdio child exit');
  check('收尾：步终态后 MCP stdio 子进程已关（session_shutdown 缝，无孤儿泄漏）', mcpChildCount() === 0, `children=${mcpChildCount()}`);

  await page.waitForTimeout(3_000);
  await page.reload({ waitUntil: 'networkidle' });
  const toolToggles = page.getByRole('button', { name: /工具过程/ });
  for (let i = 0; i < (await toolToggles.count()); i++) {
    if ((await toolToggles.nth(i).getAttribute('aria-expanded')) === 'false') {
      await toolToggles.nth(i).click().catch(() => {});
    }
  }
  await page.getByTestId('tool-pill').first().waitFor({ timeout: 30_000 });
  await page.screenshot({ path: join(EVIDENCE, 'detail-transcript.png'), fullPage: true });
  const pills = await page.getByTestId('tool-pill').allTextContents();
  const pillFlat = pills.join('|');
  check('详情页 transcript 工具行可见（bash + mcp__demo__echo + read_mcp_resource）', pillFlat.includes('bash') && pillFlat.includes('mcp__demo__echo') && pillFlat.includes('read_mcp_resource'), pillFlat);

  finish({ task, mcpServerFile: MCP_SERVER_FILE, echoMarker: MCP_SERVER_MARKER });
} catch (err) {
  check(`探针异常：${err instanceof Error ? err.message : String(err)}`, false);
  try {
    for (const p of browser.contexts().flatMap((c) => c.pages())) {
      await p.screenshot({ path: join(EVIDENCE, `fail-${Date.now()}.png`) }).catch(() => {});
    }
    save('fail-daemon.log', daemonLogLines().join('\n'));
  } catch {

  }
  finish({ error: err instanceof Error ? err.stack : String(err) });
} finally {
  daemon.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 2_000));
  if (daemon.exitCode === null) daemon.kill('SIGKILL');
  await stub.close();
  await browser.close();
  rmSync(MCP_SERVER_FILE, { force: true });
}
