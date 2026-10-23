#!/usr/bin/env node
// verify-cairn cleanup — 回收 launch 起的栈:按 pid 文件组杀(SIGTERM →
// 6s 宽限 → SIGKILL),删 VERIFY_RUN_DIR(scratch home + 日志)。证据目录
// 不动,收尾回显其位置。只杀 pid 文件里自己记录的进程,且杀前用 ps 核对
// 命令行含 tsx/vite/pnpm 标记(防陈旧 pid 误杀无辜进程);永不按进程名杀。
// 另回收残留 daemon(#691):ad-hoc daemon(probe/失败 launch 泄漏)不在
// pid 文件里,按「cli.ts start + 本栈 --server 端口」双标记钉选回收——
// 端口钉选是安全边界,dev daemon(`tsx src/cli.ts start -f`)命令行无
// --server,永不命中;无端口钉选时拒绝扫描,绝不退化为裸形状杀。

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';

const SCRIPT_ROOT = fileURLToPath(new URL('../../../..', import.meta.url));
const ROOT = process.env.VERIFY_REPO_ROOT
  ? resolve(process.env.VERIFY_REPO_ROOT)
  : SCRIPT_ROOT;
const RUN_DIR = process.env.VERIFY_RUN_DIR ?? join(ROOT, '.claude', 'verify-run');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function groupAlive(pid) {
  try {
    process.kill(-pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** 组内进程命令行含我们的标记才杀;查不到命令行(已死)当已回收。 */
function commandOf(pid) {
  try {
    return execFileSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' })
      .trim();
  } catch {
    return '';
  }
}

async function killStackPid(pid, label) {
  if (!Number.isInteger(pid)) return;
  if (!groupAlive(pid)) {
    console.log(`${label}:pid ${pid} 已不在`);
    return;
  }
  const cmd = commandOf(pid);
  if (cmd !== '' && !/tsx|vite|pnpm/.test(cmd)) {
    console.warn(`${label}:pid ${pid} 命令行不像我们的栈(${cmd}),跳过`);
    return;
  }
  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    /* 已死 */
  }
  for (let i = 0; i < 20 && groupAlive(pid); i += 1) await sleep(300);
  if (groupAlive(pid)) {
    console.warn(`${label}:SIGTERM 未收敛,pid ${pid} 升级 SIGKILL`);
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      /* 已死 */
    }
    for (let i = 0; i < 10 && groupAlive(pid); i += 1) await sleep(200);
  }
  console.log(`${label}:${groupAlive(pid) ? '仍在(人工查 lsof)' : '已回收'}(pid ${pid})`);
}

/** 残留 daemon 候选(#691):命令行同时含 `cli.ts start` 与本栈
 * `--server http://127.0.0.1:<port>` 钉选串,且首 token 是 node 解释器。
 * 端口钉选 = 安全边界:dev daemon(`tsx src/cli.ts start -f`)与别 lane
 * 的 daemon(别的端口)都不含本栈端口串,永不命中。node 解释器护栏 =
 * 排除恰好把这两串写进命令行的 shell/ps/grep(调用方 zsh -c 的命令行
 * 会原样含标记,实测会自伤);再叠加自身+祖先 pid 排除双保险。 */
const NODE_COMMAND_RE = /^(?:\S*\/)?node(?:\.exe)?\s/;

function selfAndAncestors() {
  const set = new Set([process.pid]);
  let cur = process.pid;
  for (let i = 0; i < 16; i += 1) {
    let ppid;
    try {
      ppid = Number.parseInt(
        execFileSync('ps', ['-o', 'ppid=', '-p', String(cur)], { encoding: 'utf8' }).trim(),
        10,
      );
    } catch {
      break;
    }
    if (!Number.isInteger(ppid) || ppid <= 1 || set.has(ppid)) break;
    set.add(ppid);
    cur = ppid;
  }
  return set;
}

function daemonCandidates(pin, protectedPids) {
  let out;
  try {
    out = execFileSync('ps', ['-Ao', 'pid=,command='], {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    });
  } catch {
    return [];
  }
  const hits = [];
  for (const line of out.split('\n')) {
    const pid = Number.parseInt(line, 10);
    if (!Number.isInteger(pid)) continue;
    const cmd = line.slice(String(pid).length).trim();
    if (protectedPids.has(pid)) continue;
    if (!NODE_COMMAND_RE.test(cmd)) continue;
    if (cmd.includes('cli.ts start') && cmd.includes(pin)) hits.push({ pid, cmd });
  }
  return hits;
}

/** 钉选回收残留 daemon:SIGTERM 优雅停(daemon 有 SIGTERM handler)→
 * 重扫仍命中者 SIGKILL;升级前重核命令行仍带双标记(pid 复用护栏)。 */
async function sweepDaemons(port) {
  const pin = `http://127.0.0.1:${port}`;
  const protectedPids = selfAndAncestors();
  let candidates = daemonCandidates(pin, protectedPids);
  if (candidates.length > 8) {
    console.warn(`daemon 扫描异常:${candidates.length} 个命中(正常应个位数),拒绝批量杀,人工核对`);
    return;
  }
  if (candidates.length === 0) {
    console.log(`daemon:无残留(钉选 ${pin})`);
    return;
  }
  for (const c of candidates) {
    console.log(`daemon:钉选命中 pid ${c.pid} — ${c.cmd.slice(0, 100)}`);
    try {
      process.kill(c.pid, 'SIGTERM');
    } catch {
      /* 已死 */
    }
  }
  for (let i = 0; i < 20 && daemonCandidates(pin, protectedPids).length > 0; i += 1) {
    await sleep(300);
  }
  candidates = daemonCandidates(pin, protectedPids);
  for (const c of candidates) {
    const now = commandOf(c.pid);
    if (now === '' || !now.includes('cli.ts start') || !now.includes(pin)) {
      console.warn(`daemon:pid ${c.pid} 命令行已变(${now}),放弃升级`);
      continue;
    }
    console.warn(`daemon:pid ${c.pid} SIGTERM 未收敛,升级 SIGKILL`);
    try {
      process.kill(c.pid, 'SIGKILL');
    } catch {
      /* 已死 */
    }
  }
  await sleep(2000);
  const left = daemonCandidates(pin, protectedPids);
  console.log(
    left.length === 0
      ? `daemon:残留已回收(钉选 ${pin})`
      : `daemon:仍有 ${left.length} 个未收敛(钉选 ${pin},人工查 lsof/ps)`,
  );
}

async function main() {
  const portsFile = join(RUN_DIR, 'ports.json');
  const pids = { server: undefined, web: undefined };
  let homeDir = null;
  let serverPort = null;
  if (existsSync(portsFile)) {
    try {
      const stack = JSON.parse(readFileSync(portsFile, 'utf8'));
      pids.server = stack.serverPid;
      pids.web = stack.webPid;
      homeDir = stack.homeDir;
      serverPort = typeof stack.serverPort === 'number' ? stack.serverPort : null;
    } catch {
      /* 坏文件走 pid 文件兜底 */
    }
  }
  for (const name of ['server', 'web']) {
    if (pids[name] == null && existsSync(join(RUN_DIR, `${name}.pid`))) {
      pids[name] = Number.parseInt(readFileSync(join(RUN_DIR, `${name}.pid`), 'utf8'), 10);
    }
  }
  // 残留 daemon 钉选回收(#691):端口从 ports.json(本栈正本)或
  // VERIFY_PORT(launch 失败未写 ports.json 时 lane 自己设的)取;
  // 无钉选则拒扫——绝不退化为裸形状杀(bare `cli.ts start` 会命中 dev daemon)。
  const daemonPort =
    serverPort ?? (process.env.VERIFY_PORT ? Number(process.env.VERIFY_PORT) : null);

  if (pids.server == null && pids.web == null && !existsSync(RUN_DIR)) {
    if (daemonPort == null) {
      console.log('无栈可回收(运行目录不存在)');
      process.exit(0);
    }
    console.log('栈运行目录不存在——仍按 VERIFY_PORT 钉选扫残留 daemon');
    await sweepDaemons(daemonPort);
    process.exit(0);
  }

  await killStackPid(pids.web, 'vite dev');
  await killStackPid(pids.server, 'server');

  if (daemonPort != null) {
    await sweepDaemons(daemonPort);
  } else {
    console.warn(
      'daemon:无端口钉选(ports.json 无 serverPort 且未设 VERIFY_PORT),跳过残留扫描;手清残留必须带本栈 --server 端口标记,禁按 cli.ts start/tsx 裸形状杀',
    );
  }

  const dbExisted = homeDir != null && existsSync(join(homeDir, 'server', 'server.db'));
  rmSync(RUN_DIR, { recursive: true, force: true });
  console.log(`运行态已删:${RUN_DIR}(scratch home${dbExisted ? ',含 SQLite 库' : ''})`);

  // 证据回显:cleanup 不删证据,确认其仍在命名位置
  const evidenceRoot = process.env.VERIFY_EVIDENCE_DIR
    ? resolve(process.env.VERIFY_EVIDENCE_DIR)
    : join(SCRIPT_ROOT, '.claude', 'verify-evidence');
  if (existsSync(evidenceRoot)) {
    const entries = readdirSync(evidenceRoot)
      .filter((f) => statSync(join(evidenceRoot, f)).isDirectory())
      .sort();
    console.log(`证据完好:${evidenceRoot}(${entries.length} 组)`);
    for (const e of entries.slice(-3)) console.log(`  - ${e}`);
  } else {
    console.log(`证据目录(尚未有产物):${evidenceRoot}`);
  }
}

await main();
