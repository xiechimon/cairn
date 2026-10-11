// #1225 mea 实测 probe：daemon clone/push 凭据降级全链（票验收 1/2 + 证据面）。
// 形状照 drive-1213-dual-source.mjs（verify-pacman 技能）改：不起 web、不起
// vite——纯 server + daemon + stub LLM + HTTP/fs/SQLite 三真值。
//
// 腿 1（票验收 1）：github_connection 置坏 token → build 步 clone/push 逐个
//   auth 失败 → 降级执行机本机 git 凭据（mea 的 gh helper）→ 步 success、
//   transcript 凭据来源行 = machine、daemon.log 两段降级行 + pushed 行、
//   origin 上 conv 分支真值存在。
// 腿 2（票验收 2）：connection 换真 token（gh auth token，不回显）→ 新 build
//   → 无降级行、来源行 = integration（集成有效时行为不变）。
//
// env：MEA_REPO（仓克隆根）、EVIDENCE_DIR、PORT（缺省 8791）。
// 凭据纪律：token 值只经 stdin 管道进 seed 脚本；日志/证据零回显（腿 1 的
// 坏 token 是探针自造串，可点名；腿 2 真 token 永不落任何面）。

import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO = process.env.MEA_REPO ?? '/tmp/pacman-1225-repo';
const EVIDENCE = process.env.EVIDENCE_DIR ?? '/tmp/pacman-1225-evidence';
const PORT = Number(process.env.PORT ?? 8791);
const SERVER = `http://127.0.0.1:${PORT}`;
const PNPM = '/home/measure/.cache/node/corepack/pnpm/12.5.1/bin/pnpm.mjs';
const GH_REPO = 'xiechimon/pacman';
const GH_CLONE_URL = `https://github.com/${GH_REPO}.git`;
const BAD_TOKEN = 'ghp_1225_deliberately_invalid_token';
const TS = Date.now();
const SERVER_HOME = `/tmp/pacman-1225-server-home-${TS}`;
const DAEMON_HOME = `/tmp/pacman-1225-daemon-home-${TS}`;

mkdirSync(EVIDENCE, { recursive: true });

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
function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', ...opts });
  return { code: r.status, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() };
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

function daemonLogLines() {
  const p = join(DAEMON_HOME, 'daemon.log');
  if (!existsSync(p)) return [];
  return readFileSync(p, 'utf8').split('\n').filter(Boolean);
}
function serverLogLines() {
  const p = join(EVIDENCE, 'server-console.log');
  if (!existsSync(p)) return [];
  return readFileSync(p, 'utf8').split('\n').filter(Boolean);
}

function openDb() {
  const require2 = createRequire(join(REPO, 'apps/server/package.json'));
  const Database = require2('better-sqlite3');
  return new Database(join(SERVER_HOME, 'server', 'server.db'), { readonly: true });
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

async function waitStepTerminal(buildId, timeoutMs = 240_000) {
  const db = openDb();
  const started = Date.now();
  try {
    for (;;) {
      const rows = db
        .prepare('SELECT id, kind, status FROM step WHERE buildId = ? ORDER BY createdAt')
        .all(buildId);
      const terminal = rows.filter((r) => ['done', 'failed', 'stopped'].includes(r.status));
      if (terminal.length > 0) return { rows, terminal: terminal[terminal.length - 1] };
      if (Date.now() - started > timeoutMs) return { rows, terminal: null };
      await new Promise((r) => setTimeout(r, 2000));
    }
  } finally {
    db.close();
  }
}

// —— stub LLM（925 形改）：请求里已带 tool 结果 → 收尾文本；否则 → bash 写
//    marker 文件（产物闸：有提交才有 push）。两腿共用，产物文件名带腿号。

let stubLeg = 1;
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
      let parsed = null;
      try {
        parsed = JSON.parse(body);
      } catch {
        /* keep null */
      }
      requests.push({ at: Date.now(), lastRole: parsed?.messages?.at(-1)?.role ?? null });
      const base = {
        id: 'chatcmpl-stub',
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: 'stub-model',
      };
      const chunk = (payload) => `data: ${JSON.stringify(payload)}\n\n`;
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      res.write(
        chunk({ ...base, choices: [{ index: 0, delta: { role: 'assistant', content: '' } }] }),
      );
      const sawToolResult = (parsed?.messages ?? []).some((m) => m.role === 'tool');
      if (sawToolResult) {
        res.write(
          chunk({
            ...base,
            choices: [{ index: 0, delta: { content: '探针改动已完成。' } }],
          }),
        );
        res.write(chunk({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }));
      } else {
        const file = `probe-1225-leg${stubLeg}.txt`;
        const command = `printf 'leg %d marker\\n' ${stubLeg} > ${file}`;
        const callId = `call-stub-${Date.now()}`;
        res.write(
          chunk({
            ...base,
            choices: [
              {
                index: 0,
                delta: {
                  tool_calls: [
                    { index: 0, id: callId, type: 'function', function: { name: 'bash', arguments: '' } },
                  ],
                },
              },
            ],
          }),
        );
        res.write(
          chunk({
            ...base,
            choices: [
              {
                index: 0,
                delta: {
                  tool_calls: [{ index: 0, function: { arguments: JSON.stringify({ command }) } }],
                },
              },
            ],
          }),
        );
        res.write(chunk({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] }));
      }
      res.write('data: [DONE]\n\n');
      res.end();
    });
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r({ server, requests, port: server.address().port })));
}

