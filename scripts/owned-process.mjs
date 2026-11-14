#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { accessSync, constants as fsConstants, readdirSync, readFileSync } from 'node:fs';
import { constants as osConstants } from 'node:os';
import { basename, delimiter, join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

export const OWNED_PROCESS_CLI = import.meta.filename;
export const OWNER_ENV = 'CAIRN_OWNER_ID';
const MODE_ENV = 'CAIRN_OWNED_MODE';
const POLL_MS = 500;
const GRACE_MS = 5_000;
const DEFAULT_MAX_RUNTIME_SEC = 12 * 3600;
const AGENT_COMMANDS = new Set(['claude', 'codex']);
const FORWARDED_SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'];
const SYSTEMD_BUS_ENV = ['XDG_RUNTIME_DIR', 'DBUS_SESSION_BUS_ADDRESS'];

export function processInfo(pid) {
  if (process.platform === 'linux') {
    let stat;
    try {
      stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    } catch {
      return null;
    }
    const close = stat.lastIndexOf(')');
    const fields = stat.slice(close + 2).split(' ');
    return {
      pid,
      ppid: Number(fields[1]),
      start: fields[19],
      comm: stat.slice(stat.indexOf('(') + 1, close),
    };
  }
  const ps = spawnSync('ps', ['-o', 'ppid=,lstart=,comm=', '-p', String(pid)], {
    encoding: 'utf8',
  });
  return ps.status === 0 ? parsePsInfo(pid, ps.stdout ?? '') : null;
}

export function parsePsInfo(pid, stdout) {
  const match = /^\s*(\d+)\s+(\S+\s+\S+\s+\d+\s+[\d:]+\s+\d+)\s+(.+)$/.exec(stdout.trimEnd());
  if (!match) return null;
  return { pid, ppid: Number(match[1]), start: match[2], comm: basename(match[3].trim()) };
}

export function ownerChain(pid, owner = 'parent', info = processInfo) {
  const chain = [];
  for (let current = info(pid); current && current.ppid > 0; ) {
    const parent = info(current.ppid);
    if (!parent) break;
    chain.push({ pid: parent.pid, start: parent.start, comm: parent.comm });
    current = parent;
  }
  if (owner === 'parent') return chain;
  const agent = chain.findIndex((link) => AGENT_COMMANDS.has(link.comm));
  return agent === -1 ? [] : chain.slice(agent);
}

function onPath(binary) {
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    const candidate = join(dir, binary);
    try {
      accessSync(candidate, fsConstants.X_OK);
      return candidate;
    } catch {}
  }
  return undefined;
}

function insideOwnedScope() {
  try {
    return readFileSync('/proc/self/cgroup', 'utf8').includes('/cairn-owned-');
  } catch {
    return false;
  }
}

let scopeProbe;
export function ownedScopeAvailable() {
  return systemdRun() !== undefined;
}

function systemdRun() {
  if (process.platform !== 'linux' || process.env[MODE_ENV] === 'group' || insideOwnedScope())
    return undefined;
  if (scopeProbe === undefined) {
    const binary = onPath('systemd-run');
    scopeProbe =
      binary !== undefined &&
      spawnSync(
        binary,
        ['--user', '--scope', '--quiet', '--collect', '--expand-environment=no', 'true'],
        {
          stdio: 'ignore',
          timeout: 10_000,
        },
      ).status === 0
        ? binary
        : null;
  }
  return scopeProbe ?? undefined;
}

let setprivProbe;
function deathSignalPrefix() {
  if (process.platform !== 'linux') return [];
  setprivProbe ??= onPath('setpriv') ?? null;
  return setprivProbe ? [setprivProbe, '--pdeathsig', 'KILL', '--'] : [];
}

function carriesOwner(entries, id) {
  const prefix = `${OWNER_ENV}=`;
  return entries.some(
    (entry) => entry.startsWith(prefix) && entry.slice(prefix.length).split(',').includes(id),
  );
}

