// verify-cairn 定制 probe（#1213 / ADR 0017 双执行源）：github 形态项目加挂
// localPath 同机加速位的活栈全链取证。纯 HTTP + fs + SQLite + daemon.log +
// 浏览器设置页真用户路径；自 spawn stub LLM + 双 daemon（A=本机加速位可见机、
// B=localPath 失格机）并自回收。
//
// 票面验收 seam 对照：
//   server 松绑   POST github 项目 + PATCH localPath（形态校验、显式 null 清空）
//                 + SQLite 行双真值。
//   daemon 选源A  localPath 存在且同仓（真 GitHub 仓 octocat/Hello-World 的
//                 本地克隆，主引用故意落到旧提交）→ 基座走本地源，origin 重指
//                 https 真值 URL，fetch 后 worktree HEAD = 远端 tip（新鲜度
//                 不松）。
//   daemon 选源B  localPath 改成不存在路径 → 第二台 daemon 基座缺位 → 静默
//                 回落 GitHub clone + 一行选源日志（含回落原因）。
//   web 最小面    设置页 github 形态显示「本机加速路径」字段，真用户路径改值
//                 落 PATCH + 截图双态。
//
// 用法（配方 = docs/verify/1213/README.md）：
//   先 launch.mjs 起栈，再 node drive-1213-dual-source.mjs
// env：SERVER（缺省读 VERIFY_RUN_DIR/ports.json）、VERIFY_RUN_DIR、
//      VERIFY_EVIDENCE_DIR。
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const SCRIPT_REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const REPO = process.env.VERIFY_REPO_ROOT ?? SCRIPT_REPO;
const RUN_DIR = process.env.VERIFY_RUN_DIR ?? join(REPO, '.claude', 'verify-run');
const stack = JSON.parse(readFileSync(join(RUN_DIR, 'ports.json'), 'utf8'));
const SERVER = process.env.SERVER ?? `http://127.0.0.1:${stack.serverPort}`;
const DB = join(stack.homeDir, 'server', 'server.db');

// 唯一可写机器名（双 daemon 各持各的 api-key，#895 gotcha）。
const DAEMON_HOME_A = `/tmp/cairn-1213-daemon-a-${Date.now()}`;
const DAEMON_HOME_B = `/tmp/cairn-1213-daemon-b-${Date.now()}`;

// 真值远端：公共小仓 octocat/Hello-World（匿名 clone/fetch 可达；本地源 = 该
// 仓的真克隆，origin 归一化后与项目 cloneUrl 同仓——双条件判定的正向腿）。
const GH_REPO = 'octocat/Hello-World';
const GH_CLONE_URL = `https://github.com/${GH_REPO}.git`;

const BAD_PATH = `/definitely/not/here-1213-${Date.now()}`;

const ts = new Date().toISOString().replace(/[:.]/g, '-');
const EVIDENCE =
  process.env.VERIFY_EVIDENCE_DIR ?? join(SCRIPT_REPO, `.claude/verify-evidence/${ts}-1213-dual-source`);
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

// —— stub LLM（drive-925 最小移植）：纯文本应答——build 步按「零改动」产物闸
//    failed 收尾属预期（材料化 seam 在会话之前，验收面 = 选源日志 + git 实物）。

function startStubLlm() {
  const requests = [];
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
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r({ server, requests, port: server.address().port })));
}

function git(args, cwd) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  return { code: r.status, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() };
}

// —— 本地加速位种子：真 GitHub 仓的本地克隆 + 主引用故意回退到旧提交
//    （新鲜度判定的活证据：本地源落后时，fetch 后 worktree 仍须在远端 tip）。

function seedLocalSource() {
  const dir = join(mkdtempSync(join(tmpdir(), 'cairn-1213-local-')), 'Hello-World');
  const clone = git(['clone', GH_CLONE_URL, dir], undefined);
  if (clone.code !== 0) throw new Error(`clone seed failed: ${clone.err}`);
  const branch = git(['symbolic-ref', '--short', 'HEAD'], dir).out; // master
  const history = git(['rev-list', '--max-count=5', branch], dir).out.split('\n').filter(Boolean);
  const stale = history[history.length - 1];
  const tip = history[0];
  const back = git(['update-ref', `refs/heads/${branch}`, stale], dir);
  if (back.code !== 0) throw new Error(`stale ref failed: ${back.err}`);
  return { dir, branch, tip, stale };
}

// —— daemon spawn（drive-925 同形：--server 显式进命令行 = cleanup 钉选面）——

