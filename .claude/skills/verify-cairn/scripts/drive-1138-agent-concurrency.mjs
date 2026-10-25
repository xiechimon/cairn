import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const REPO = process.env.VERIFY_REPO_ROOT ?? SCRIPT_REPO;
const RUN_DIR = process.env.VERIFY_RUN_DIR ?? join(REPO, '.claude', 'verify-run');
const stack = JSON.parse(readFileSync(join(RUN_DIR, 'ports.json'), 'utf8'));
const SERVER = `http://127.0.0.1:${stack.serverPort}`;
const DB = join(stack.homeDir, 'server', 'server.db');

const ts = new Date().toISOString().replace(/[:.]/g, '-');
const EVIDENCE =
  process.env.VERIFY_EVIDENCE_DIR ?? join(SCRIPT_REPO, '.claude/verify-evidence', `${ts}-1138-agent-concurrency`);
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
  const passed = checks.filter((c) => c.ok).length;
  save('result.json', {
    probe: 'drive-1138-agent-concurrency',
    server: SERVER,
    db: DB,
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

function spawnClaim(token, budgetMs) {
  const code = `
    try {
      const r = await fetch('${SERVER}/api/machine/tasks/claim', {
        method: 'POST',
        headers: { authorization: 'Bearer ${token}', 'content-type': 'application/json' },
        body: '{}',
        signal: AbortSignal.timeout(${budgetMs}),
      });
      process.stdout.write(JSON.stringify({ hung: false, status: r.status, body: await r.json() }));
    } catch {
      process.stdout.write(JSON.stringify({ hung: true }));
    }
  `;
  const child = spawn(process.execPath, ['--input-type=module', '-e', code], {
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  let out = '';
  child.stdout.on('data', (d) => {
    out += d;
  });
  return {
    child,
    result: () => {
      try {
        return JSON.parse(out);
      } catch {
        return null;
      }
    },
  };
}

async function childDone(spawned, timeoutMs, label) {
  const started = Date.now();
  for (;;) {
    const r = spawned.result();
    if (r !== null) return r;
    if (Date.now() - started > timeoutMs) throw new Error(`claim child timeout: ${label}`);
    await new Promise((r) => setTimeout(r, 300));
  }
}

async function seed() {
  const teams = await jfetch('GET', '/api/teams');
  const teamId = teams.body[0]?.id ?? teams.body.teams?.[0]?.id;
  if (!teamId) throw new Error(`no team: ${JSON.stringify(teams.body).slice(0, 200)}`);
  const providerId = `stub-1138-${runTag}`;
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
  const mkAgent = async (label) => {
    const res = await jfetch('POST', `/api/teams/${teamId}/agents`, {
      body: { displayName: `probe-1138-${label}-${runTag}`, provider: providerId, modelId: 'stub-model' },
    });
    const id = res.body?.id ?? res.body?.agent?.id;
    if (!id) throw new Error(`agent create failed: ${res.status}`);
    return id;
  };
  const agentA = await mkAgent('a');
  const agentB = await mkAgent('b');
  const projectRes = await jfetch('POST', '/api/projects', { body: { name: `probe-1138-${runTag}`, teamId } });
  const projectId = projectRes.body?.id;
  if (!projectId) throw new Error(`project create failed: ${projectRes.status}`);
  const enroll = async (name) => {
    const keyRes = await jfetch('POST', `/api/teams/${teamId}/api-keys`, {
      body: { name: `probe-1138-${name}-${runTag}`, gitAccess: false, mcpAccess: false, toolGrants: { read: [], write: [] } },
    });
    const plaintext = keyRes.body?.plaintext ?? keyRes.body?.key;
    if (!plaintext) throw new Error(`api-key create failed: ${keyRes.status}`);
    const res = await jfetch('POST', '/api/machine/enroll', {
      body: { teamId, name: `probe-1138-${name}`, cliVersion: '0.1.0' },
      cred: plaintext,
    });
    if (res.status !== 200) throw new Error(`enroll ${name} failed: ${res.status}`);
    return { token: res.body.token, machineId: res.body.machineId };
  };
  return { teamId, agentA, agentB, projectId, machineMain: await enroll('main'), machineOther: await enroll('other') };
}

function makeTask(projectId, agentId, label) {
  return jfetch('POST', `/api/projects/${projectId}/todos`, {
    body: { title: `#1138 agent 闸探针 · ${label}`, spec: '断言步归属，不需要执行。' },
  }).then((todoRes) => {
    const todoId = todoRes.body?.id;
    if (!todoId) throw new Error(`todo create failed: ${todoRes.status}`);
    return jfetch('POST', `/api/projects/${projectId}/builds`, {
      body: { todoIds: [todoId], assignment: { plan: { agentId }, build: { agentId } }, withPlan: false },
    }).then((buildRes) => {
      const buildId = buildRes.body?.builds?.[0]?.id;
      if (!buildId) throw new Error(`build create failed: ${JSON.stringify(buildRes.body).slice(0, 200)}`);
      return { todoId, buildId };
    });
  });
}

function dbQuery(sql, ...params) {
  const require2 = createRequire(join(REPO, 'apps/server/package.json'));
  const Database = require2('better-sqlite3');
  const db = new Database(DB, { readonly: true });
  try {
    return db.prepare(sql).all(...params);
  } finally {
    db.close();
  }
}

async function claimStepNow(token) {

  return jfetch('POST', '/api/machine/tasks/claim', { body: {}, cred: token, timeoutMs: 20_000 });
}

const seeded = await seed();
const { teamId, agentA, agentB, projectId, machineMain, machineOther } = seeded;

try {

  const bad1 = await jfetch('PATCH', `/api/teams/${teamId}/agents/${agentA}`, { body: { maxConcurrentTasks: 0 } });
  const bad2 = await jfetch('PATCH', `/api/teams/${teamId}/agents/${agentA}`, { body: { maxConcurrentTasks: 51 } });
  check('D1: PATCH maxConcurrentTasks 0 / 51 → 400（值域 1..50）', bad1.status === 400 && bad2.status === 400, `${bad1.status}/${bad2.status}`);
  const patchRes = await jfetch('PATCH', `/api/teams/${teamId}/agents/${agentA}`, { body: { maxConcurrentTasks: 1 } });
  const agentRowA = dbQuery('SELECT maxConcurrentTasks FROM agent WHERE id = ?', agentA)[0];
  check(
    'D2: PATCH {maxConcurrentTasks:1} → 200 + 记录回读 1 + SQLite 行 1',
    patchRes.status === 200 && patchRes.body?.maxConcurrentTasks === 1 && agentRowA?.maxConcurrentTasks === 1,
    `body=${patchRes.body?.maxConcurrentTasks} db=${agentRowA?.maxConcurrentTasks}`,
  );
  const getB = await jfetch('GET', `/api/teams/${teamId}/agents/${agentB}`);
  check('D3: 未设置的 Agent 记录 maxConcurrentTasks = null（缺省不限）', getB.body?.maxConcurrentTasks === null, `got ${JSON.stringify(getB.body?.maxConcurrentTasks)}`);

  const taskA1 = await makeTask(projectId, agentA, 'A1');
  const taskA2 = await makeTask(projectId, agentA, 'A2');
  const taskB1 = await makeTask(projectId, agentB, 'B1');
  const stepOf = (task) => dbQuery('SELECT id FROM step WHERE buildId = ? AND kind = ?', task.buildId, 'build')[0]?.id;

  const claim1 = await claimStepNow(machineMain.token);
  const stepA1 = stepOf(taskA1);
  check('G1: A 首步可领（闸只挡第二步起）', claim1.status === 200 && claim1.body?.step?.step?.id === stepA1, `got ${claim1.body?.step?.step?.id}（期望 ${stepA1}）`);
  const stepA2 = stepOf(taskA2);
  const stepB1 = stepOf(taskB1);

  const claim2 = await claimStepNow(machineMain.token);
  check('G2: A 满载时同批 B 候选照领（候选级闸、无队头阻塞）', claim2.status === 200 && claim2.body?.step?.step?.id === stepB1, `got ${claim2.body?.step?.step?.id}（期望 ${stepB1}）`);
  const pendingA2 = dbQuery('SELECT status, machineId FROM step WHERE id = ?', stepA2)[0];
  check('G3: A 二步留 pending 未被领（agent 闸挡、步不进失败漏斗）', pendingA2?.status === 'pending' && pendingA2?.machineId === null, JSON.stringify(pendingA2));

  const otherClaim = spawnClaim(machineOther.token, 8_000);
  const otherResult = await childDone(otherClaim, 12_000, 'other machine claim');
  check('G4: 他机 claim 同被 agent 闸挡（跨机归账；机器闸开着仍不发 = 两闸各自 gate）', otherResult.hung === true, JSON.stringify(otherResult).slice(0, 160));

  const holdClaim = spawnClaim(machineMain.token, 45_000);
  await new Promise((r) => setTimeout(r, 2_000));
  check('G5: 挂起中的 claim 无步可发（A 唯一候选被闸挡，长轮询真形态）', holdClaim.result() === null, 'claim 仍挂起（未返回）');

  const doneRes = await jfetch('POST', `/api/machine/done/${stepA1}`, {
    body: { status: 'success', sessionId: 'sess-1138-probe' },
    cred: machineMain.token,
  });
  const woken = await childDone(holdClaim, 30_000, 'held claim after wake');
  const a2Row = dbQuery('SELECT status, machineId FROM step WHERE id = ?', stepA2)[0];
  check(
    'C1: A1 done → 空位释放 + wake → 挂起 claim 即刻领走 A2（DB 归属 = 本机）',
    doneRes.status === 200 && woken.hung === false && woken.body?.step?.step?.id === stepA2 && a2Row?.status === 'claimed' && a2Row?.machineId === machineMain.machineId,
    `done=${doneRes.status} woken=${JSON.stringify(woken).slice(0, 120)} db=${JSON.stringify(a2Row)}`,
  );
  const a1Terminal = dbQuery('SELECT status FROM step WHERE id = ?', stepA1)[0];
  check('C2: A1 步收尾落终态（释放 agent 计数位）', a1Terminal?.status === 'done' || a1Terminal?.status === 'failed', JSON.stringify(a1Terminal));

  const cleared = await jfetch('PATCH', `/api/teams/${teamId}/agents/${agentA}`, { body: { maxConcurrentTasks: null } });
  check('R1: PATCH {maxConcurrentTasks:null} → 200 + 记录回 null（清回不限）', cleared.status === 200 && cleared.body?.maxConcurrentTasks === null, `body=${JSON.stringify(cleared.body?.maxConcurrentTasks)}`);
  const taskA3 = await makeTask(projectId, agentA, 'A3');
  const stepA3 = stepOf(taskA3);
  const claim3 = await claimStepNow(machineMain.token);
  check('R2: 清回不限后 A 新步照领（A2 在跑不挡——不设上限行为完全不变）', claim3.status === 200 && claim3.body?.step?.step?.id === stepA3, `got ${claim3.body?.step?.step?.id}（期望 ${stepA3}）`);

  save('agent-rows.json', dbQuery('SELECT id, displayName, maxConcurrentTasks FROM agent'));
  save('step-rows.json', dbQuery('SELECT id, kind, status, machineId FROM step ORDER BY createdAt'));
  finish({ teamId, agentA, agentB, machineMain: machineMain.machineId, machineOther: machineOther.machineId });
} catch (err) {
  save('probe-error.txt', `${err?.stack ?? err}\n`);
  finish({ error: String(err?.message ?? err) });
  throw err;
}
