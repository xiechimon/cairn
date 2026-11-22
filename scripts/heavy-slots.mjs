#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { createConnection, createServer } from 'node:net';
import { availableParallelism, cpus, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { ownerChain, runOwned } from './owned-process.mjs';

const CORES_PER_HEAVY_SLOT = 4;
const CPU_SAMPLE_MS = 250;
const DEFAULT_CPU_SATURATION_PERCENT = 90;
const DEFAULT_CPU_MAX_WAIT_MS = 10 * 60_000;
const POLL_MS = 250;
const QUEUE_REPRINT_MS = 30_000;
const PARTIAL_WRITE_GRACE_MS = 2_000;
const CLOSED_PROBE_CODES = new Set([
  'ENOENT',
  'ECONNREFUSED',
  'ECONNRESET',
  'EINVAL',
  'ENAMETOOLONG',
]);
const REACH_PROBE_CODES = new Set(['EPERM', 'EACCES', 'ENOTSOCK', 'ENOTDIR']);
const PROBE_PATH_LIMIT = 100;
const DEFAULT_E2E_PORT = 8398;
const PORT_STRIDE = 10;
const LOCK_SCRIPT = `
import errno, fcntl, sys
try:
    fcntl.flock(3, fcntl.LOCK_EX | fcntl.LOCK_NB)
except OSError as error:
    if error.errno not in (errno.EAGAIN, errno.EWOULDBLOCK):
        raise
    sys.exit(75)
`;
const PID_NAMESPACE = process.platform === 'linux' ? readlinkSync('/proc/self/ns/pid') : 'host';

export const LIVE_STACK_POOL = {
  countEnv: 'CAIRN_LIVE_STACK_SLOTS',
  defaultCount: 1,
  dirName: 'live-stack',
  label: 'live-stack-slots',
};

export function defaultSlotCount(cores = availableParallelism()) {
  return Math.max(1, Math.floor(cores / CORES_PER_HEAVY_SLOT));
}

function cpuTotals(read = cpus) {
  let busy = 0;
  let total = 0;
  for (const cpu of read()) {
    const { user, nice, sys, irq, idle } = cpu.times;
    busy += user + nice + sys + irq;
    total += user + nice + sys + irq + idle;
  }
  return { busy, total };
}

export function cpuUsagePercent(before, after) {
  const busy = after.busy - before.busy;
  const total = after.total - before.total;
  if (!(total > 0)) return 0;
  return Math.round((busy / total) * 1000) / 10;
}

export async function cpuUtilizationPercent({ sampleMs = CPU_SAMPLE_MS, read = cpus } = {}) {
  const before = cpuTotals(read);
  await sleep(sampleMs);
  return cpuUsagePercent(before, cpuTotals(read));
}

export function cpuSaturationPercent(env) {
  const raw = env.CAIRN_CPU_SATURATION_PERCENT;
  if (raw === undefined || raw === '') return { percent: DEFAULT_CPU_SATURATION_PERCENT };
  const parsed = Number(raw);
  if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 100) return { percent: parsed };
  return {
    percent: DEFAULT_CPU_SATURATION_PERCENT,
    warning: `CAIRN_CPU_SATURATION_PERCENT=${raw} is not a number from 0 to 100; treating it as ${DEFAULT_CPU_SATURATION_PERCENT}`,
  };
}

export function cpuMaxWaitMs(env) {
  const raw = env.CAIRN_CPU_SATURATION_MAX_WAIT_MS;
  if (raw === undefined || raw === '') return DEFAULT_CPU_MAX_WAIT_MS;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_CPU_MAX_WAIT_MS;
}

function bypassName(env) {
  const raw = env.CAIRN_HEAVY_GATE_BYPASS;
  if (raw === undefined || raw === '' || raw === '0' || raw === 'false') return null;
  return `CAIRN_HEAVY_GATE_BYPASS=${raw}`;
}

export function slotCount(env, countEnv, defaultCount) {
  const raw = env[countEnv];
  if (raw === undefined || raw === '') return { count: defaultCount };
  if (/^[1-9]\d*$/.test(raw.trim())) return { count: Number(raw) };
  return {
    count: 1,
    warning: `${countEnv}=${raw} is not a positive integer; treating it as 1`,
  };
}

