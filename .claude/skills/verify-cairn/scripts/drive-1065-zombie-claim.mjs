// drive-1065-zombie-claim.mjs — #1065 僵尸认领最小场景探针。
//
// 票面：daemon 在 claim 长轮询 hold 期间被杀 → 服务端遗留的 waitWake 在 ≤75s
// 窗口内替死机跑第二次 tryClaim，新步落到死机（响应无处投递 → 步卡到 sweep
// 失败收尾）。机理与实栈复现配方 = docs/verify/1025/README.md。
//
// 场景（可断言，非「看着像」）：
//   A（死机）先发 claim 长轮询（waiter Set 插入序在前）→ B（活机）再发 claim
//   → SIGKILL A 的认领进程（连接断 = 请求 signal abort）→ 入队新步（enqueue
//   + wake 同一同步轮）→ wake 按插入序先醒 A 的僵尸 waiter：
//   - 修前：A 的续跑替死机 tryClaim → 步落 A、B 空手 → 红。
//   - 修后：A 的 waiter 已随 abort 摘除（或出口复查拦截）→ B 领到 → 绿。
//   双向断言：死机零认领（step.machineId ≠ A）+ 活机照领（= B，wake 路径）。
//
// 本探针不 spawn 真 daemon、不依赖 LLM——认领归属就是断言面，步不需要被执行。
// 活机的真 daemon 全链（领步→执行→confirm）由 drive-1025 复跑覆盖（见
// docs/verify/1065/README.md 的「复跑配方」）。
//
// env：VERIFY_REPO_ROOT（stack 所在 worktree；缺省 = 本脚本所在仓）、
//      VERIFY_RUN_DIR（缺省 <REPO>/.claude/verify-run，读 ports.json）、
//      VERIFY_EVIDENCE_DIR（缺省 <REPO>/.claude/verify-evidence/<ts>-1065）。
// 前置：launch.mjs 已起栈（同 worktree 或 VERIFY_REPO_ROOT 指向的 worktree）。

import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const REPO = process.env.VERIFY_REPO_ROOT ?? SCRIPT_REPO;
const RUN_DIR = process.env.VERIFY_RUN_DIR ?? join(REPO, '.claude', 'verify-run');
const stack = JSON.parse(readFileSync(join(RUN_DIR, 'ports.json'), 'utf8'));
const SERVER = `http://127.0.0.1:${stack.serverPort}`;
const DB = join(stack.homeDir, 'server', 'server.db');
const ts = new Date().toISOString().replaceAll(/[:.]/g, '-');
const EVIDENCE = process.env.VERIFY_EVIDENCE_DIR ?? join(SCRIPT_REPO, '.claude', 'verify-evidence', `${ts}-1065-zombie-claim`);
mkdirSync(EVIDENCE, { recursive: true });
const runTag = Date.now().toString(36);