function markedPids(id) {
  if (process.platform === 'linux') {
    const pids = [];
    for (const entry of readdirSync('/proc')) {
      if (!/^\d+$/.test(entry)) continue;
      try {
        if (carriesOwner(readFileSync(`/proc/${entry}/environ`, 'utf8').split('\0'), id))
          pids.push(Number(entry));
      } catch {}
    }
    return pids;
  }
  const ps = spawnSync('ps', ['-axEww', '-o', 'pid=,command='], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return (ps.stdout ?? '')
    .split('\n')
    .filter((line) => carriesOwner(line.split(/\s/), id))
    .map((line) => Number.parseInt(line, 10))
    .filter((pid) => Number.isInteger(pid) && pid !== process.pid);
}

function scopePids(unit) {
  const cgroup = spawnSync(
    'systemctl',
    ['--user', 'show', '-p', 'ControlGroup', '--value', `${unit}.scope`],
    {
      encoding: 'utf8',
    },
  ).stdout?.trim();
  if (!cgroup) return [];
  try {
    return readFileSync(`/sys/fs/cgroup${cgroup}/cgroup.procs`, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map(Number);
  } catch {
    return [];
  }
}

function signalTarget(target, signal) {
  if (target.unit) {
    spawnSync('systemctl', ['--user', 'kill', `--signal=${signal}`, `${target.unit}.scope`], {
      stdio: 'ignore',
    });
    return;
  }
  for (const pid of [-target.pgid, ...markedPids(target.id)]) {
    try {
      process.kill(pid, signal);
    } catch {}
  }
}

function targetAlive(target) {
  if (target.unit) return scopePids(target.unit).length > 0;
  try {
    process.kill(-target.pgid, 0);
    return true;
  } catch {
    return markedPids(target.id).length > 0;
  }
}

async function killTarget(target) {
  if (targetAlive(target)) {
    signalTarget(target, 'SIGTERM');
    const deadline = Date.now() + target.graceMs;
    while (Date.now() < deadline && targetAlive(target)) await sleep(100);
    if (targetAlive(target)) signalTarget(target, 'SIGKILL');
    for (let i = 0; i < 50 && targetAlive(target); i += 1) await sleep(100);
  }
  if (target.unit)
    spawnSync('systemctl', ['--user', 'stop', `${target.unit}.scope`], { stdio: 'ignore' });
}

export function spawnOwned(
  command,
  args = [],
  {
    cwd,
    env = process.env,
    stdio = 'inherit',
    owner = 'parent',
    name = basename(command),
    maxRuntimeSec = DEFAULT_MAX_RUNTIME_SEC,
    graceMs = GRACE_MS,
    chain = ownerChain(process.pid, owner),
  } = {},
) {
  const id = randomUUID();
  const scopeRunner = systemdRun();
  const unit = scopeRunner
    ? `cairn-owned-${name.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 40)}-${process.pid}-${id.slice(0, 8)}`
    : undefined;
  const childEnv = {
    ...env,
    [OWNER_ENV]: [...(env[OWNER_ENV] ?? '').split(',').filter(Boolean), id].join(','),
  };
  const busEnv = Object.fromEntries(
    SYSTEMD_BUS_ENV.filter((key) => process.env[key] !== undefined).map((key) => [
      key,
      process.env[key],
    ]),
  );
  const restoreEnv = [...SYSTEMD_BUS_ENV, 'INVOCATION_ID'].filter(
    (key) => childEnv[key] === undefined,
  );
  const wrapped = [
    ...(scopeRunner && restoreEnv.length > 0
      ? [onPath('env'), ...restoreEnv.flatMap((key) => ['-u', key])]
      : []),
    ...deathSignalPrefix(),
    command,
    ...args,
  ];
  const [file, ...fileArgs] = unit
    ? [
        scopeRunner,
        '--user',
        '--scope',
        '--quiet',
        '--collect',
        '--expand-environment=no',
        `--unit=${unit}`,
        `--property=RuntimeMaxSec=${maxRuntimeSec}`,
        '--',
        ...wrapped,
      ]
    : wrapped;
  const child = spawn(file, fileArgs, {
    cwd,
    env: scopeRunner ? { ...busEnv, ...childEnv } : childEnv,
    stdio,
    detached: true,
  });
  const target = { id, unit, pgid: child.pid, graceMs };
  const sentinel = spawn(
    process.execPath,
    [
      OWNED_PROCESS_CLI,
      '--sentinel',
      JSON.stringify({ target, chain, deadline: Date.now() + maxRuntimeSec * 1000 }),
    ],
    {
      stdio: ['pipe', 'ignore', 'ignore'],
      detached: true,
      env: Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== OWNER_ENV)),
    },
  );
  sentinel.on('error', () => {});
  const exited = new Promise((resolveExit) => {
    let settled = false;
    const settle = async (result) => {
      if (settled) return;
      settled = true;
      if (child.pid !== undefined) await killTarget(target);
      sentinel.kill('SIGKILL');
      sentinel.stdin.destroy();
      resolveExit(result);
    };
    child.once('exit', (code, signal) => settle({ code, signal }));
    child.once('error', (error) => settle({ code: null, signal: null, error }));
  });
  return {
    child,
    id,
    unit,
    exited,
    async stop() {
      if (child.pid !== undefined) await killTarget(target);
      return exited;
    },
  };
}