export function slotWorkerBudget(lease, cores = availableParallelism()) {
  if (lease === null) return null;
  return Math.max(1, Math.floor(cores / Math.max(1, defaultSlotCount(cores))));
}

function processCommand(pid) {
  const ps = spawnSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' });
  if (ps.error) return undefined;
  const command = (ps.stdout || '').trim();
  return command === '' ? undefined : command;
}

export function laneOf(cwd) {
  if (typeof cwd !== 'string' || cwd === '' || cwd === 'unknown') return 'unknown';
  return cwd.split('/').filter(Boolean).at(-1) ?? cwd;
}

export function formatAge(ms) {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return `${Math.max(1, Math.round(ms / 1000))}s`;
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, '0')}m`;
}

export function describeHolder(record, { commandOf = processCommand, now = Date.now() } = {}) {
  const parts = [`lane ${laneOf(record.cwd)}`];
  if (Number.isInteger(record.pid)) parts.push(`pid ${record.pid}`);
  const command = Number.isInteger(record.pid) ? commandOf(record.pid) : undefined;
  if (command !== undefined) parts.push(command);
  const since = Number.isInteger(record.startedAt)
    ? record.startedAt
    : Number.isInteger(record.since)
      ? record.since
      : undefined;
  if (since !== undefined) parts.push(`${formatAge(Math.max(0, now - since))} old`);
  return parts.join(', ');
}

export function slotResources(slot, env) {
  const base = Number(env.E2E_PORT || env.E2E_AFFECTED_PORT) || DEFAULT_E2E_PORT;
  return {
    port: base + (slot - 1) * PORT_STRIDE,
    distDir: join(tmpdir(), `cairn-heavy-slot-${slot}`, 'web-dist'),
  };
}

export function leaseEnv(lease, env = process.env) {
  if (lease === null) return env;
  return {
    ...env,
    CAIRN_HEAVY_SLOT: String(lease.slot),
    CAIRN_HEAVY_SLOT_OWNER: String(lease.owner),
  };
}

export function slotPortHolder(port) {
  const lsof = spawnSync('lsof', ['-t', `-iTCP:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8' });
  let pid = null;
  if (!lsof.error) {
    const parsed = Number((lsof.stdout || '').trim().split('\n')[0]);
    if (Number.isInteger(parsed) && parsed > 0) pid = parsed;
  } else {
    const ss = spawnSync('ss', ['-ltnpH', `sport = :${port}`], { encoding: 'utf8' });
    const match = ss.error ? null : /pid=(\d+)/.exec(ss.stdout || '');
    if (match) pid = Number(match[1]);
  }
  if (pid === null) return null;
  const ps = spawnSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' });
  const command = ps.error || (ps.stdout || '').trim() === '' ? undefined : ps.stdout.trim();
  let cwd;
  try {
    cwd = readlinkSync(`/proc/${pid}/cwd`);
  } catch {
    const lsofCwd = spawnSync('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'], {
      encoding: 'utf8',
    });
    const match = lsofCwd.error ? null : /^n(.+)$/m.exec((lsofCwd.stdout || '').trim());
    cwd = match ? match[1] : undefined;
  }
  return { pid, command, cwd };
}

export function slotPortReport({ slot, env = process.env }) {
  const { port } = slotResources(slot, env);
  const holder = slotPortHolder(port);
  if (holder === null) return null;
  const details = [`pid ${holder.pid}`];
  if (holder.cwd !== undefined) details.push(`cwd ${holder.cwd}`);
  if (holder.command !== undefined) details.push(`command ${holder.command}`);
  return `[heavy-slots] slot ${slot}'s port ${port} is held by ${details.join(', ')}; anything on a leased slot's port is an orphan — kill the pid or free the port, then rerun`;
}

