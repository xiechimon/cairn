// verify-pacman 定制 probe（#1210 C 兜底）：local 形态项目的仓路径在执行机
// 不可达时，步在 clone/fetch 之前显式失败——errorMessage 点名机器/路径/原因/
// 补法（不再是裸 git clone 错误 + 重试退避），仓库所在机上行为零漂移。
// 纯 HTTP + fs + SQLite + daemon.log + 浏览器详情页真用户路径；自 spawn
// stub LLM + 单 daemon 并自回收。
//
// 「他机不可达」的模拟口径：单机上把仓目录 mv 走——existsSync 视角与
// 「repo 在另一台机器上」不可分（daemon 只看本机文件系统），与 #1213 probe
// 的 PATCH → 不存在路径同族手法。
//
// 票面验收 seam 对照：
//   fail-loud  腿 A：mv 走仓目录 → build 步失败；SQLite build.errorMessage =
//            合成文案（机器名/路径/「路径不存在」/两条补法）；daemon.log 无
//            `Cloning` 行（clone 未尝试 = fail-fast，不烧 withGitNetRetries
//            的 1s+5s 退避）；详情页失败卡显示文案（截图）。
//   回归      腿 B：mv 回仓目录 → 新 build 步照常材料化（`Cloning <路径>` +
//            `Worktree added` 日志行、基座/conv worktree git 实物在位、
//            README 内容对）；步终态若 failed 也只属 stub 零改动产物闸，
//            errorMessage 不含不可达文案。
//   凭据面    local 形态凭证恒 null；errorMessage 与 daemon.log 断言不含
//            token/password 字样。
//
// 用法（配方 = docs/verify/1210/README.md）：
//   先 launch.mjs 起栈，再 node drive-1210-local-unreachable.mjs [--expect=new|old]
//   --expect=old（缺省 new）：断言反转成基线形——腿 A 期望裸 git clone 错误
//   （`does not exist`）且 daemon.log 有 `Cloning` 行（clone 尝试 + 重试退避
//   = 旧行为指纹）；打在 origin/main 一次性 worktree 栈上取 before 证据
//   （VERIFY_REPO_ROOT 指向 before 树 = daemon 用旧代码，#1035 配方）。
// env：SERVER（缺省读 VERIFY_RUN_DIR/ports.json）、VERIFY_RUN_DIR、
//      VERIFY_EVIDENCE_DIR、VERIFY_REPO_ROOT。
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const EXPECT = process.argv.includes('--expect=old') ? 'old' : 'new';
const SCRIPT_REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const REPO = process.env.VERIFY_REPO_ROOT ?? SCRIPT_REPO;
const RUN_DIR = process.env.VERIFY_RUN_DIR ?? join(REPO, '.claude', 'verify-run');
const stack = JSON.parse(readFileSync(join(RUN_DIR, 'ports.json'), 'utf8'));
const SERVER = process.env.SERVER ?? `http://127.0.0.1:${stack.serverPort}`;
const DB = join(stack.homeDir, 'server', 'server.db');

const MACHINE_NAME = 'verify-1210';
const DAEMON_HOME = `/tmp/pacman-1210-daemon-${Date.now()}`;

const ts = new Date().toISOString().replace(/[:.]/g, '-');
const EVIDENCE =
  process.env.VERIFY_EVIDENCE_DIR ?? join(SCRIPT_REPO, `.claude/verify-evidence/${ts}-1210-local-unreachable`);
mkdirSync(EVIDENCE, { recursive: true });