const checks = [];
function check(name, ok, detail) {
  checks.push({ name, ok: Boolean(ok), detail: detail ?? null });
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}\n`);
}
function save(name, data) {
  writeFileSync(join(EVIDENCE, name), typeof data === 'string' ? data : `${JSON.stringify(data, null, 2)}\n`);
}
function finish(extra = {}) {
  save('result.json', {
    probe: 'drive-1065-zombie-claim',
    server: SERVER,
    db: DB,
    passed: checks.filter((c) => c.ok).length,
    total: checks.length,
    checks,
    ...extra,
  });
  process.stdout.write(`\n${checks.filter((c) => c.ok).length}/${checks.length} checks passed → ${EVIDENCE}\n`);
  if (checks.some((c) => !c.ok)) process.exitCode = 1;
}

// 代理剥离：回环 API 走 --noproxy 语义（NO_PROXY，仓内既有探针同款）。
async function jfetch(method, path, opts = {}) {
  const headers = {};
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (opts.cred) headers.authorization = `Bearer ${opts.cred}`;
  const res = await fetch(`${SERVER}${path}`, {
    method,
    headers,
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
    signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000),
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

// —— seed：team + 不可达 stub provider + agent（步可领即可，不执行）+ 双机 ——

async function seed() {
  const teams = await jfetch('GET', '/api/teams');
  const teamId = teams.body[0]?.id ?? teams.body.teams?.[0]?.id;
  if (!teamId) throw new Error(`no team: ${JSON.stringify(teams.body).slice(0, 200)}`);
  const providerId = `stub-1065-${runTag}`;
  const prov = await jfetch('POST', `/api/teams/${teamId}/providers`, {
    body: {
      providerId,
      label: providerId,
      baseUrl: 'http://127.0.0.1:9/v1',
      api: 'openai-completions',
      authHeader: true,
      compat: { supportsDeveloperRole: false },
      models: [{ id: 'stub-model', name: 'stub-model' }],
    },
  });
  if (prov.status >= 400) throw new Error(`provider create failed: ${prov.status}`);
  const agentRes = await jfetch('POST', `/api/teams/${teamId}/agents`, {
    body: { displayName: `probe-1065-${runTag}`, provider: providerId, modelId: 'stub-model', skills: [] },
  });
  const agentId = agentRes.body?.id ?? agentRes.body?.agent?.id;
  if (!agentId) throw new Error(`agent create failed: ${agentRes.status}`);
  const projectRes = await jfetch('POST', '/api/projects', { body: { name: `probe-1065-${runTag}`, teamId } });
  const projectId = projectRes.body?.id;
  if (!projectId) throw new Error(`project create failed: ${projectRes.status}`);
  // 双机各一把 key（同 key 重注册 = 同 machineId，r3 §1.2）。
  const enroll = async (name) => {
    const keyRes = await jfetch('POST', `/api/teams/${teamId}/api-keys`, {
      body: { name: `probe-1065-${name}-${runTag}`, gitAccess: false, mcpAccess: false, toolGrants: { read: [], write: [] } },
    });
    const plaintext = keyRes.body?.plaintext ?? keyRes.body?.key;
    if (!plaintext) throw new Error(`api-key create failed: ${keyRes.status}`);
    const res = await jfetch('POST', '/api/machine/enroll', {
      body: { teamId, name: `probe-1065-${name}`, cliVersion: '0.1.0' },
      cred: plaintext,
    });
    if (res.status !== 200) throw new Error(`enroll ${name} failed: ${res.status}`);
    return res.body;
  };
  return { teamId, agentId, projectId, machineA: await enroll('dead'), machineB: await enroll('live') };
}

// —— A（死机）：子进程长轮询认领。SIGKILL = 「daemon 在 hold 期间被杀」的最小
//    同构形（进程死 → 内核关 socket → server 侧连接断 → 请求 signal abort）。 ——

function spawnDeadClaim(token) {
  const code = `
    const r = await fetch('${SERVER}/api/machine/tasks/claim', {
      method: 'POST',
      headers: { authorization: 'Bearer ${token}', 'content-type': 'application/json' },
      body: '{}',
    });
    process.stdout.write(JSON.stringify(await r.json()));
  `;
  const child = spawn(process.execPath, ['--input-type=module', '-e', code], { stdio: ['ignore', 'pipe', 'inherit'] });
  let out = '';
  let exit = null;
  child.stdout.on('data', (d) => {
    out += d;
  });
  child.on('exit', (code2, signal) => {
    exit = { code: code2, signal };
  });
  return { child, stdout: () => out, exit: () => exit };
}

// —— B（活机）：本进程内的长轮询认领（wake 路径；无 abort）———————

async function liveClaim(token) {
  return jfetch('POST', '/api/machine/tasks/claim', { body: {}, cred: token, timeoutMs: 30_000 });
}

async function makeTask(projectId, agentId) {
  const todoRes = await jfetch('POST', `/api/projects/${projectId}/todos`, {
    body: { title: '1065 僵尸认领探针', spec: '断言步归属，不需要执行。' },
  });
  const todoId = todoRes.body?.id;
  const buildRes = await jfetch('POST', `/api/projects/${projectId}/builds`, {
    body: { todoIds: [todoId], assignment: { plan: { agentId }, build: { agentId } }, withPlan: true },
  });
  const buildId = buildRes.body?.builds?.[0]?.id;
  if (!todoId || !buildId) throw new Error(`task seed failed: ${JSON.stringify(buildRes.body).slice(0, 200)}`);
  return { todoId, buildId };
}

function dbSteps(buildId) {
  const require2 = createRequire(join(REPO, 'apps/server/package.json'));
  const Database = require2('better-sqlite3');
  const db = new Database(DB, { readonly: true });
  try {
    return db.prepare('SELECT id, kind, status, machineId FROM step WHERE buildId = ? ORDER BY createdAt').all(buildId);
  } finally {
    db.close();
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// —— main ———————————————————————————————————————————————————————————

const seeded = await seed();
const { machineA, machineB, agentId, projectId } = seeded;

// A 先认领（waiter 插入序在前——修前僵尸先醒先领的竞序条件）。
const dead = spawnDeadClaim(machineA.token);
await sleep(1_500); // 首次 tryClaim（无步）+ waitWake 注册完成
// B 再认领（活机，wake 路径的等待者）。
const bClaim = liveClaim(machineB.token);
await sleep(1_000);
// 杀 A：hold 期间进程死亡。
dead.child.kill('SIGKILL');
const killedAt = Date.now();
await sleep(1_000); // 连接断传播 + （修后）waiter 摘除
// 新步入队（enqueue → wake 同一同步轮）。
const task = await makeTask(projectId, agentId);
const bRes = await bClaim;
const bBody = bRes.body;

try {
  check('B（活机）claim 走 wake 路径领到新步', bRes.status === 200 && bBody?.step?.step?.machineId === machineB.machineId, `machineId=${bBody?.step?.step?.machineId ?? 'null'}（期望 ${machineB.machineId}）`);

  const rows = dbSteps(task.buildId);
  const first = rows[0] ?? null;
  check('新步落到活机 B（DB 行 machineId = B，状态 claimed）', first?.machineId === machineB.machineId && first?.status === 'claimed', JSON.stringify(first));

  const claimedByDead = rows.filter((r) => r.machineId === machineA.machineId);
  check('死机 A 零认领（本 build 无任何步落 A）', claimedByDead.length === 0, claimedByDead.length === 0 ? `A=${machineA.machineId}` : JSON.stringify(claimedByDead));

  check('A 的认领进程确实被 SIGKILL（非自然返回）', dead.exit()?.signal === 'SIGKILL', JSON.stringify(dead.exit()));
} finally {
  if (!dead.child.killed) dead.child.kill('SIGKILL');
  await Promise.allSettled([bClaim]);
}
finish({
  task: { buildId: task.buildId, todoId: task.todoId },
  machines: { dead: machineA.machineId, live: machineB.machineId },
  killAt: killedAt,
  bClaimStatus: bRes.status,
  deadStdout: dead.stdout().slice(0, 400) || null,
});
