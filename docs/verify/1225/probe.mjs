// #1225 mea live probe: the daemon clone/push credential-degrade full chain
// (ticket acceptance 1/2 + evidence face). Modeled on drive-1213-dual-source.mjs
// (verify-pacman skill): no web, no vite — pure server + daemon + stub LLM +
// HTTP/fs/SQLite ground truth.
//
// Leg 1 (ticket acceptance 1): github_connection set to a bad token → build-step
//   clone/push fail auth one by one → degrade to the executor machine's local
//   git credentials (mea's gh helper) → step success, transcript credential-
//   source line = machine, two degrade lines + a pushed line in daemon.log, and
//   the conv branch exists on origin.
// Leg 2 (ticket acceptance 2): connection swapped to a real token (gh auth
//   token, never echoed) → new build → no degrade lines, source line =
//   integration (behavior unchanged while the integration is healthy).
//
// env: MEA_REPO (repo clone root), EVIDENCE_DIR, PORT (default 8791).
// Credential discipline: token values enter the seed script only through the
// stdin pipe; zero echo in logs/evidence (leg 1's bad token is a probe-invented
// string and may be named; leg 2's real token never lands on any face).

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

// —— stub LLM (925 shape modified): if the request already carries tool results
//    → closing text; otherwise → bash writes a marker file (artifact gate: no
//    commit, no push). Shared by both legs; artifact file names carry the leg number.

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

// —— connection seed (tsx leg): the token enters via stdin, not argv/logs ————————

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

// —— process handles ————————————————————————————————————————————————————

let stubHandle = null;
let serverProc = null;
let daemonProc = null;
let TEAM_ID = null;

