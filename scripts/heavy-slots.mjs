#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
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
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { ownerChain, runOwned } from './owned-process.mjs';

const DEFAULT_SLOTS = 2;
const POLL_MS = 250;
const PARTIAL_WRITE_GRACE_MS = 2_000;
const CLOSED_PROBE_CODES = new Set(['ENOENT', 'ECONNREFUSED', 'ECONNRESET']);
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

export function slotCount(env) {
  const raw = env.CAIRN_HEAVY_SLOTS;
  if (raw === undefined || raw === '') return { count: DEFAULT_SLOTS };
  if (/^[1-9]\d*$/.test(raw.trim())) return { count: Number(raw) };
  return {
    count: 1,
    warning: `CAIRN_HEAVY_SLOTS=${raw} is not a positive integer; treating it as 1`,
  };
}

export function skipsQueue(env) {
  if (env.CI === undefined || env.CI === '' || env.CI === 'false' || env.CI === '0') return false;
  try {
    statSync(slotLockDir(env));
    return false;
  } catch (error) {
    if (error.code === 'ENOENT') return true;
    throw error;
  }
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

export function probeAnswers(probe) {
  return new Promise((done, reject) => {
    const connection = createConnection(probe);
    connection.once('connect', () => {
      connection.destroy();
      done(true);
    });
    connection.once('error', (error) => {
      if (CLOSED_PROBE_CODES.has(error.code)) done(false);
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
    const alive =
      typeof record.probe === 'string' ? await probeAnswers(record.probe) : isAlive(pid);
    if (
      !alive &&
      typeof record.token === 'string' &&
      record.probe === join('/tmp', `cairn-heavy-${record.token}.sock`)
    ) {
      try {
        unlinkSync(record.probe);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
    return { ...record, state: alive ? 'held' : 'stale', pid, cwd };
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

export async function acquireSlot({ env = process.env, wait = true, log = console.error } = {}) {
  if (skipsQueue(env)) return null;
  const { count, warning } = slotCount(env);
  if (warning) log(`[heavy-slots] ${warning}`);
  const dir = slotLockDir(env);
  const slotPath = (slot) => join(dir, `slot-${slot}.lock`);
  mkdirSync(dir, { recursive: true });

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

  const token = randomUUID();
  const probe = join('/tmp', `cairn-heavy-${token}.sock`);
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
  };
  process.once('exit', closeProbe);
  const record = { pid: process.pid, cwd: process.cwd(), namespace: PID_NAMESPACE, probe, token };
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
        log(`[heavy-slots] acquired slot ${slot}/${count}`);
        return { slot, owner: process.pid, release };
      } finally {
        if (!retained) closeSync(descriptor);
      }
    }
    return null;
  };
  if (!wait) {
    try {
      return await claim();
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
  let announced = 0;
  try {
    for (;;) {
      const waiting = [];
      for (const name of readdirSync(dir)) {
        const ticketOwner = /^queue-\d+-(\d+)(?:-[a-f0-9-]+)?$/.exec(name);
        if (!ticketOwner) continue;
        if ((await holderState(join(dir, name), Number(ticketOwner[1]))).state !== 'stale')
          waiting.push(name);
        else
          try {
            unlinkSync(join(dir, name));
          } catch {}
      }
      const position = waiting.sort().indexOf(ticket) + 1;
      let freeSlots = 0;
      for (let slot = 1; slot <= count; slot++)
        if ((await holderState(slotPath(slot))).state !== 'held') freeSlots++;
      if (position <= freeSlots) {
        const lease = await claim();
        if (lease) return lease;
      }
      if (position !== announced) {
        const holders = (
          await Promise.all(
            Array.from({ length: count }, async (_, index) => {
              const holder = await holderState(slotPath(index + 1));
              return holder.state === 'held'
                ? `slot ${index + 1}: pid ${holder.pid ?? 'writing'}, cwd ${holder.cwd ?? 'unknown'}`
                : null;
            }),
          )
        ).filter(Boolean);
        log(
          `[heavy-slots] queued, position ${position} (all ${count} slots are busy); ${holders.join('; ')}`,
        );
        announced = position;
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