export function gitToplevel(dir) {
  const res = spawnSync('git', ['-C', dir, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' });
  return res.error || res.status !== 0 ? undefined : res.stdout.trim();
}

export function foreignPortHolderReport({
  port,
  toplevel,
  holderOf = slotPortHolder,
  toplevelOf = gitToplevel,
}) {
  const holder = holderOf(port);
  if (holder === null) return null;
  const holderToplevel = holder.cwd === undefined ? undefined : toplevelOf(holder.cwd);
  if (holderToplevel !== undefined && holderToplevel === toplevel) return null;
  const details = [`pid ${holder.pid}`, `cwd ${holder.cwd ?? 'unknown'}`];
  if (holder.command !== undefined) details.push(`command ${holder.command}`);
  return `[e2e] port ${port} is served by another checkout (${holderToplevel ?? 'not a git checkout'}), not ${toplevel}: ${details.join(', ')}. Playwright reused that server, so these specs would test its build. Stop your own stale preview, or pick a free port with E2E_PORT=<port>; leave other lanes' processes running.`;
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

export function unreachableProbeError(error) {
  return CLOSED_PROBE_CODES.has(error.code);
}

export function probePath(token, tmp = tmpdir()) {
  const name = `cairn-heavy-${createHash('sha256').update(token).digest('hex').slice(0, 16)}.sock`;
  const underTmp = join(tmp, name);
  return underTmp.length <= PROBE_PATH_LIMIT ? underTmp : join('/tmp', name);
}

export function probeAnswers(probe) {
  return new Promise((done, reject) => {
    let connection;
    try {
      connection = createConnection(probe);
    } catch (error) {
      if (unreachableProbeError(error)) return done(false);
      return reject(error);
    }
    connection.once('connect', () => {
      connection.destroy();
      done(true);
    });
    connection.once('error', (error) => {
      if (unreachableProbeError(error)) done(false);
      else reject(error);
    });
  });
}

async function holderState(path, legacyPid) {
  let text;
  let modified;
  try {
    text = readFileSync(path, 'utf8');
    modified = statSync(path).mtimeMs;
  } catch (error) {
    if (error.code === 'ENOENT') return { state: 'free' };
    throw error;
  }
  let record = { pid: legacyPid };
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object') record = parsed;
  } catch {}
  let { pid, cwd } = record;
  if (Number.isInteger(pid) && pid > 0) {
    if (typeof cwd !== 'string') {
      try {
        cwd = readlinkSync(`/proc/${pid}/cwd`);
      } catch {
        cwd = 'unknown';
      }
    }
    let alive;
    if (typeof record.probe === 'string') {
      try {
        alive = await probeAnswers(record.probe);
      } catch (error) {
        if (REACH_PROBE_CODES.has(error.code)) alive = isAlive(pid);
        else throw error;
      }
    } else {
      alive = isAlive(pid);
    }
    if (
      !alive &&
      typeof record.token === 'string' &&
      [
        probePath(record.token),
        join(dirname(path), `cairn-heavy-${record.token}.sock`),
        join('/tmp', `cairn-heavy-${record.token}.sock`),
      ].includes(record.probe)
    ) {
      try {
        unlinkSync(record.probe);
      } catch (error) {
        if (error.code !== 'ENOENT' && !REACH_PROBE_CODES.has(error.code)) throw error;
      }
    }
    return {
      ...record,
      state: alive ? 'held' : 'stale',
      pid,
      cwd,
      since: Number.isInteger(record.startedAt) ? record.startedAt : modified,
    };
  }
  return { state: Date.now() - modified < PARTIAL_WRITE_GRACE_MS ? 'held' : 'stale' };
}

export function slotLockDir(
  env,
  platform = process.platform,
  darwinTemp = () => spawnSync('getconf', ['DARWIN_USER_TEMP_DIR'], { encoding: 'utf8' }),
) {
  if (env.CAIRN_HEAVY_SLOTS_DIR) return env.CAIRN_HEAVY_SLOTS_DIR;
  if (platform !== 'darwin') return join(tmpdir(), 'cairn-heavy-slots');
  const result = darwinTemp();
  if (result.status === 0 && result.stdout.trim())
    return join(result.stdout.trim(), 'cairn-heavy-slots');
  if (env.TMPDIR)
    throw new Error(
      'heavy-slots: getconf DARWIN_USER_TEMP_DIR failed and TMPDIR is overridden, so the shared slot directory is unknown; set CAIRN_HEAVY_SLOTS_DIR',
    );
  return join(tmpdir(), 'cairn-heavy-slots');
}

export async function acquireSlot({
  env = process.env,
  wait = true,
  log = console.error,
  pool = {},
  cpuProbe = cpuUtilizationPercent,
  light = null,
} = {}) {
  const { countEnv, defaultCount = defaultSlotCount(), dirName = '', label = 'heavy-slots' } = pool;
  const dir = join(slotLockDir(env), dirName);
  const bypass = bypassName(env);
  if (bypass) {
    log(
      `[${label}] BYPASS: ${bypass} skips the machine-wide slot queue and the per-run worker cap this run (pid ${process.pid}, cwd ${process.cwd()})`,
    );
    return null;
  }
  const { count, warning } =
    countEnv === undefined ? { count: defaultCount } : slotCount(env, countEnv, defaultCount);
  if (warning) log(`[${label}] ${warning}`);
  const saturation = cpuSaturationPercent(env);
  if (saturation.warning) log(`[${label}] ${saturation.warning}`);
  const cpuMaxWait = cpuMaxWaitMs(env);
  let saturatedPercent = null;
  let saturatedSince = null;
  const cpuAdmits = async () => {
    if (saturation.percent === 0) return true;
    const percent = await cpuProbe();
    if (percent < saturation.percent) {
      if (saturatedPercent !== null)
        log(
          `[${label}] cpu back to ${percent}%, under the ${saturation.percent}% saturation limit`,
        );
      saturatedPercent = null;
      saturatedSince = null;
      return true;
    }
    saturatedSince ??= Date.now();
    const waitedMs = Date.now() - saturatedSince;
    if (cpuMaxWait > 0 && waitedMs >= cpuMaxWait) {
      log(
        `[${label}] cpu held at or above ${saturation.percent}% for ${Math.round(waitedMs / 1000)}s; starting anyway (CAIRN_CPU_SATURATION_MAX_WAIT_MS=${cpuMaxWait})`,
      );
      return true;
    }
    if (saturatedPercent !== percent) {
      log(
        `[${label}] cpu ${percent}% is at or above the ${saturation.percent}% saturation limit; not starting more heavy work until the machine drains (CAIRN_CPU_SATURATION_PERCENT, 0 disables)`,
      );
      saturatedPercent = percent;
    }
    return false;
  };
  const slotPath = (slot) => join(dir, `slot-${slot}.lock`);
  mkdirSync(dir, { recursive: true });
  chmodSync(dir, 0o700);

  const inherited = Number(env.CAIRN_HEAVY_SLOT);
  const owner = Number(env.CAIRN_HEAVY_SLOT_OWNER);
  if (Number.isInteger(inherited) && inherited >= 1 && inherited <= count) {
    const holder = await holderState(slotPath(inherited));
    if (
      holder.state === 'held' &&
      holder.pid === owner &&
      (holder.namespace === undefined || holder.namespace === PID_NAMESPACE) &&
      (owner === process.pid || ownerChain(process.pid).some((entry) => entry.pid === owner))
    )
      return { slot: inherited, owner, release() {} };
  }

  if (light !== null) {
    log(
      `[${label}] ${light} is light work; taking no slot and no worker cap, so a full queue of heavy work cannot hold it up (heavy work needs one of the ${count} machine-wide slots)`,
    );
    return null;
  }

  const token = randomUUID();
  const probe = probePath(token);
  const server = createServer((connection) => connection.destroy());
  await new Promise((done, reject) => {
    server.once('error', reject);
    server.listen(probe, () => {
      server.off('error', reject);
      done();
    });
  });
  server.unref();
  let probeClosed = false;
  const closeProbe = () => {
    if (probeClosed) return;
    probeClosed = true;
    process.off('exit', closeProbe);
    server.close();
    try {
      unlinkSync(probe);
    } catch {}
  };
  process.once('exit', closeProbe);
  const record = {
    pid: process.pid,
    cwd: process.cwd(),
    namespace: PID_NAMESPACE,
    probe,
    token,
    count,
    startedAt: Date.now(),
  };
  let claimed = false;
  const claim = async () => {
    for (let slot = 1; slot <= count; slot++) {
      const path = slotPath(slot);
      const descriptor = openSync(`${path}.guard`, 'a');
      let retained = false;
      try {
        const lock = spawnSync('python3', ['-I', '-c', LOCK_SCRIPT], {
          env: { ...process.env, ...env },
          encoding: 'utf8',
          stdio: ['ignore', 'ignore', 'pipe', descriptor],
        });
        if (lock.error) throw lock.error;
        if (lock.status === 75) continue;
        if (lock.status !== 0)
          throw new Error(
            `heavy-slots: kernel lock failed (${lock.signal ?? lock.status}): ${lock.stderr?.trim() ?? ''}`,
          );
        if ((await holderState(path)).state === 'held') continue;
        writeFileSync(path, JSON.stringify(record));
        let released = false;
        const release = () => {
          if (released) return;
          released = true;
          process.off('exit', release);
          try {
            try {
              if (JSON.parse(readFileSync(path, 'utf8')).token === token) unlinkSync(path);
            } catch (error) {
              if (error.code !== 'ENOENT') throw error;
            }
          } finally {
            closeSync(descriptor);
            closeProbe();
          }
        };
        retained = true;
        claimed = true;
        process.once('exit', release);
        log(`[${label}] acquired slot ${slot}/${count}`);
        return { slot, owner: process.pid, release };
      } finally {
        if (!retained) closeSync(descriptor);
      }
    }
    return null;
  };
  if (!wait) {
    try {
      return (await cpuAdmits()) ? await claim() : null;
    } finally {
      if (!claimed) closeProbe();
    }
  }

  const ticket = `queue-${String(Date.now()).padStart(15, '0')}-${String(process.pid).padStart(10, '0')}-${token}`;
  const dropTicket = () => {
    try {
      unlinkSync(join(dir, ticket));
    } catch {}
  };
  try {
    writeFileSync(join(dir, ticket), JSON.stringify(record));
  } catch (error) {
    closeProbe();
    throw error;
  }
  process.once('exit', dropTicket);
  const reprintMs = Number(env.CAIRN_HEAVY_QUEUE_REPRINT_MS) || QUEUE_REPRINT_MS;
  let announced = 0;
  let announcedAt = 0;
  try {
    for (;;) {
      const waiting = [];
      for (const name of readdirSync(dir)) {
        const ticketOwner = /^queue-\d+-(\d+)(?:-[a-f0-9-]+)?$/.exec(name);
        if (!ticketOwner) continue;
        const holder = await holderState(join(dir, name), Number(ticketOwner[1]));
        if (holder.state !== 'stale')
          waiting.push({
            name,
            count: Number.isInteger(holder.count) ? holder.count : undefined,
          });
        else
          try {
            unlinkSync(join(dir, name));
          } catch {}
      }
      waiting.sort((a, b) => a.name.localeCompare(b.name));
      const position = waiting.findIndex((entry) => entry.name === ticket) + 1;
      const horizon = Math.max(count, ...waiting.map((entry) => entry.count ?? count));
      const free = new Set();
      for (let slot = 1; slot <= horizon; slot++)
        if ((await holderState(slotPath(slot))).state !== 'held') free.add(slot);
      for (const entry of waiting) {
        if (entry.name === ticket) break;
        const reach = entry.count ?? horizon;
        for (let slot = 1; slot <= reach; slot++) if (free.delete(slot)) break;
      }
      if ([...free].some((slot) => slot <= count) && (await cpuAdmits())) {
        const lease = await claim();
        if (lease) return lease;
      }
      if (position !== announced || Date.now() - announcedAt >= reprintMs) {
        const holders = await Promise.all(
          Array.from({ length: count }, async (_, index) => {
            const holder = await holderState(slotPath(index + 1));
            return holder.state === 'held'
              ? `slot ${index + 1}: ${describeHolder(holder)}`
              : `slot ${index + 1}: free`;
          }),
        );
        log(
          `[${label}] queued, position ${position} of ${count} slot(s); ${holders.join('; ')}${announced === position ? ' — still waiting' : ''}`,
        );
        announced = position;
        announcedAt = Date.now();
      }
      await sleep(POLL_MS);
    }
  } finally {
    process.off('exit', dropTicket);
    dropTicket();
    if (!claimed) closeProbe();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  const argv = process.argv.slice(2);
  const command = argv[0] === 'run' && argv[1] === '--' ? argv.slice(2) : [];
  if (command.length === 0) {
    console.error('Usage: node scripts/heavy-slots.mjs run -- <command> [args...]');
    process.exit(2);
  }
  const lease = await acquireSlot();
  process.exit(
    await runOwned(command[0], command.slice(1), { env: leaseEnv(lease), name: 'heavy-slot' }),
  );
}