function spawnDaemon(apiKey, teamId, name, daemonHome) {
  const env = { ...process.env };
  for (const k of ['http_proxy', 'https_proxy', 'all_proxy', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY']) delete env[k];
  env.NO_PROXY = '*';
  env.CAIRN_HOME = daemonHome;
  const out = join(EVIDENCE, `daemon-console-${name}.log`);
  writeFileSync(out, '');
  const child = spawn(
    'pnpm',
    ['exec', 'tsx', 'src/cli.ts', 'start', '--foreground', '--server', SERVER, '--api-key', apiKey, '--team', teamId, '--name', name],
    { cwd: join(REPO, 'apps/daemon'), env, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  child.stdout.on('data', (d) => appendFileSync(out, d));
  child.stderr.on('data', (d) => appendFileSync(out, d));
  return child;
}

function daemonLogLines(daemonHome) {
  const p = join(daemonHome, 'daemon.log');
  if (!existsSync(p)) return [];
  return readFileSync(p, 'utf8').split('\n').filter(Boolean);
}

function openDb() {
  const require2 = createRequire(join(REPO, 'apps/server/package.json'));
  const Database = require2('better-sqlite3');
  return new Database(DB, { readonly: true });
}

async function waitStepTerminal(buildId, timeoutMs = 150_000) {
  const db = openDb();
  const started = Date.now();
  try {
    for (;;) {
      const rows = db.prepare('SELECT id, kind, status FROM step WHERE buildId = ? ORDER BY createdAt').all(buildId);
      const terminal = rows.filter((r) => ['done', 'failed', 'stopped'].includes(r.status));
      if (terminal.length > 0) return { rows, terminal: terminal[terminal.length - 1] };
      if (Date.now() - started > timeoutMs) return { rows, terminal: null };
      await new Promise((r) => setTimeout(r, 1000));
    }
  } finally {
    db.close();
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

/** 基座/conv worktree 的 git 实物（选源与新鲜度的判据面）。 */
function repoState(daemonHome, projectId, conversationId) {
  const base = join(daemonHome, 'workspaces', projectId, 'repo');
  const conv = join(daemonHome, 'workspaces', conversationId);
  const origin = git(['remote', 'get-url', 'origin'], base).out;
  const originDefault = git(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], base).out;
  const remoteTip = git(['rev-parse', '--verify', 'refs/remotes/origin/HEAD'], base).out;
  const convHead = existsSync(join(conv, '.git')) ? git(['rev-parse', '--verify', 'HEAD'], conv).out : null;
  return { base, conv, origin, originDefault, remoteTip, convHead };
}

// —— main —————————————————————————————————————————————————————————————

let stubHandle = null;
let daemonA = null;
let daemonB = null;
let browser = null;
try {
  stubHandle = await startStubLlm();
  const stubUrl = `http://127.0.0.1:${stubHandle.port}/v1`;

  const local = seedLocalSource();

  // seed：team / provider / agent / api-key ×2。
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
      displayName: `probe-1213-builder-${Date.now()}`,
      description: '你是 1213 探针执行 Agent。',
      provider: 'stub-gw',
      modelId: 'stub-model',
    },
  });
  const agentId = agentRes.body?.id ?? agentRes.body?.agent?.id;
  if (!agentId) throw new Error(`agent create failed: ${agentRes.status}`);
  const keys = [];
  for (const slot of ['a', 'b']) {
    const keyRes = await jfetch('POST', `/api/teams/${teamId}/api-keys`, {
      body: { name: `probe-1213-${slot}-${Date.now()}`, gitAccess: false, mcpAccess: false, toolGrants: { read: [], write: [] } },
    });
    const apiKey = keyRes.body?.plaintext ?? keyRes.body?.key;
    if (!apiKey) throw new Error(`api-key ${slot} create failed: ${keyRes.status}`);
    keys.push(apiKey);
  }

  // —— server 松绑面：POST github 项目（不带 localPath）→ PATCH 挂加速位。

  const projRes = await jfetch('POST', '/api/projects', {
    body: { name: `probe-1213-${Date.now()}`, teamId, kind: 'github', githubRepo: GH_REPO },
  });
  const projectId = projRes.body?.id;
  check('POST github 项目 201（kind=github 无 localPath）', projRes.status === 201 && Boolean(projectId), `${projRes.status}`);
  const patchRes = await jfetch('PATCH', `/api/projects/${projectId}`, { body: { localPath: local.dir } });
  check(
    'PATCH 挂 localPath 200 + record 回显（松绑面：server 只验形态不验存在）',
    patchRes.status === 200 && patchRes.body?.localPath === local.dir,
    `${patchRes.status} localPath=${patchRes.body?.localPath}`,
  );
  save('patch-localpath.json', { status: patchRes.status, body: patchRes.body });
  let db = openDb();
  let dbRow = null;
  try {
    dbRow = db.prepare('SELECT repoKind, githubRepo, localPath FROM project WHERE id = ?').get(projectId);
  } finally {
    db.close();
  }
  check('SQLite project 行 localPath 落库（githubRepo 与加速位并存）', dbRow?.localPath === local.dir && dbRow?.githubRepo === GH_REPO, JSON.stringify(dbRow));
  save('sqlite-project-row-localpath.json', dbRow);

  // —— web 最小面：设置页 github 形态显示「本机加速路径」，真用户路径改值。

  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 732 } });
  await page.goto(`http://127.0.0.1:${stack.webPort}/app/project/${projectId}/settings`);
  const field = page.getByRole('textbox', { name: '本机加速路径' });
  await field.waitFor({ state: 'visible', timeout: 15_000 });
  const shownBefore = await field.inputValue();
  await page.screenshot({ path: join(EVIDENCE, 'settings-field-before.png') });
  check('设置页显示本机加速路径字段且值为 server 真值', shownBefore === local.dir, `shown=${shownBefore}`);
  await field.fill(BAD_PATH);
  await page.getByRole('button', { name: '保存' }).click();
  await waitFor(async () => (await field.inputValue()) === BAD_PATH, 10_000, 'field value after save');
  await page.screenshot({ path: join(EVIDENCE, 'settings-field-after.png') });
  const afterRec = await jfetch('GET', `/api/projects?teamId=${teamId}`);
  const afterRow = (afterRec.body ?? []).find((p) => p.id === projectId);
  check('设置页改值落 PATCH：record.localPath = 新路径', afterRow?.localPath === BAD_PATH, `localPath=${afterRow?.localPath}`);
  save('project-record-after-ui.json', afterRow);

  // 回到有效加速位再走腿 A（改值面已验，选源面用同仓路径）。
  const patchBack = await jfetch('PATCH', `/api/projects/${projectId}`, { body: { localPath: local.dir } });
  check('PATCH 恢复有效加速位（腿 A 前置）', patchBack.status === 200 && patchBack.body?.localPath === local.dir, `${patchBack.status}`);

  // —— daemon A（本机加速位可见）：build 1 → 本地源 + fetch 后 HEAD = 远端 tip。

  const todoRes = await jfetch('POST', `/api/projects/${projectId}/todos`, {
    body: { title: '双执行源探针', spec: '探针任务：无需改动。' },
  });
  const todoId = todoRes.body?.id;

  daemonA = spawnDaemon(keys[0], teamId, 'verify-1213-a', DAEMON_HOME_A);
  await waitFor(() => daemonLogLines(DAEMON_HOME_A).some((l) => l.includes('[wake] push channel connected')), 60_000, 'daemon A online');

  const build1 = await jfetch('POST', `/api/projects/${projectId}/builds`, {
    body: { todoIds: [todoId], assignment: { plan: { agentId }, build: { agentId } }, withPlan: false },
  });
  const build1Id = build1.body?.builds?.[0]?.id;
  if (!build1Id) throw new Error(`build 1 failed: ${build1.status} ${JSON.stringify(build1.body).slice(0, 200)}`);

  await waitFor(
    () => daemonLogLines(DAEMON_HOME_A).some((l) => l.includes('Repo source:')),
    120_000,
    'daemon A repo source line',
  );
  const linesA = daemonLogLines(DAEMON_HOME_A);
  save('daemon-a-source-log.txt', linesA.filter((l) => l.includes('Repo source:') || l.includes('Cloning') || l.includes('Worktree added')).join('\n'));
  check(
    'daemon A 日志：走本地源（Repo source: local-path）',
    linesA.some((l) => l.includes(`Repo source: local-path ${local.dir}`)),
    (linesA.find((l) => l.includes('Repo source:')) ?? '<missing>').slice(0, 220),
  );
  const t1 = await waitStepTerminal(build1Id);
  check('build 1 步入终态（材料化已完成；stub 零改动 failed 属预期）', t1.terminal !== null, JSON.stringify(t1.terminal));

  const stateA = repoState(DAEMON_HOME_A, projectId, build1Id);
  save('daemon-a-repo-state.json', stateA);
  check('daemon A 基座 origin 重指 GitHub 真值 URL', stateA.origin === GH_CLONE_URL, `origin=${stateA.origin}`);
  check(
    '新鲜度不松：本地源落后一提交，fetch 后 origin tip 与 worktree HEAD = 真值远端 tip（非本地旧 sha）',
    stateA.remoteTip === local.tip && stateA.convHead === local.tip && stateA.convHead !== local.stale,
    `convHead=${stateA.convHead} remoteTip=${stateA.remoteTip} tip=${local.tip} stale=${local.stale}`,
  );

  // —— localPath 改成不存在路径（票面动作）→ daemon B（基座缺位）回落 GitHub。

  const patchBad = await jfetch('PATCH', `/api/projects/${projectId}`, { body: { localPath: BAD_PATH } });
  check('PATCH localPath → 不存在路径（回落腿前置）', patchBad.status === 200 && patchBad.body?.localPath === BAD_PATH, `${patchBad.status}`);
  db = openDb();
  try {
    dbRow = db.prepare('SELECT localPath FROM project WHERE id = ?').get(projectId);
  } finally {
    db.close();
  }
  save('sqlite-project-row-badpath.json', dbRow);

  // 杀 A 后等过僵尸 claim 窗（≤75s，#1025 gotcha）再派 build 2——B 独占认领。
  daemonA.kill('SIGTERM');
  daemonA = null;
  await new Promise((r) => setTimeout(r, 80_000));

  daemonB = spawnDaemon(keys[1], teamId, 'verify-1213-b', DAEMON_HOME_B);
  await waitFor(() => daemonLogLines(DAEMON_HOME_B).some((l) => l.includes('[wake] push channel connected')), 60_000, 'daemon B online');

  const build2 = await jfetch('POST', `/api/projects/${projectId}/builds`, {
    body: { todoIds: [todoId], assignment: { plan: { agentId }, build: { agentId } }, withPlan: false },
  });
  const build2Id = build2.body?.builds?.[0]?.id;
  if (!build2Id) throw new Error(`build 2 failed: ${build2.status} ${JSON.stringify(build2.body).slice(0, 200)}`);

  await waitFor(
    () => daemonLogLines(DAEMON_HOME_B).some((l) => l.includes('Repo source:')),
    120_000,
    'daemon B repo source line',
  );
  const linesB = daemonLogLines(DAEMON_HOME_B);
  save('daemon-b-source-log.txt', linesB.filter((l) => l.includes('Repo source:') || l.includes('Cloning') || l.includes('Worktree added')).join('\n'));
  check(
    'daemon B 日志：静默回落 GitHub（Repo source: github-clone + 原因）',
    linesB.some((l) => l.includes('Repo source: github-clone') && l.includes(BAD_PATH) && l.includes('not found')),
    (linesB.find((l) => l.includes('Repo source:')) ?? '<missing>').slice(0, 220),
  );
  const t2 = await waitStepTerminal(build2Id);
  check('build 2 步入终态（回落 clone 后照常开工，不报错不卡步）', t2.terminal !== null, JSON.stringify(t2.terminal));

  const stateB = repoState(DAEMON_HOME_B, projectId, build2Id);
  save('daemon-b-repo-state.json', stateB);
  check('daemon B 基座 = 真 GitHub clone（origin 直指真值 URL）', stateB.origin === GH_CLONE_URL, `origin=${stateB.origin}`);
  check('daemon B worktree HEAD = 真值远端 tip', stateB.convHead === local.tip && stateB.remoteTip === local.tip, `convHead=${stateB.convHead} remoteTip=${stateB.remoteTip} tip=${local.tip}`);
} finally {
  if (daemonB) daemonB.kill('SIGTERM');
  if (daemonA) daemonA.kill('SIGTERM');
  if (browser) await browser.close();
  if (stubHandle) stubHandle.server.close();
  save('daemon-homes.txt', `A=${DAEMON_HOME_A}\nB=${DAEMON_HOME_B}\n`);
}

const passed = checks.filter((c) => c.ok).length;
save('result.json', {
  probe: 'drive-1213-dual-source',
  server: SERVER,
  db: DB,
  ghRepo: GH_REPO,
  localSourceSeed: `${GH_CLONE_URL} cloned, master ref rewound to a stale commit`,
  daemonHomes: { a: DAEMON_HOME_A, b: DAEMON_HOME_B },
  passed,
  total: checks.length,
  checks,
});
process.stdout.write(`\n${passed}/${checks.length} checks passed → ${EVIDENCE}\n`);
if (passed !== checks.length) process.exit(1);
