import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { createServer, Socket } from 'node:net';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import type { OrbEnsureDeps, OrbEnsureService } from './services-ensure.js';
import { ensureOrbServices } from './services-ensure.js';
import { loadEnsureServicesFile } from './services-yaml.js';

export type EnsureCommandIo = {
  cwd: string;
  home: string;
  exists(path: string): boolean;
  readFile(path: string): string;
  writeOut(text: string): void;
  writeErr(text: string): void;
  deps?: OrbEnsureDeps;
};

export function createNodeEnsureDeps(stateDir: string): OrbEnsureDeps {
  mkdirSync(stateDir, { recursive: true });
  return {
    listPids: async (name) => {
      const pid = readLiveServicePid(join(stateDir, `${name}.pid`));
      return pid === null ? [] : [pid];
    },
    start: async (service, env) => {
      const child = spawn('/bin/bash', ['-lc', service.command], {
        cwd: service.cwd,
        env: { ...process.env, ...env },
        detached: true,
        stdio: 'ignore',
      });
      if (child.pid === undefined) throw new Error(`service ${service.name} failed to start`);
      child.unref();
      await persistServicePid(join(stateDir, `${service.name}.pid`), child.pid);
      return child.pid;
    },
    waitForPort,
    healthStatus: fetchHealthStatus,
    allocatePort: async () => {
      const server = createServer();
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => resolve());
      });
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      await new Promise<void>((resolve) => server.close(() => resolve()));
      return port;
    },
    lastPort: async (name) => {
      const n = Number(readPidText(join(stateDir, `${name}.port`)));
      return Number.isInteger(n) && n > 0 ? n : null;
    },
    savePort: async (name, port) => {
      writeFileSync(join(stateDir, `${name}.port`), `${port}\n`);
    },
    listeningPid,
    ownsPort: async (pid, port) => {
      const listener = await listeningPid(port);
      return listener !== null && isInProcessTree(listener, pid);
    },
    now: () => Date.now(),
    sleep: async (ms) => {
      await new Promise((resolve) => setTimeout(resolve, ms));
    },
    readinessMs: 60_000,
    withLock: async (fn) => withEnsureFileLock(join(stateDir, 'ensure.lock'), fn),
  };
}

export function orbServiceStateDir(home: string, servicesFile: string): string {
  const key = createHash('sha256').update(servicesFile).digest('hex').slice(0, 16);
  return join(home, 'orb-services', key);
}

export async function fetchHealthStatus(url: string): Promise<number | null> {
  try {
    const response = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(2000),
    });
    return response.status;
  } catch {
    return null;
  }
}

export function defaultEnsureCommandIo(): EnsureCommandIo {
  const home = process.env.CAIRN_HOME ?? join(homedir(), '.cairn');
  return {
    cwd: process.cwd(),
    home,
    exists: existsSync,
    readFile: (path) => readFileSync(path, 'utf8'),
    writeOut: (text) => {
      process.stdout.write(text);
    },
    writeErr: (text) => {
      process.stderr.write(text);
    },
  };
}

