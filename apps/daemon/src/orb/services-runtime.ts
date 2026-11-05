import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
  deps: OrbEnsureDeps;
};

export function createNodeEnsureDeps(stateDir: string): OrbEnsureDeps {
  mkdirSync(stateDir, { recursive: true });
  return {
    listPids: async (name) => {
      const pid = readPid(join(stateDir, `${name}.pid`));
      if (pid === null) return [];
      try {
        process.kill(pid, 0);
        return [pid];
      } catch {
        return [];
      }
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
      writeFileSync(join(stateDir, `${service.name}.pid`), `${child.pid}\n`);
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
    now: () => Date.now(),
    sleep: async (ms) => {
      await new Promise((resolve) => setTimeout(resolve, ms));
    },
    readinessMs: 60_000,
  };
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
    deps: createNodeEnsureDeps(join(home, 'orb-services')),
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
  let services: OrbEnsureService[];
  try {
    services = loadEnsureServicesFile(io.readFile(file));
  } catch (err) {
    io.writeErr(`${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }
  const result = await ensureOrbServices(services, io.deps);
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

function readPid(path: string): number | null {
  const n = Number(readPidText(path));
  return Number.isInteger(n) && n > 0 ? n : null;
}

function readPidText(path: string): string {
  if (!existsSync(path)) return '';
  return readFileSync(path, 'utf8').trim();
}