// —— connection seed（tsx 腿）：token 经 stdin 进，不进 argv/日志 ——————————

const SEED_SCRIPT = `
import { openDb } from '${join(REPO, 'apps/server/src/db/client.js')}';
import { createKeyfileSecretBox } from '${join(REPO, 'apps/server/src/lib/secret-box.js')}';
import { upsertGithubConnection } from '${join(REPO, 'apps/server/src/services/github-connection.js')}';
const [dbPath, keyPath, teamId, login] = process.argv.slice(2);
let token = '';
for await (const chunk of process.stdin) token += chunk;
token = token.trim();
if (token === '') throw new Error('empty token on stdin');
const db = openDb(dbPath);
const box = createKeyfileSecretBox(keyPath);
upsertGithubConnection({ db, box }, { teamId, login, accessToken: token, scope: 'repo' });
console.log('seeded connection: ' + login);
`;

function seedConnection(token, login) {
  const scriptPath = `/tmp/seed-1225-${Date.now()}.mts`;
  writeFileSync(scriptPath, SEED_SCRIPT);
  try {
    const r = run(
      'node',
      [PNPM, 'exec', 'tsx', scriptPath, join(SERVER_HOME, 'server', 'server.db'), join(SERVER_HOME, 'server', 'secretbox.key'), TEAM_ID, login],
      { cwd: join(REPO, 'apps/server'), input: token, timeout: 60_000 },
    );
    if (r.code !== 0) throw new Error(`seed failed: ${r.err || r.out}`);
  } finally {
    run('rm', ['-f', scriptPath]);
  }
}

function remoteBranchSha(branch) {
  const r = run('git', ['ls-remote', GH_CLONE_URL, `refs/heads/${branch}`], { timeout: 60_000 });
  if (r.code !== 0) return null;
  const line = r.out.split('\n')[0] ?? '';
  return line === '' ? null : line.split('\t')[0];
}

function deleteRemoteBranch(branch) {
  const r = run('gh', ['api', '-X', 'DELETE', `repos/${GH_REPO}/git/refs/heads/${branch}`], { timeout: 60_000 });
  return r.code === 0;
}

// —— 进程句柄 ——————————————————————————————————————————————————————————

let stubHandle = null;
let serverProc = null;
let daemonProc = null;
let TEAM_ID = null;