function spawnServer() {
  const env = { ...process.env, PORT: String(PORT), PACMAN_HOME: SERVER_HOME };
  const out = join(EVIDENCE, 'server-console.log');
  writeFileSync(out, '');
  // detached = new process group: the closing kill(-pid) takes the whole tree
  // (pnpm wrapper → tsx → esbuild service). Killing only the wrapper orphans
  // the tsx child — holding the port and the DB at a deleted inode, so the next
  // probe round's readiness probe hits the old stack (#950's same false green,
  // hit in two local runs).
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
  // Deliberately do not strip the proxy env (ticket failure mode 4: mea's
  // HTTP_PROXY/NO_PROXY semantics pass through to git as-is — github.com goes
  // through 127.0.0.1:7890, the server connects directly at 127.0.0.1).
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

/** Sweep leftovers from the previous round: kill server/daemon process trees hung on this repo clone + wait for the port to release.
 *  (This probe's own cmdline does not contain the repo path, so the pkill pattern cannot hit itself.) */
function sweepLeftovers() {
  run('bash', ['-c', "pkill -f 'pacman-1225-repo/apps/(server|daemon)' || true"], { timeout: 10_000 });
  run('bash', ['-c', `sleep 1; ss -tln | grep ':${PORT} ' && exit 1 || exit 0`], { timeout: 15_000 });
}

const pushedBranches = [];

// —— main ——————————————————————————————————————————————————————————————

try {
  // -1) sweep leftovers from the previous round + port-occupied precheck (an
  //     old stack holding the port = the readiness probe hits the old library's
  //     false green, hit twice in local runs; stop rather than compound the error).
  sweepLeftovers();
  const portBusy = run('bash', ['-c', `ss -tln | grep -q ':${PORT} '`], { timeout: 10_000 });
  if (portBusy.code === 0) throw new Error(`port ${PORT} still occupied after sweep`);
  check('端口预检', true, `port ${PORT} free`);

  // 0) precheck: mea's machine-credential path is in place (gh helper fill
  //    yields username; note fill echoes four lines protocol/host/username/
  //    password — password is only checked for existence, never persisted).
  const fill = run('bash', ['-c', "printf 'protocol=https\\nhost=github.com\\n\\n' | git credential fill | grep -c '^username='"], { timeout: 15_000 });
  check('mea 机器凭据在位（git credential fill → username）', fill.code === 0 && fill.out.trim() === '1', fill.out.trim() || fill.err);

  // 1) stub LLM + server.
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

  // 2) seed: team / provider / agent / api-key.
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

  // 3) project + bad connection (leg 1 prerequisite).
  const projRes = await jfetch('POST', '/api/projects', {
    body: { name: `probe-1225-${TS}`, teamId: TEAM_ID, kind: 'github', githubRepo: GH_REPO },
  });
  const projectId = projRes.body?.id;
  check('github 项目创建（repo=xiechimon/pacman）', projRes.status === 201 && Boolean(projectId), `${projRes.status}`);

  // —— Pre-materialize the base (probe side, independent of the credential
  //    sequence): the pacman repo is 447MB and a full daemon clone through the
  //    mea proxy measured ~2min, which overshoots the server step's 120s
  //    heartbeat window for sweeping lost steps (step released and re-claimed →
  //    two runSteps race on one workspace → probe false red). Clone the base
  //    into the daemon workspaces ahead of time so daemon prepare takes the
  //    fetch face (seconds) — the heartbeat window is no longer exposed.
  //    clone/fetch prefer anonymous (public repo triggers no credential
  //    challenge); the live evidence of the degrade path = push (the auth-
  //    challenge face), same shape as the ticket phenomenon (push dead, clone
  //    alive); the clone half of the degrade order is pinned by the
  //    workspace-cred-fallback unit test.
  const baseDir = join(DAEMON_HOME, 'workspaces', projectId, 'repo');
  run('mkdir', ['-p', join(DAEMON_HOME, 'workspaces', projectId)]);
  const preseed = run('git', ['clone', GH_CLONE_URL, baseDir], { timeout: 300_000 });
  check('基座预物化（daemon workspaces 落位）', preseed.code === 0, (preseed.err || preseed.out).split('\n').slice(-1)[0]);

  seedConnection(BAD_TOKEN, 'probe-1225-bad');
  const connStatus = await jfetch('GET', `/api/teams/${TEAM_ID}/github/connection`);
  check('github_connection 置坏 token（login=probe-1225-bad）', connStatus.body?.login === 'probe-1225-bad', JSON.stringify(connStatus.body).slice(0, 120));
  save('connection-status-leg1.json', connStatus.body);

  // 4) leg 1: daemon (natural env, proxy passed through) + build.
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
  // Public-repo clone/fetch prefer anonymous (git presents credentials only
  // after a 401 challenge) — the live evidence of the degrade path = push (the
  // only auth-challenge face, same shape as the ticket phenomenon); the clone
  // half is pinned by the unit test.
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

  // 5) leg 2: real-token connection → new build → integration path.
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
  // Leg 2 must add no degrade lines: the degrade-line count stays flat versus
  // leg 1's close-out (leg 1's line count was snapshotted above as lines1 —
  // compare by whole-text count of "machine credentials").
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

  // Zero echo of credential values (leg 2 real-token shape).
  const allLog = `${lines2.join('\n')}\n${serverLogLines().join('\n')}`;
  check('腿 2：daemon/server 日志不含真 token（gho_/github_pat_ 零命中）', !/gho_[A-Za-z0-9]{20,}/.test(allLog) && !/github_pat_[A-Za-z0-9_]{20,}/.test(allLog));
} finally {
  await stopProcesses();
  // Port-release assertion: old-stack residue is this probe's number-one false-green source (hitting the old library at a deleted inode).
  const released = run('bash', ['-c', `ss -tln | grep -q ':${PORT} '`], { timeout: 10_000 });
  check('收尾端口释放（无旧栈残留）', released.code !== 0, `port ${PORT} ${released.code === 0 ? 'STILL BUSY' : 'released'}`);
  // Remote branch cleanup (probe artifacts, left off the repo).
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
