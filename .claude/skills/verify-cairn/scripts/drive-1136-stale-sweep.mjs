#!/usr/bin/env node

import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { appendFileSync, copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const SCRIPT_ROOT = fileURLToPath(new URL('../../../..', import.meta.url));
const SERVER = `http://127.0.0.1:${process.env.VERIFY_PORT ?? '8791'}`;
const RUN_DIR = process.env.VERIFY_RUN_DIR ?? join(SCRIPT_ROOT, '.claude', 'verify-run');
const DB_PATH = join(RUN_DIR, 'home', 'server', 'server.db');
const DAEMON_HOME = join(RUN_DIR, 'daemon-1136');
const MACHINE_NAME = 'verify-1136';
const STALE_MS = 150_000;
const TICK_MS = 15_000;
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const EVIDENCE =
  process.env.VERIFY_EVIDENCE_DIR ?? join(SCRIPT_ROOT, '.claude', 'verify-evidence', `${stamp}-1136-stale-sweep`);
mkdirSync(EVIDENCE, { recursive: true });

const checks = [];
let failures = 0;
const check = (ok, label) => {
  checks.push({ ok, label });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) failures += 1;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => Date.now();

const EXPECT_OLD = process.argv.includes('--expect=old');
const openDb = () => {
  const requireServer = createRequire(join(SCRIPT_ROOT, 'apps', 'server', 'package.json'));
  const Database = requireServer('better-sqlite3');
  return new Database(DB_PATH, { readonly: true });
};
function hasLastSeenColumn() {
  const db = openDb();
  try {
    const cols = db.prepare('PRAGMA table_info(machine)').all();
    return cols.some((c) => c.name === 'lastSeenAt');
  } finally {
    db.close();
  }
}
function machineRow() {
  const db = openDb();
  try {
    const withCol = hasLastSeenColumn();
    const row = withCol
      ? db.prepare('SELECT id, online, "lastSeenAt" FROM machine WHERE name = ?').get(MACHINE_NAME)
      : db.prepare('SELECT id, online FROM machine WHERE name = ?').get(MACHINE_NAME);

    return row === undefined ? undefined : { ...row, online: !!row.online };
  } finally {
    db.close();
  }
}

async function jfetch(method, path, opts = {}) {
  const res = await fetch(`${SERVER}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    signal: AbortSignal.timeout(8000),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

function treePids(root) {
  const out = execFileSync('ps', ['-axo', 'pid=,ppid='], { encoding: 'utf8' });
  const edges = new Map();
  for (const line of out.split('\n')) {
    const m = line.trim().match(/^(\d+)\s+(\d+)$/);
    if (m) {
      const list = edges.get(m[2]) ?? [];
      list.push(Number(m[1]));
      edges.set(m[2], list);
    }
  }
  const acc = [];
  const walk = (pid) => {
    acc.push(pid);
    for (const child of edges.get(String(pid)) ?? []) walk(child);
  };
  walk(root);
  return acc;
}
const signalTree = (root, sig) => {
  const pids = treePids(root);
  console.log(`signal ${sig} → tree of ${root}: [${pids.join(',')}]`);
  process.kill(root, sig);
  for (const pid of pids) {
    if (pid === root) continue;
    try {
      process.kill(pid, sig);
    } catch {

    }
  }
};

async function pollUntil(label, pred, { timeoutMs, intervalMs = 5000 }) {
  const timeline = [];
  const t0 = now();
  for (;;) {
    const row = machineRow();
    const t = now();
    const sample = {
      atMs: t - t0,
      online: row?.online ?? null,
      lastSeenAt: row?.lastSeenAt ?? null,
      ageMs: row?.lastSeenAt ? t - row.lastSeenAt : null,
    };
    timeline.push(sample);
    if (pred(sample)) return { hit: true, timeline, sample };
    if (t - t0 > timeoutMs) return { hit: false, timeline, sample };
    await sleep(intervalMs);
  }
}

console.log(`evidence → ${EVIDENCE}`);
console.log(`server   → ${SERVER} (db ${DB_PATH})`);

const teams = await jfetch('GET', '/api/teams');
const teamId = teams.body?.[0]?.id ?? teams.body?.teams?.[0]?.id;
if (!teamId) throw new Error('no team found (stack not fresh?)');
const keyRes = await jfetch('POST', `/api/teams/${teamId}/api-keys`, {
  body: { name: `probe-1136-${Date.now()}`, gitAccess: false, mcpAccess: false, toolGrants: { read: [], write: [] } },
});
const apiKey = keyRes.body?.plaintext ?? keyRes.body?.key;
if (!apiKey) throw new Error(`api-key create failed: ${keyRes.status}`);

const daemonEnv = { ...process.env };
for (const k of ['http_proxy', 'https_proxy', 'all_proxy', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY']) delete daemonEnv[k];
daemonEnv.NO_PROXY = '*';
daemonEnv.CAIRN_HOME = DAEMON_HOME;
const daemonConsole = join(EVIDENCE, 'daemon-console.log');
writeFileSync(daemonConsole, '');
const daemon = spawn(
  'pnpm',
  ['exec', 'tsx', 'src/cli.ts', 'start', '--foreground', '--server', SERVER, '--api-key', apiKey, '--team', teamId, '--name', MACHINE_NAME],
  { cwd: join(SCRIPT_ROOT, 'apps', 'daemon'), env: daemonEnv, stdio: ['ignore', 'pipe', 'pipe'] },
);
daemon.stdout.on('data', (d) => appendFileSync(daemonConsole, d));
daemon.stderr.on('data', (d) => appendFileSync(daemonConsole, d));
daemon.on('exit', (code) => appendFileSync(daemonConsole, `\n[probe] daemon exited code=${code}\n`));

const enrolled = await pollUntil('enroll', (s) => s.online === true, { timeoutMs: 60_000, intervalMs: 2000 });
check(enrolled.hit, 'daemon enroll → machine online（presence 置位）');
const enrolledRow = machineRow();
const machineId = enrolledRow?.id;

if (EXPECT_OLD) {
  check(!hasLastSeenColumn(), 'old-1: machine 表无 lastSeenAt 列（改动前 schema 形态）');
  console.log('old leg: SIGSTOP silent death (210s)');
  const oldDeathAt = now();
  signalTree(daemon.pid, 'SIGSTOP');
  const frozen = await pollUntil('old-freeze', () => false, { timeoutMs: STALE_MS + 60_000, intervalMs: 10_000 });
  const stayedOnline = frozen.timeline.every((s) => s.online === true);
  check(
    stayedOnline,
    `old-2: 静默死机 ${(STALE_MS + 60_000) / 1000}s 后 online 仍 true——无第二真值源，机器行永不翻 offline（#1136 要杀的 #861 残余 bug 复现）`,
  );
  signalTree(daemon.pid, 'SIGCONT');
  const back = await pollUntil('old-recover', (s) => s.online === true, { timeoutMs: 30_000, intervalMs: 5000 });
  check(back.hit, 'old-3: SIGCONT 后 presence 通道恢复（机器全程 online，无需翻回）');
  try {
    daemon.kill('SIGTERM');
  } catch {  }
  await sleep(2000);
  try {
    if (!daemon.killed) daemon.kill('SIGKILL');
  } catch {  }
  const oldResult = {
    probe: 'drive-1136-stale-sweep',
    expect: 'old',
    ticket: 1136,
    stack: { server: SERVER, db: DB_PATH, machineId, machineName: MACHINE_NAME },
    timings: { oldDeathAt, observedMs: STALE_MS + 60_000, lastSampleOnline: frozen.timeline.at(-1)?.online },
    phases: { frozen: frozen.timeline },
    checks,
    failures,
  };
  writeFileSync(join(EVIDENCE, 'result.json'), `${JSON.stringify(oldResult, null, 2)}\n`);
  if (existsSync(join(RUN_DIR, 'server.log'))) copyFileSync(join(RUN_DIR, 'server.log'), join(EVIDENCE, 'server.log'));
  console.log(`\nresult (old): ${checks.length - failures}/${checks.length} checks PASS`);
  console.log(`evidence → ${EVIDENCE}`);
  process.exit(failures === 0 ? 0 : 1);
}

check(
  enrolledRow?.lastSeenAt != null,
  'markPresence 落 lastSeenAt（迁移列 + 写路径 live 实证）',
);

console.log('phase A: healthy observation 60s');
const phaseA = await pollUntil('healthy-window', () => false, { timeoutMs: 60_000, intervalMs: 5000 });
const aMaxAge = Math.max(...phaseA.timeline.map((s) => s.ageMs ?? 0));
check(phaseA.timeline.every((s) => s.online === true), 'A: 正常 presence 的机器不被误翻（60s 全程 online）');
check(aMaxAge < 40_000, `A: lastSeenAt 持续刷新（最大年龄 ${(aMaxAge / 1000).toFixed(1)}s < 40s = 节拍 30s + 抖动）`);

console.log('phase B: SIGSTOP silent death');
const deathAt = now();
const deathRow = machineRow();
const lastSeenAtDeath = deathRow?.lastSeenAt ?? null;
const ageAtDeath = lastSeenAtDeath === null ? 0 : deathAt - lastSeenAtDeath;
const preWindowMs = STALE_MS - ageAtDeath + 10_000;
signalTree(daemon.pid, 'SIGSTOP');
const preThreshold = await pollUntil('pre-threshold', () => false, { timeoutMs: preWindowMs, intervalMs: 5000 });
check(
  preThreshold.timeline.filter((s) => s.ageMs !== null && s.ageMs < STALE_MS).every((s) => s.online === true),
  `B1: 列龄未到 150s 的样本全部 online——SSE ping 写入被对端 TCP 缓冲吸收、不触发 onAbort（票面未核实项实测：该通道抓不住静默死机）`,
);
check(
  preThreshold.timeline.every((s) => s.lastSeenAt === lastSeenAtDeath),
  'B2: lastSeenAt 冻结在死机时刻（presence 是唯一写源；断连检测不写此列）',
);

const flipped = await pollUntil('flip', (s) => s.online === false, { timeoutMs: TICK_MS + 45_000, intervalMs: 5000 });
const flippedAt = flipped.hit ? now() : null;
const flipLatency = flipped.hit ? flippedAt - deathAt : null;
const flipFromLastSeen = flipped.hit ? flippedAt - lastSeenAtDeath : null;
check(flipped.hit, 'B3: 过阈在线机器翻 offline（sweepStaleMachines 生效）');
if (flipped.hit) {
  check(
    flipLatency >= preWindowMs - 10_000 && flipLatency <= preWindowMs + TICK_MS + 30_000,
    `B4: 翻转延迟 ${flipLatency}ms ∈ [列龄到阈 ${(preWindowMs - 10_000) / 1000}s, + tick 15s + 采样余量 30s]`,
  );
  check(
    flipFromLastSeen >= STALE_MS,
    `B5: 翻转判据锚 lastSeenAt（翻时刻的列年龄 ${flipFromLastSeen}ms ≥ 150s 阈值）`,
  );
}

console.log('phase C: SIGCONT recovery');
signalTree(daemon.pid, 'SIGCONT');
const recoverAt = now();
const recovered = await pollUntil('recover', (s) => s.online === true, { timeoutMs: 90_000, intervalMs: 5000 });
check(recovered.hit, 'C1: 闪断恢复后翻回在线（presence becameOnline 路径）');
const recoveredRow = machineRow();
check(
  recovered.hit && now() - recoveredRow.lastSeenAt < 35_000,
  `C2: 恢复后 lastSeenAt 刷新（年龄 ${((now() - recoveredRow.lastSeenAt) / 1000).toFixed(1)}s < 35s）`,
);
const recoverLatency = recovered.hit ? now() - recoverAt : null;
if (recovered.hit) {
  check(recoverLatency < 90_000, `C3: 恢复延迟 ${recoverLatency}ms < 90s（下一拍 presence + 抖动量级）`);
}

try {
  daemon.kill('SIGTERM');
} catch {  }
await sleep(2000);
try {
  if (!daemon.killed) daemon.kill('SIGKILL');
} catch {  }

const result = {
  probe: 'drive-1136-stale-sweep',
  ticket: 1136,
  stack: { server: SERVER, db: DB_PATH, daemonHome: DAEMON_HOME, machineId, machineName: MACHINE_NAME },
  constants: { STALE_MS, TICK_MS },
  phases: {
    healthy: phaseA.timeline,
    preThreshold: preThreshold.timeline,
    flip: flipped.timeline,
    recovery: recovered.timeline,
  },
  timings: {
    deathAt,
    lastSeenAtAtDeath: lastSeenAtDeath,
    ageAtDeathMs: ageAtDeath,
    preWindowMs,
    flippedAt,
    flipLatencyMs: flipLatency,
    flipFromLastSeenMs: flipFromLastSeen,
    recoverAt,
    recoveredAt: recovered.hit ? recoverAt + recoverLatency : null,
    recoverLatencyMs: recoverLatency,
  },
  checks,
  failures,
};
writeFileSync(join(EVIDENCE, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
if (existsSync(join(RUN_DIR, 'server.log'))) copyFileSync(join(RUN_DIR, 'server.log'), join(EVIDENCE, 'server.log'));
if (existsSync(join(DAEMON_HOME, 'daemon.log'))) copyFileSync(join(DAEMON_HOME, 'daemon.log'), join(EVIDENCE, 'daemon.log'));
console.log(`\nresult: ${checks.length - failures}/${checks.length} checks PASS`);
console.log(`evidence → ${EVIDENCE}`);
process.exit(failures === 0 ? 0 : 1);
