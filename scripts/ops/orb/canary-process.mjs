import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { closeSync, openSync, readFileSync, realpathSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

export async function withCleanup(work) {
  const cleanups = [];
  const errors = [];
  let value;
  try {
    value = await work((cleanup) => cleanups.push(cleanup));
  } catch (error) {
    errors.push(error);
  } finally {
    for (const cleanup of cleanups.reverse()) {
      try {
        await cleanup();
      } catch (error) {
        errors.push(error);
      }
    }
  }
  if (errors.length) throw new Error(errors.map((error) => error.message).join('; '));
  return value;
}

export function runCommand(
  command,
  args,
  {
    cwd,
    env = process.env,
    signal,
    timeout = 120000,
    maxBuffer = 1024 * 1024,
    detached = false,
  } = {},
) {
  return new Promise((resolveCommand, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      signal,
      detached,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const timer = timeout === null ? undefined : setTimeout(() => child.kill('SIGKILL'), timeout);
    let stdout = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
      if (stdout.length > maxBuffer) child.kill('SIGKILL');
    });
    child.stderr.resume();
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(new Error(`${command} unavailable (${error.code ?? 'error'})`));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0 || stdout.length > maxBuffer)
        reject(new Error(`${command} ${args[0]} failed (${code ?? 'signal'})`));
      else resolveCommand(stdout);
    });
  });
}

export async function poll(check, { signal, timeout = 120000, label = 'operation' } = {}) {
  const deadline = Date.now() + timeout;
  while (true) {
    signal?.throwIfAborted();
    const result = await check();
    if (result) return result;
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${label}`);
    await delay(100, undefined, { signal });
  }
}

export async function stopChild(
  child,
  cwd,
  entry,
  { platform = process.platform, read = readFileSync } = {},
) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (platform === 'linux') {
    let raw;
    try {
      raw = read(`/proc/${child.pid}/cmdline`, 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
    if (!raw) return;
    const command = raw.split('\0');
    if (!command.includes(entry) || realpathSync(`/proc/${child.pid}/cwd`) !== realpathSync(cwd))
      throw new Error('Refusing to stop a process with a different command or directory');
  }
  child.kill('SIGTERM');
  try {
    await poll(() => child.exitCode !== null || child.signalCode !== null, {
      timeout: 10000,
      label: 'scratch process stop',
    });
  } catch {
    child.kill('SIGKILL');
    await poll(() => child.exitCode !== null || child.signalCode !== null, {
      timeout: 5000,
      label: 'scratch process kill',
    });
  }
}

function processStart(pid) {
  if (process.platform === 'linux') {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    return `linux:${stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19]}`;
  }
  return execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], { encoding: 'utf8' }).trim();
}

export function childRecord(child, cwd, entry) {
  if (!Number.isSafeInteger(child.pid) || child.pid <= 0)
    throw new Error('Scratch child did not start');
  return {
    kind: 'child',
    pid: child.pid,
    cwd: realpathSync(cwd),
    entry,
    startTime: processStart(child.pid),
  };
}

export function spawnRecordedChild(cwd, entry, args, env, record) {
  const logDir = process.env.CAIRN_CANARY_LOG_DIR;
  const log = logDir
    ? openSync(
        join(
          logDir,
          `${basename(cwd)}-${args.find((arg) => arg.startsWith('canary-')) ?? 'server'}-${Date.now()}.log`,
        ),
        'wx',
        0o600,
      )
    : 'ignore';
  const child = spawn(process.execPath, ['--import', 'tsx', entry, ...args], {
    cwd,
    env,
    stdio: ['ignore', log, log],
    detached: true,
  });
  if (typeof log === 'number') closeSync(log);
  child.on('error', () => {});
  try {
    record(childRecord(child, cwd, entry));
  } catch (error) {
    child.kill('SIGTERM');
    throw error;
  }
  return child;
}

function recordedChildRunning(record) {
  try {
    const started = processStart(record.pid);
    if (!started) return false;
    if (started !== record.startTime) return false;
    let command;
    let cwd;
    if (process.platform === 'linux') {
      command = readFileSync(`/proc/${record.pid}/cmdline`, 'utf8');
      if (!command) return false;
      command = command.split('\0');
      cwd = realpathSync(`/proc/${record.pid}/cwd`);
    } else {
      command = execFileSync('ps', ['-o', 'command=', '-p', String(record.pid)], {
        encoding: 'utf8',
      })
        .trim()
        .split(/\s+/);
      cwd = execFileSync('lsof', ['-a', '-p', String(record.pid), '-d', 'cwd', '-Fn'], {
        encoding: 'utf8',
      })
        .split('\n')
        .find((line) => line.startsWith('n'))
        ?.slice(1);
    }
    if (!command.includes(record.entry) || cwd !== realpathSync(record.cwd))
      throw new Error('Refusing to stop a process with a different command or directory');
    return true;
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ESRCH') return false;
    if (error.status === 1) {
      try {
        process.kill(record.pid, 0);
      } catch (probe) {
        if (probe.code === 'ESRCH') return false;
      }
    }
    throw error;
  }
}

export function stopRecordedChildSync(record) {
  const result = spawnSync(
    process.execPath,
    [import.meta.filename, '--stop', JSON.stringify(record)],
    { encoding: 'utf8', timeout: 20000 },
  );
  if (result.status !== 0)
    throw new Error(result.stderr.trim() || 'Recorded scratch process cleanup failed');
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  const record = JSON.parse(process.argv[3]);
  const child = {
    pid: record.pid,
    get exitCode() {
      return recordedChildRunning(record) ? null : 0;
    },
    signalCode: null,
    kill(signal) {
      if (recordedChildRunning(record)) process.kill(record.pid, signal);
    },
  };
  await stopChild(child, record.cwd, record.entry);
}