export function launchOwnedDetached(
  command,
  args = [],
  {
    cwd,
    env = process.env,
    stdio = 'ignore',
    name = basename(command),
    maxRuntimeSec = DEFAULT_MAX_RUNTIME_SEC,
  } = {},
) {
  const helper = spawn(
    process.execPath,
    [
      OWNED_PROCESS_CLI,
      '--owner-chain',
      JSON.stringify(ownerChain(process.pid, 'session')),
      '--name',
      name,
      '--max-runtime-sec',
      String(maxRuntimeSec),
      '--',
      command,
      ...args,
    ],
    { cwd, env, stdio, detached: true },
  );
  helper.unref();
  return helper;
}

export async function runOwned(command, args = [], { timeoutMs, ...options } = {}) {
  const owned = spawnOwned(command, args, options);
  let interruption = null;
  let timedOut = false;
  const handlers = FORWARDED_SIGNALS.map((signal) => {
    const handler = () => {
      interruption ??= signal;
      owned.stop();
    };
    process.on(signal, handler);
    return [signal, handler];
  });
  const timer =
    timeoutMs === undefined
      ? undefined
      : setTimeout(() => {
          timedOut = true;
          owned.stop();
        }, timeoutMs);
  const { code, signal, error } = await owned.exited;
  clearTimeout(timer);
  for (const [name, handler] of handlers) process.off(name, handler);
  if (error) {
    console.error(`[owned-process] ${command}: ${error.message}`);
    return 127;
  }
  if (timedOut) return 124;
  if (interruption) return 128 + osConstants.signals[interruption];
  return code ?? 128 + (osConstants.signals[signal] ?? 0);
}

function parseCli(argv) {
  const options = { owner: 'parent' };
  for (let i = 0; i < argv.length; i += 2) {
    const [flag, value] = [argv[i], argv[i + 1]];
    if (flag === '--') return { options, command: argv.slice(i + 1) };
    if (value === undefined) break;
    if (flag === '--owner' && (value === 'parent' || value === 'session')) options.owner = value;
    else if (flag === '--name') options.name = value;
    else if (flag === '--owner-chain') options.chain = JSON.parse(value);
    else if (flag === '--timeout-ms' && /^\d+$/.test(value)) options.timeoutMs = Number(value);
    else if (flag === '--max-runtime-sec' && /^[1-9]\d*$/.test(value))
      options.maxRuntimeSec = Number(value);
    else break;
  }
  return { options, command: [] };
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  if (process.argv[2] === '--sentinel') {
    const { target, chain, deadline } = JSON.parse(process.argv[3]);
    let helperGone = false;
    process.stdin.on('end', () => {
      helperGone = true;
    });
    process.stdin.resume();
    for (const signal of FORWARDED_SIGNALS) process.on(signal, () => {});
    while (
      !helperGone &&
      Date.now() < deadline &&
      chain.every(({ pid, start }) => processInfo(pid)?.start === start)
    )
      await sleep(POLL_MS);
    await killTarget(target);
    process.exit(0);
  }
  const { options, command } = parseCli(process.argv.slice(2));
  if (command.length === 0) {
    console.error(
      'Usage: node scripts/owned-process.mjs [--owner parent|session] [--name <label>] [--timeout-ms <n>] [--max-runtime-sec <n>] -- <command> [args...]',
    );
    process.exit(2);
  }
  process.exit(await runOwned(command[0], command.slice(1), options));
}
