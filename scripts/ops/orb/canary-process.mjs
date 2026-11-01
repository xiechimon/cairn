import { spawn } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
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

export async function stopChild(child, cwd, entry) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'linux') {
    const command = readFileSync(`/proc/${child.pid}/cmdline`, 'utf8').split('\0');
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