function spawnServer() {
  const env = { ...process.env, PORT: String(PORT), PACMAN_HOME: SERVER_HOME };
  const out = join(EVIDENCE, 'server-console.log');
  writeFileSync(out, '');
  // detached = 新进程组：收尾 kill(-pid) 砍整棵树（pnpm wrapper → tsx → esbuild
  // 服务）。只杀 wrapper 会孤儿化 tsx 子进程——占着端口与已删 inode 的 DB，
  // 下一轮 probe 的就绪探针打到旧栈（#950 同款假绿，本机实测两轮撞过）。
  serverProc = spawn('node', [PNPM, 'exec', 'tsx', 'src/index.ts'], {
    cwd: join(REPO, 'apps/server'),
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  serverProc.stdout.on('data', (d) => appendFileSync(out, d));
  serverProc.stderr.on('data', (d) => appendFileSync(out, d));
}

function spawnDaemon(apiKey, name) {
  // 故意不剥代理 env（票失败方式 4：mea 的 HTTP_PROXY/NO_PROXY 语义原样
  // 透传给 git——github.com 走 127.0.0.1:7890，server 走 127.0.0.1 直连）。
  const env = { ...process.env, PACMAN_HOME: DAEMON_HOME };
  const out = join(EVIDENCE, `daemon-console-${name}.log`);
  writeFileSync(out, '');
  daemonProc = spawn(
    'node',
    [
      PNPM,
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
      TEAM_ID,
      '--name',
      name,
    ],
    { cwd: join(REPO, 'apps/daemon'), env, stdio: ['ignore', 'pipe', 'pipe'], detached: true },
  );
  daemonProc.stdout.on('data', (d) => appendFileSync(out, d));
  daemonProc.stderr.on('data', (d) => appendFileSync(out, d));
}

function killGroup(proc) {
  if (!proc || proc.exitCode !== null) return;
  try {
    process.kill(-proc.pid, 'SIGTERM');
  } catch {
    try {
      proc.kill('SIGTERM');
    } catch {
      /* already gone */
    }
  }
}

function killGroupForce(proc) {
  if (!proc || proc.exitCode !== null) return;
  try {
    process.kill(-proc.pid, 'SIGKILL');
  } catch {
    try {
      proc.kill('SIGKILL');
    } catch {
      /* already gone */
    }
  }
}

async function stopProcesses() {
  killGroup(daemonProc);
  killGroup(serverProc);
  if (stubHandle) stubHandle.server.close();
  await new Promise((r) => setTimeout(r, 2000));
  killGroupForce(daemonProc);
  killGroupForce(serverProc);
}

/** 上轮残留清扫：杀挂在本仓克隆上的 server/daemon 进程树 + 等端口释放。
 *  （本 probe 自身 cmdline 不含仓路径，pkill 模式不会误伤自己。） */
function sweepLeftovers() {
  run('bash', ['-c', "pkill -f 'pacman-1225-repo/apps/(server|daemon)' || true"], { timeout: 10_000 });
  run('bash', ['-c', `sleep 1; ss -tln | grep ':${PORT} ' && exit 1 || exit 0`], { timeout: 15_000 });
}

const pushedBranches = [];

// —— main ——————————————————————————————————————————————————————————————

try {
  // -1) 上轮残留清扫 + 端口占用预检（旧栈占位 = 就绪探针打到旧库的假绿，
  //     本机实测两轮撞过；宁停不将错就错）。
  sweepLeftovers();
  const portBusy = run('bash', ['-c', `ss -tln | grep -q ':${PORT} '`], { timeout: 10_000 });
  if (portBusy.code === 0) throw new Error(`port ${PORT} still occupied after sweep`);
  check('端口预检', true, `port ${PORT} free`);

  // 0) 前置自检：mea 机器凭据路在位（gh helper fill 出 username；注意 fill
  //    会回显 protocol/host/username/password 四行，password 只判存在不落盘）。
  const fill = run('bash', ['-c', "printf 'protocol=https\\nhost=github.com\\n\\n' | git credential fill | grep -c '^username='"], { timeout: 15_000 });
  check('mea 机器凭据在位（git credential fill → username）', fill.code === 0 && fill.out.trim() === '1', fill.out.trim() || fill.err);

  // 1) stub LLM + server。
  stubHandle = await startStubLlm();
  const stubUrl = `http://127.0.0.1:${stubHandle.port}/v1`;
  spawnServer();
  await waitFor(
    async () => {
      try {
        const r = await jfetch('GET', '/api/auth/session');
        return r.status === 200;
      } catch {
        return false;
      }
    },
    60_000,
    'server online',
  );
  check('server 起在隔离 PACMAN_HOME', true, `${SERVER} home=${SERVER_HOME}`);

  // 2) seed：team / provider / agent / api-key。
  const teams = await jfetch('GET', '/api/teams');
  TEAM_ID = teams.body[0]?.id ?? teams.body.teams?.[0]?.id;
  if (!TEAM_ID) throw new Error(`no team: ${JSON.stringify(teams.body).slice(0, 200)}`);
  const providerBody = {
    providerId: 'stub-gw',
    label: 'stub-gw',
    baseUrl: stubUrl,
    api: 'openai-completions',
    authHeader: true,
    compat: { supportsDeveloperRole: false },
    models: [{ id: 'stub-model', name: 'stub-model' }],
  };
  let provRes = await jfetch('POST', `/api/teams/${TEAM_ID}/providers`, { body: providerBody });
  if (provRes.status >= 400) {
    const listRes = await jfetch('GET', `/api/teams/${TEAM_ID}/providers`);
    const existing = (listRes.body?.providers ?? []).find((p) => p.providerId === 'stub-gw');
    if (!existing) throw new Error(`provider seed failed: POST ${provRes.status}`);
    provRes = await jfetch('PATCH', `/api/teams/${TEAM_ID}/providers/${existing.id}`, {
      body: { baseUrl: stubUrl, models: providerBody.models },
    });
    if (provRes.status >= 400) throw new Error(`provider seed failed PATCH ${provRes.status}`);
  }
  const agentRes = await jfetch('POST', `/api/teams/${TEAM_ID}/agents`, {
    body: {
      displayName: `probe-1225-builder-${TS}`,
      description: '你是 1225 探针执行 Agent：按任务要求用 bash 工具完成文件改动，然后简短汇报。',
      provider: 'stub-gw',
      modelId: 'stub-model',
    },
  });
  const agentId = agentRes.body?.id ?? agentRes.body?.agent?.id;
  if (!agentId) throw new Error(`agent create failed: ${agentRes.status}`);

  // 3) 项目 + 坏 connection（腿 1 前置）。
  const projRes = await jfetch('POST', '/api/projects', {
    body: { name: `probe-1225-${TS}`, teamId: TEAM_ID, kind: 'github', githubRepo: GH_REPO },
  });
  const projectId = projRes.body?.id;
  check('github 项目创建（repo=xiechimon/pacman）', projRes.status === 201 && Boolean(projectId), `${projRes.status}`);

  // —— 基座预物化（探针侧，与凭据序无关）：pacman 仓 447MB，daemon 全量
  //    clone 走 mea 代理实测 ~2min，会越过 server 步失联扫尾的 120s 心跳窗
  //    （步被释放重领 → 双 runStep 抢同一工作区 → 探针假红）。预先把基座
  //    clone 到 daemon workspaces 落位，daemon prepare 即走 fetch 面（秒级）
  //    ——心跳窗不再暴露。clone/fetch 匿名优先（公共仓不触发凭据挑战），
  //    降级路的活证据 = push（认证挑战面），与票面现象（push 死、clone 活）
  //    同形；clone 半的降级序由 workspace-cred-fallback 单测钉。
  const baseDir = join(DAEMON_HOME, 'workspaces', projectId, 'repo');
  run('mkdir', ['-p', join(DAEMON_HOME, 'workspaces', projectId)]);
  const preseed = run('git', ['clone', GH_CLONE_URL, baseDir], { timeout: 300_000 });
  check('基座预物化（daemon workspaces 落位）', preseed.code === 0, (preseed.err || preseed.out).split('\n').slice(-1)[0]);

  seedConnection(BAD_TOKEN, 'probe-1225-bad');
  const connStatus = await jfetch('GET', `/api/teams/${TEAM_ID}/github/connection`);
  check('github_connection 置坏 token（login=probe-1225-bad）', connStatus.body?.login === 'probe-1225-bad', JSON.stringify(connStatus.body).slice(0, 120));
  save('connection-status-leg1.json', connStatus.body);

  // 4) 腿 1：daemon（自然 env，代理透传）+ build。
  const keyRes = await jfetch('POST', `/api/teams/${TEAM_ID}/api-keys`, {
    body: { name: `probe-1225-${TS}`, gitAccess: false, mcpAccess: false, toolGrants: { read: [], write: [] } },
  });
  const apiKey = keyRes.body?.plaintext ?? keyRes.body?.key;
  if (!apiKey) throw new Error(`api-key create failed: ${keyRes.status}`);

  const todoRes = await jfetch('POST', `/api/projects/${projectId}/todos`, {
    body: { title: '凭据降级探针', spec: '在仓库根写一个 probe-1225-leg1.txt 文件，内容一行。' },
  });
  const todoId = todoRes.body?.id;

  spawnDaemon(apiKey, 'verify-1225');
  await waitFor(() => daemonLogLines().some((l) => l.includes('[wake] push channel connected')), 240_000, 'daemon online');

  const build1 = await jfetch('POST', `/api/projects/${projectId}/builds`, {
    body: { todoIds: [todoId], assignment: { plan: { agentId }, build: { agentId } }, withPlan: false },
  });
  const build1Id = build1.body?.builds?.[0]?.id;
  if (!build1Id) throw new Error(`build 1 failed: ${build1.status} ${JSON.stringify(build1.body).slice(0, 200)}`);

  const t1 = await waitStepTerminal(build1Id);
  const step1Id = t1.rows.find((r) => r.kind === 'build')?.id ?? t1.rows[0]?.id;
  save('leg1-steps.json', t1.rows);
  check('腿 1：步 success（坏 token 下 clone+push 全链走通）', t1.terminal?.status === 'done', JSON.stringify(t1.terminal));

  const lines1 = daemonLogLines();
  save('leg1-daemon-relevant.log', lines1.filter((l) => /machine credentials|pushed|auth failed|Cloning|Repo source|step /.test(l)).join('\n'));
  // 公共仓 clone/fetch 匿名优先（git 仅在 401 挑战后上凭据）——降级路的活
  // 证据 = push（唯一认证挑战面，票面现象同形）；clone 半归单测钉。
  const pushFallback = lines1.find((l) => l.includes('push auth failed (per-step token)'));
  check('腿 1：daemon.log push 降级行（per-step token → machine credentials）', Boolean(pushFallback), (pushFallback ?? '<missing>').slice(0, 260));
  const pushedLine = lines1.find((l) => l.includes(`pushed pacman/conv-${build1Id}`));
  check('腿 1：pushed 行在（conv 分支已推）', Boolean(pushedLine), (pushedLine ?? '<missing>'));

  const branch1 = `pacman/conv-${build1Id}`;
  pushedBranches.push(branch1);
  const remoteSha1 = remoteBranchSha(branch1);
  const db1 = openDb();
  let credRow1 = null;
  try {
    credRow1 = db1.prepare('SELECT id, role, content FROM message WHERE id = ?').get(`git-credential-${step1Id}`);
  } finally {
    db1.close();
  }
  save('leg1-credential-row.json', credRow1);
  check('腿 1：transcript 凭据来源行 = machine（build 记录面）', String(credRow1?.content ?? '').includes('machine'), String(JSON.stringify(credRow1 ?? null)).slice(0, 200));
  check('腿 1：origin 上 conv 分支真值存在', remoteSha1 !== null && /^[0-9a-f]{40}$/.test(remoteSha1 ?? ''), `sha=${remoteSha1}`);
  check('腿 1：daemon.log 不含坏 token 值（凭据值零回显）', !lines1.join('\n').includes(BAD_TOKEN));

  // 5) 腿 2：真 token connection → 新 build → integration 路。
  stubLeg = 2;
  const ghToken = run('gh', ['auth', 'token'], { timeout: 15_000 });
  if (ghToken.code !== 0 || ghToken.out === '') throw new Error('gh auth token failed');
  seedConnection(ghToken.out, 'xiechimon');
  const connStatus2 = await jfetch('GET', `/api/teams/${TEAM_ID}/github/connection`);
  check('github_connection 换真 token（login=xiechimon）', connStatus2.body?.login === 'xiechimon', JSON.stringify(connStatus2.body).slice(0, 120));
  save('connection-status-leg2.json', connStatus2.body);

  const todo2Res = await jfetch('POST', `/api/projects/${projectId}/todos`, {
    body: { title: '凭据降级探针腿 2', spec: '在仓库根写一个 probe-1225-leg2.txt 文件，内容一行。' },
  });
  const todo2Id = todo2Res.body?.id;
  const build2 = await jfetch('POST', `/api/projects/${projectId}/builds`, {
    body: { todoIds: [todo2Id], assignment: { plan: { agentId }, build: { agentId } }, withPlan: false },
  });
  const build2Id = build2.body?.builds?.[0]?.id;
  if (!build2Id) throw new Error(`build 2 failed: ${build2.status} ${JSON.stringify(build2.body).slice(0, 200)}`);

  const t2 = await waitStepTerminal(build2Id);
  const step2Id = t2.rows.find((r) => r.kind === 'build')?.id ?? t2.rows[0]?.id;
  save('leg2-steps.json', t2.rows);
  check('腿 2：步 success（真 token 下全链不变）', t2.terminal?.status === 'done', JSON.stringify(t2.terminal));

  const lines2 = daemonLogLines();
  save('leg2-daemon-relevant.log', lines2.filter((l) => /machine credentials|pushed|auth failed|Cloning|Repo source/.test(l)).join('\n'));
  // 腿 2 不得新增降级行：降级行计数与腿 1 收尾时持平（腿 1 的行数在上方
  // lines1 已拍快照——用「machine credentials」全文计数比对）。
  const fallbackCount1 = lines1.filter((l) => l.includes('machine credentials')).length;
  const fallbackCount2 = lines2.filter((l) => l.includes('machine credentials')).length;
  check('腿 2：无新增降级行（集成有效 = 单发即成）', fallbackCount2 === fallbackCount1, `leg1=${fallbackCount1} leg2=${fallbackCount2}`);
  const db2 = openDb();
  let credRow2 = null;
  try {
    credRow2 = db2.prepare('SELECT id, role, content FROM message WHERE id = ?').get(`git-credential-${step2Id}`);
  } finally {
    db2.close();
  }
  save('leg2-credential-row.json', credRow2);
  check('腿 2：transcript 凭据来源行 = integration（行为不变）', String(credRow2?.content ?? '').includes('integration'), String(JSON.stringify(credRow2 ?? null)).slice(0, 200));
  const branch2 = `pacman/conv-${build2Id}`;
  pushedBranches.push(branch2);
  const remoteSha2 = remoteBranchSha(branch2);
  check('腿 2：origin 上 conv 分支真值存在', remoteSha2 !== null && /^[0-9a-f]{40}$/.test(remoteSha2 ?? ''), `sha=${remoteSha2}`);

  // 凭据值零回显（腿 2 真 token 形状）。
  const allLog = `${lines2.join('\n')}\n${serverLogLines().join('\n')}`;
  check('腿 2：daemon/server 日志不含真 token（gho_/github_pat_ 零命中）', !/gho_[A-Za-z0-9]{20,}/.test(allLog) && !/github_pat_[A-Za-z0-9_]{20,}/.test(allLog));
} finally {
  await stopProcesses();
  // 端口释放断言：旧栈残留是本 probe 的头号假绿源（打到已删 inode 的旧库）。
  const released = run('bash', ['-c', `ss -tln | grep -q ':${PORT} '`], { timeout: 10_000 });
  check('收尾端口释放（无旧栈残留）', released.code !== 0, `port ${PORT} ${released.code === 0 ? 'STILL BUSY' : 'released'}`);
  // 远端分支清理（探针产物，不留仓上）。
  const cleanupResults = [];
  for (const b of pushedBranches) cleanupResults.push(`${b}: ${deleteRemoteBranch(b) ? 'deleted' : 'FAILED'}`);
  save('cleanup-remote-branches.txt', `${cleanupResults.join('\n')}\n`);
  save('daemon-homes.txt', `server=${SERVER_HOME}\ndaemon=${DAEMON_HOME}\n`);
  save('result.json', {
    probe: 'mea-1225-cred-fallback',
    server: SERVER,
    ghRepo: GH_REPO,
    passed: checks.filter((c) => c.ok).length,
    total: checks.length,
    checks,
    stubRequests: stubHandle?.requests?.length ?? 0,
    remoteBranchCleanup: cleanupResults,
  });
}

const passed = checks.filter((c) => c.ok).length;
process.stdout.write(`\n${passed}/${checks.length} checks passed → ${EVIDENCE}\n`);
if (passed !== checks.length) process.exit(1);