export async function runOrbServicesEnsure(
  opts: { json?: boolean; file?: string },
  io: EnsureCommandIo = defaultEnsureCommandIo(),
): Promise<number> {
  const file = resolveServicesFile(opts.file ?? '.agents/services.yaml', io.cwd);
  if (!io.exists(file)) {
    io.writeErr(`services file not found: ${file}\n`);
    return 1;
  }
  const deps = io.deps ?? createNodeEnsureDeps(orbServiceStateDir(io.home, file));
  let services: OrbEnsureService[];
  try {
    services = loadEnsureServicesFile(io.readFile(file));
  } catch (err) {
    io.writeErr(`${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }
  const result = await ensureOrbServices(services, deps);
  if (opts.json === true) {
    io.writeOut(`${JSON.stringify(result)}\n`);
  } else {
    for (const row of result.services) {
      if (row.error === 'NOT RESPONDING') {
        io.writeErr(`${row.name} NOT RESPONDING\n`);
        continue;
      }
      const url = row.url === undefined ? '' : ` ${row.url}`;
      io.writeOut(`${row.name} ${row.ready ? 'ready' : 'not-ready'}${url}\n`);
    }
  }
  return result.ok ? 0 : 1;
}

function resolveServicesFile(file: string, cwd: string): string {
  return isAbsolute(file) ? file : join(cwd, file);
}

async function waitForPort(port: number, deadlineMs: number): Promise<boolean> {
  while (Date.now() < deadlineMs) {
    const open = await new Promise<boolean>((resolve) => {
      const client = new Socket();
      let settled = false;
      const finish = (value: boolean) => {
        if (settled) return;
        settled = true;
        client.destroy();
        resolve(value);
      };
      client.setTimeout(100);
      client.once('connect', () => finish(true));
      client.once('timeout', () => finish(false));
      client.once('error', () => finish(false));
      client.connect(port, '127.0.0.1');
    });
    if (open) return true;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return false;
}

function readPidText(path: string): string {
  if (!existsSync(path)) return '';
  return readFileSync(path, 'utf8').trim();
}

export function processStartTime(pid: number): number | null {
  try {
    const status = readFileSync(`/proc/${pid}/stat`, 'utf8');
    const close = status.lastIndexOf(')');
    if (close < 0) return null;
    const start = Number(status.slice(close + 2).split(' ')[19]);
    return Number.isInteger(start) ? start : null;
  } catch {
    return null;
  }
}

export function readLiveServicePid(path: string): number | null {
  const parts = readPidText(path).split(/\s+/);
  const pid = Number(parts[0]);
  const start = Number(parts[1]);
  if (!Number.isInteger(pid) || pid <= 0 || !Number.isInteger(start) || parts[1] === undefined) {
    return null;
  }
  try {
    process.kill(pid, 0);
  } catch {
    return null;
  }
  return processStartTime(pid) === start ? pid : null;
}

async function persistServicePid(path: string, pid: number): Promise<void> {
  for (let i = 0; i < 50; i += 1) {
    const start = processStartTime(pid);
    if (start !== null) {
      writeFileSync(path, `${pid} ${start}\n`);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`service pid ${pid} vanished before identity was recorded`);
}

function isExistError(err: unknown): boolean {
  return err instanceof Error && 'code' in err && err.code === 'EEXIST';
}

function tryClaimEnsureLock(lockPath: string): boolean {
  const start = processStartTime(process.pid);
  if (start === null) throw new Error('ensure lock identity unavailable');
  try {
    writeFileSync(lockPath, `${process.pid} ${start}\n`, { flag: 'wx' });
    return true;
  } catch (err) {
    if (!isExistError(err)) throw err;
    if (readLiveServicePid(lockPath) !== null) return false;
    try {
      unlinkSync(lockPath);
    } catch {}
    return false;
  }
}

export async function withEnsureFileLock<T>(
  lockPath: string,
  fn: () => Promise<T>,
  sleep: (ms: number) => Promise<void> = async (ms) => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  },
): Promise<T> {
  for (;;) {
    if (tryClaimEnsureLock(lockPath)) break;
    await sleep(20);
  }
  try {
    return await fn();
  } finally {
    try {
      unlinkSync(lockPath);
    } catch {}
  }
}

async function listeningPid(port: number): Promise<number | null> {
  return findListeningPid(port);
}

function findListeningPid(port: number): number | null {
  const hexPort = port.toString(16).toUpperCase().padStart(4, '0');
  const inodes = new Set<string>();
  for (const table of ['/proc/net/tcp', '/proc/net/tcp6']) {
    if (!existsSync(table)) continue;
    for (const line of readFileSync(table, 'utf8').split('\n').slice(1)) {
      const cols = line.trim().split(/\s+/);
      const local = cols[1];
      const st = cols[3];
      const inode = cols[9];
      if (local === undefined || st !== '0A' || inode === undefined) continue;
      const colon = local.lastIndexOf(':');
      if (colon < 0) continue;
      if (local.slice(colon + 1).toUpperCase() !== hexPort) continue;
      inodes.add(inode);
    }
  }
  if (inodes.size === 0) return null;
  try {
    for (const pidName of readdirSync('/proc')) {
      if (!/^\d+$/.test(pidName)) continue;
      const fdDir = join('/proc', pidName, 'fd');
      if (!existsSync(fdDir)) continue;
      let fds: string[];
      try {
        fds = readdirSync(fdDir);
      } catch {
        continue;
      }
      for (const fd of fds) {
        try {
          const target = readlinkSync(join(fdDir, fd));
          const match = /^socket:\[(\d+)\]$/.exec(target);
          const inode = match?.[1];
          if (inode !== undefined && inodes.has(inode)) return Number(pidName);
        } catch {}
      }
    }
  } catch {
    return null;
  }
  return null;
}

function isInProcessTree(candidate: number, ancestor: number): boolean {
  if (candidate === ancestor) return true;
  const seen = new Set<number>();
  let current = candidate;
  while (current > 1 && !seen.has(current)) {
    seen.add(current);
    current = parentPid(current);
    if (current === ancestor) return true;
  }
  return false;
}

function parentPid(pid: number): number {
  try {
    const status = readFileSync(`/proc/${pid}/stat`, 'utf8');
    const close = status.lastIndexOf(')');
    if (close < 0) return 0;
    const rest = status.slice(close + 2).split(' ');
    const ppid = Number(rest[1]);
    return Number.isInteger(ppid) ? ppid : 0;
  } catch {
    return 0;
  }
}