const checks = [];
function check(name, ok, detail) {
  checks.push({ name, ok: Boolean(ok), detail: detail ?? null });
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}\n`);
}
function save(name, data) {
  writeFileSync(join(EVIDENCE, name), typeof data === 'string' ? data : `${JSON.stringify(data, null, 2)}\n`);
}

async function jfetch(method, path, opts = {}) {
  const headers = {};
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(`${SERVER}${path}`, {
    method,
    headers,
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
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

// —— stub LLM（drive-1213 同款最小形）：纯文本应答。腿 A 的步死在 prepare
//    （会话之前），stub 只服务腿 B 的会话轮；零改动 → 产物闸 failed 收尾
//    属预期（材料化 seam 在会话之前，验收面 = 材料化实物 + 文案区分）。

function startStubLlm() {
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
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      const base = {
        id: 'chatcmpl-stub',
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: 'stub-model',
      };
      const chunk = (payload) => `data: ${JSON.stringify(payload)}\n\n`;
      res.write(chunk({ ...base, choices: [{ index: 0, delta: { role: 'assistant', content: '探针无需改动。' }, finish_reason: null }] }));
      res.write(chunk({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }));
      res.write('data: [DONE]\n\n');
      res.end();
    });
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r({ server, port: server.address().port })));
}

function git(args, cwd) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  return { code: r.status, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() };
}

/** local 形态种子仓：非 bare 工作树仓、main、单提交 README。 */
function seedLocalRepo() {
  const dir = join(mkdtempSync(join(tmpdir(), 'pacman-1210-repo-')), 'repo');
  const init = git(['init', '-b', 'main', dir]);
  if (init.code !== 0) throw new Error(`git init failed: ${init.err}`);
  writeFileSync(join(dir, 'README.md'), '# 1210 local repo\n');
  git(['add', '-A'], dir);
  const commit = spawnSync(
    'git',
    ['-C', dir, '-c', 'user.name=probe', '-c', 'user.email=probe@pacman.test', 'commit', '-m', 'seed'],
    { encoding: 'utf8' },
  );
  if (commit.status !== 0) throw new Error(`git commit failed: ${commit.stderr}`);
  return dir;
}

// —— daemon spawn（drive-1213 同形：--server 显式进命令行 = cleanup 钉选面）——

function spawnDaemon(apiKey, teamId) {
  const env = { ...process.env };
  for (const k of ['http_proxy', 'https_proxy', 'all_proxy', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY']) delete env[k];
  env.NO_PROXY = '*';
  env.PACMAN_HOME = DAEMON_HOME;
  const out = join(EVIDENCE, 'daemon-console.log');
  writeFileSync(out, '');
  const child = spawn(
    'pnpm',
    ['exec', 'tsx', 'src/cli.ts', 'start', '--foreground', '--server', SERVER, '--api-key', apiKey, '--team', teamId, '--name', MACHINE_NAME],
    { cwd: join(REPO, 'apps/daemon'), env, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  child.stdout.on('data', (d) => appendFileSync(out, d));
  child.stderr.on('data', (d) => appendFileSync(out, d));
  return child;
}

function daemonLogLines() {
  const p = join(DAEMON_HOME, 'daemon.log');
  if (!existsSync(p)) return [];
  return readFileSync(p, 'utf8').split('\n').filter(Boolean);
}

function openDb() {
  const require2 = createRequire(join(REPO, 'apps/server/package.json'));
  const Database = require2('better-sqlite3');
  return new Database(DB, { readonly: true });
}

/** 步终态轮询（#920 gotcha：step 表无 errorMessage 列，根因落 build.errorMessage；
 * build 表也无 status 列——终态判据 = 该 build 的任一 step 行入 done/failed/stopped）。
 * 返回 {stepStatus, errorMessage, elapsedMs(探针墙钟)}。 */
async function waitBuildTerminal(buildId, timeoutMs = 180_000) {
  const started = Date.now();
  for (;;) {
    const db = openDb();
    let out = null;
    try {
      const steps = db.prepare('SELECT id, kind, status FROM step WHERE buildId = ? ORDER BY createdAt').all(buildId);
      const terminal = steps.filter((s) => ['done', 'failed', 'stopped'].includes(s.status));
      const buildRow = db.prepare('SELECT errorMessage FROM build WHERE id = ?').get(buildId);
      out = {
        steps,
        stepStatus: terminal.length > 0 ? terminal[terminal.length - 1].status : (steps[steps.length - 1]?.status ?? null),
        errorMessage: buildRow?.errorMessage ?? '',
        elapsedMs: Date.now() - started,
      };
    } finally {
      db.close();
    }
    if (out && ['done', 'failed', 'stopped'].includes(out.stepStatus)) return out;
    if (Date.now() - started > timeoutMs) return out;
    await new Promise((r) => setTimeout(r, 1000));
  }
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

// —— main —————————————————————————————————————————————————————————————

let stubHandle = null;
let daemon = null;
let browser = null;
const repoDir = seedLocalRepo();
const repoGone = `${repoDir}-gone`;
try {
  stubHandle = await startStubLlm();
  const stubUrl = `http://127.0.0.1:${stubHandle.port}/v1`;

  // seed：team / provider / agent / api-key。
  const teams = await jfetch('GET', '/api/teams');
  const teamId = teams.body[0]?.id ?? teams.body.teams?.[0]?.id;
  if (!teamId) throw new Error(`no team: ${JSON.stringify(teams.body).slice(0, 200)}`);
  const providerBody = {
    providerId: 'stub-gw',
    label: 'stub-gw',
    baseUrl: stubUrl,
    api: 'openai-completions',
    authHeader: true,
    compat: { supportsDeveloperRole: false },
    models: [{ id: 'stub-model', name: 'stub-model' }],
  };
  let provRes = await jfetch('POST', `/api/teams/${teamId}/providers`, { body: providerBody });
  if (provRes.status >= 400) {
    const listRes = await jfetch('GET', `/api/teams/${teamId}/providers`);
    const existing = (listRes.body?.providers ?? []).find((p) => p.providerId === 'stub-gw');
    if (!existing) throw new Error(`provider seed failed: POST ${provRes.status}`);
    provRes = await jfetch('PATCH', `/api/teams/${teamId}/providers/${existing.id}`, {
      body: { baseUrl: stubUrl, models: providerBody.models },
    });
    if (provRes.status >= 400) throw new Error(`provider seed failed PATCH ${provRes.status}`);
  }
  const agentRes = await jfetch('POST', `/api/teams/${teamId}/agents`, {
    body: {
      displayName: `probe-1210-builder-${Date.now()}`,
      description: '你是 1210 探针执行 Agent。',
      provider: 'stub-gw',
      modelId: 'stub-model',
    },
  });
  const agentId = agentRes.body?.id ?? agentRes.body?.agent?.id;
  if (!agentId) throw new Error(`agent create failed: ${agentRes.status}`);
  const keyRes = await jfetch('POST', `/api/teams/${teamId}/api-keys`, {
    body: { name: `probe-1210-${Date.now()}`, gitAccess: false, mcpAccess: false, toolGrants: { read: [], write: [] } },
  });
  const apiKey = keyRes.body?.plaintext ?? keyRes.body?.key;
  if (!apiKey) throw new Error(`api-key create failed: ${keyRes.status}`);

  // —— local 项目创建（路径此刻在位，server 创建闸过）。

  const projRes = await jfetch('POST', '/api/projects', {
    body: { name: `probe-1210-${Date.now()}`, teamId, kind: 'local', localPath: repoDir },
  });
  const projectId = projRes.body?.id;
  check('POST local 项目 201（路径在位，创建闸过）', projRes.status === 201 && Boolean(projectId), `${projRes.status}`);
  if (!projectId) throw new Error(`project create failed: ${projRes.status} ${JSON.stringify(projRes.body).slice(0, 200)}`);
  const todoRes = await jfetch('POST', `/api/projects/${projectId}/todos`, {
    body: { title: 'local 不可达探针', spec: '探针任务：无需改动。' },
  });
  const todoId = todoRes.body?.id;
  if (!todoId) throw new Error(`todo create failed: ${todoRes.status}`);

  daemon = spawnDaemon(apiKey, teamId);
  await waitFor(() => daemonLogLines().some((l) => l.includes('[wake] push channel connected')), 90_000, 'daemon online');

  // —— 腿 A：mv 走仓目录（模拟「repo 在另一台机器上」）→ 步显式失败。

  renameSync(repoDir, repoGone);
  const buildA = await jfetch('POST', `/api/projects/${projectId}/builds`, {
    body: { todoIds: [todoId], assignment: { plan: { agentId }, build: { agentId } }, withPlan: false },
  });
  const buildAId = buildA.body?.builds?.[0]?.id;
  if (!buildAId) throw new Error(`build A failed: ${buildA.status} ${JSON.stringify(buildA.body).slice(0, 200)}`);

  const rowA = await waitBuildTerminal(buildAId);
  save('leg-a-build-row.json', rowA);
  check('腿 A：步入终态 failed（不是挂起等待）', rowA?.stepStatus === 'failed', `stepStatus=${rowA?.stepStatus}`);
  const msgA = rowA?.errorMessage ?? '';
  save('leg-a-error-message.txt', msgA);
  const elapsedA = rowA?.elapsedMs ?? null;
  save('leg-a-elapsed-ms.txt', String(elapsedA));
  const linesA = daemonLogLines();
  if (EXPECT === 'new') {
    check('腿 A：errorMessage 点名机器名', msgA.includes(MACHINE_NAME), msgA.slice(0, 120));
    check('腿 A：errorMessage 点名仓路径', msgA.includes(repoDir), repoDir);
    check('腿 A：errorMessage 带原因人话（路径不存在）', msgA.includes('路径不存在'));
    check('腿 A：errorMessage 带补法①钉选机器 / ②GitHub 形态', msgA.includes('钉选') && msgA.includes('GitHub 形态'));
    const failedLine = linesA.find((l) => l.includes('[step] failed:') && l.includes('无法在机器'));
    check('腿 A：daemon.log 落 [step] failed 合成文案行', Boolean(failedLine), (failedLine ?? '<missing>').slice(0, 160));
    check(
      '腿 A：clone 未尝试（无 Cloning 行 = fail-fast，不烧重试退避）',
      !linesA.some((l) => l.includes('Cloning')),
      `elapsed=${elapsedA}ms`,
    );
  } else {
    // 基线形（origin/main 栈）：裸 git clone 错误直透 + clone 尝试痕迹 +
    // withGitNetRetries 退避（elapsed 信息位，新行为下无此三项）。
    check('腿 A(old)：errorMessage = 裸 git 错误（fatal/does not exist）', /fatal|does not exist/i.test(msgA), msgA.slice(0, 160));
    check('腿 A(old)：errorMessage 无合成文案', !msgA.includes('无法在机器'));
    check('腿 A(old)：daemon.log 有 Cloning 行（clone 被尝试）', linesA.some((l) => l.includes('Cloning')), `elapsed=${elapsedA}ms`);
  }
  check('腿 A：errorMessage 零凭据字样', !/token|password|x-access/i.test(msgA));
  check(
    '腿 A：workspace 未材料化（基座目录不存在）',
    !existsSync(join(DAEMON_HOME, 'workspaces', projectId, 'repo')),
  );
  const todoRecA = await jfetch('GET', `/api/todos/${todoId}`);
  save('leg-a-todo-record.json', todoRecA.body);
  check('腿 A：REST todo record phase=failed（API 真值）', todoRecA.body?.phase === 'failed', `phase=${todoRecA.body?.phase}`);

  // 详情页真用户路径：失败文案可见（截图证据）。
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 732 } });
  await page.goto(`http://127.0.0.1:${stack.webPort}/app/todo/${todoId}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  const bodyText = await page.evaluate(() => document.body.innerText);
  if (EXPECT === 'new') {
    check('腿 A：详情页可见失败文案（点名机器）', bodyText.includes('无法在机器') && bodyText.includes(MACHINE_NAME));
  } else {
    check('腿 A(old)：详情页可见裸 git 错误', /fatal|does not exist/i.test(bodyText) || bodyText.includes(repoDir));
  }
  await page.screenshot({ path: join(EVIDENCE, 'leg-a-detail-failed.png'), fullPage: true });

  // —— 腿 B：mv 回仓目录（仓库所在机形态）→ 材料化照常，行为零漂移。

  renameSync(repoGone, repoDir);
  const buildB = await jfetch('POST', `/api/projects/${projectId}/builds`, {
    body: { todoIds: [todoId], assignment: { plan: { agentId }, build: { agentId } }, withPlan: false },
  });
  const buildBId = buildB.body?.builds?.[0]?.id;
  if (!buildBId) throw new Error(`build B failed: ${buildB.status} ${JSON.stringify(buildB.body).slice(0, 200)}`);

  await waitFor(
    () => daemonLogLines().some((l) => l.includes('Worktree added')),
    150_000,
    'worktree added (leg B)',
  );
  const linesB = daemonLogLines();
  check('腿 B：daemon.log 自仓路径 clone（Cloning 行含路径）', linesB.some((l) => l.includes('Cloning') && l.includes(repoDir)));
  check('腿 B：Worktree added 行落日志', linesB.some((l) => l.includes('Worktree added')));
  const baseDir = join(DAEMON_HOME, 'workspaces', projectId, 'repo');
  const convDir = join(DAEMON_HOME, 'workspaces', buildBId);
  check('腿 B：基座 clone 在位', existsSync(join(baseDir, '.git')) || existsSync(join(baseDir, 'HEAD')), baseDir);
  const readme = existsSync(join(convDir, 'README.md')) ? readFileSync(join(convDir, 'README.md'), 'utf8') : null;
  check('腿 B：conv worktree 检出 README 内容对', readme === '# 1210 local repo\n', `readme=${JSON.stringify(readme)}`);
  save('leg-b-workspace-state.json', {
    baseDir,
    convDir,
    convHead: git(['rev-parse', '--verify', 'HEAD'], convDir).out,
    origin: git(['remote', 'get-url', 'origin'], baseDir).out,
  });

  const rowB = await waitBuildTerminal(buildBId);
  save('leg-b-build-row.json', rowB);
  check(
    '腿 B：步终态 errorMessage 不含不可达文案（stub 零改动产物闸 failed 属预期）',
    !(rowB?.errorMessage ?? '').includes('无法在机器'),
    `stepStatus=${rowB?.stepStatus} msg=${(rowB?.errorMessage ?? '').slice(0, 120)}`,
  );

  await page.goto(`http://127.0.0.1:${stack.webPort}/app/todo/${todoId}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: join(EVIDENCE, 'leg-b-detail-after.png'), fullPage: true });
} finally {
  if (daemon) daemon.kill('SIGTERM');
  if (browser) await browser.close();
  if (stubHandle) stubHandle.server.close();
  save('paths.txt', `repoDir=${repoDir}\nrepoGone=${repoGone}\nDAEMON_HOME=${DAEMON_HOME}\n`);
}

const passed = checks.filter((c) => c.ok).length;
save('result.json', {
  probe: 'drive-1210-local-unreachable',
  expect: EXPECT,
  repo: REPO,
  server: SERVER,
  db: DB,
  machineName: MACHINE_NAME,
  daemonHome: DAEMON_HOME,
  repoDir,
  passed,
  total: checks.length,
  checks,
});
process.stdout.write(`\n${passed}/${checks.length} checks passed → ${EVIDENCE}\n`);
if (passed !== checks.length) process.exit(1);
