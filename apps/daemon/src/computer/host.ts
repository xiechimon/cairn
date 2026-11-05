import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import {
  chmod,
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
} from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { COMPUTER_MARKER_ENV, ProcessTree } from './process-tree.js';
import {
  type ComputerExecuteRequest,
  type ComputerFileEntry,
  type ComputerProcessEvent,
  type ComputerProvider,
  ComputerRefusal,
} from './provider.js';

export const HOST_MAX_FILE_BYTES = 8 * 1024 * 1024;
export const HOST_KILL_GRACE_MS = 1_000;
const STREAM_DRAIN_MS = 100;

const INHERITED_ENV = new Set(
  [
    'PATH',
    'HOME',
    'USER',
    'LOGNAME',
    'SHELL',
    'LANG',
    'LANGUAGE',
    'TERM',
    'TZ',
    'TMPDIR',
    'DISPLAY',
    'WAYLAND_DISPLAY',
    'XDG_RUNTIME_DIR',
    'DBUS_SESSION_BUS_ADDRESS',
    'HTTP_PROXY',
    'HTTPS_PROXY',
    'NO_PROXY',
    'ALL_PROXY',
    'SSH_AUTH_SOCK',
    'SSL_CERT_FILE',
    'SSL_CERT_DIR',
    'NODE_EXTRA_CA_CERTS',
    'REQUESTS_CA_BUNDLE',
    'CURL_CA_BUNDLE',
    'GIT_SSL_CAINFO',
  ].map((name) => name.toUpperCase()),
);

export interface HostComputerOptions {
  home?: string;
  env?: NodeJS.ProcessEnv;
  killGraceMs?: number;
  streamDrainMs?: number;
  maxFileBytes?: number;
}

export function hostCommandEnvironment(
  inherited: NodeJS.ProcessEnv,
  requested: Readonly<Record<string, string>> = {},
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(inherited)) {
    const key = name.toUpperCase();
    if (value !== undefined && (INHERITED_ENV.has(key) || key.startsWith('LC_'))) env[name] = value;
  }
  return { ...env, ...requested };
}

function isInside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return (
    relative === '' ||
    !(relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
  );
}

class AsyncEventQueue {
  private readonly items: ComputerProcessEvent[] = [];
  private wake: (() => void) | undefined;
  private ended = false;

  push(event: ComputerProcessEvent): void {
    this.items.push(event);
    this.notify();
  }

  end(): void {
    this.ended = true;
    this.notify();
  }

  private notify(): void {
    const wake = this.wake;
    this.wake = undefined;
    wake?.();
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<ComputerProcessEvent> {
    while (true) {
      const next = this.items.shift();
      if (next) {
        yield next;
        continue;
      }
      if (this.ended) return;
      await new Promise<void>((resolve) => {
        this.wake = resolve;
      });
    }
  }
}

function immediate(events: ComputerProcessEvent[]): AsyncIterable<ComputerProcessEvent> {
  return (async function* () {
    yield* events;
  })();
}

export class HostComputerProvider implements ComputerProvider {
  private readonly home: string;
  private readonly env: NodeJS.ProcessEnv;
  private readonly killGraceMs: number;
  private readonly streamDrainMs: number;
  private readonly maxFileBytes: number;
  private readonly running = new Set<{ stop: () => Promise<void> }>();

  constructor(options: HostComputerOptions = {}) {
    this.home = path.resolve(options.home ?? homedir());
    this.env = options.env ?? process.env;
    this.killGraceMs = options.killGraceMs ?? HOST_KILL_GRACE_MS;
    this.streamDrainMs = options.streamDrainMs ?? STREAM_DRAIN_MS;
    this.maxFileBytes = options.maxFileBytes ?? HOST_MAX_FILE_BYTES;
  }

  async killAll(): Promise<void> {
    await Promise.all([...this.running].map((command) => command.stop()));
  }

  private async realHome(): Promise<string> {
    return realpath(this.home);
  }

  private async resolveInHome(requested: string | undefined, label: string): Promise<string> {
    const text = (requested ?? '').trim();
    if (text.includes('\0')) throw new ComputerRefusal(`${label} contains a null byte`);
    const realHome = await this.realHome();
    let expanded = text;
    if (text === '' || text === '~') expanded = this.home;
    else if (text.startsWith('~/')) expanded = path.join(this.home, text.slice(2));
    const resolved = path.resolve(this.home, expanded);
    if (!isInside(this.home, resolved) && !isInside(realHome, resolved)) {
      throw new ComputerRefusal(
        `${label} must be inside the home folder; cd elsewhere within the command`,
      );
    }
    let existing = resolved;
    const missing: string[] = [];
    while (true) {
      try {
        existing = await realpath(existing);
        break;
      } catch (error) {
        const parent = path.dirname(existing);
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || parent === existing) {
          throw new ComputerRefusal(`${label} cannot be resolved`);
        }
        missing.unshift(path.basename(existing));
        existing = parent;
      }
    }
    if (!isInside(realHome, existing)) {
      throw new ComputerRefusal(`${label} resolves outside the home folder`);
    }
    return path.join(existing, ...missing);
  }

  async execute(request: ComputerExecuteRequest): Promise<AsyncIterable<ComputerProcessEvent>> {
    const deadlineAt = Date.now() + request.timeoutMs;
    const timeoutMessage = `command timed out after ${request.timeoutMs} ms; process tree killed`;
    const cwd = await this.resolveInHome(request.cwd, 'cwd');
    const info = await stat(cwd).catch(() => undefined);
    if (!info?.isDirectory()) throw new ComputerRefusal('cwd is not an existing directory');
    const [command, ...args] = request.argv;
    if (!command) throw new ComputerRefusal('empty command');
    if (request.signal.aborted) {
      return immediate([
        { kind: 'stderr', text: 'command aborted\n' },
        { kind: 'exit', code: 130, reason: 'aborted' },
      ]);
    }
    const remaining = deadlineAt - Date.now();
    if (remaining <= 0) {
      return immediate([
        { kind: 'stderr', text: `${timeoutMessage}\n` },
        { kind: 'exit', code: 124, reason: 'timeout' },
      ]);
    }

    const marker = randomBytes(12).toString('hex');
    const env = {
      ...hostCommandEnvironment(this.env, request.env),
      [COMPUTER_MARKER_ENV]: marker,
    };
    const child = spawn(command, args, {
      cwd,
      env,
      detached: true,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const tree = child.pid ? new ProcessTree(child.pid, marker, this.killGraceMs) : undefined;
    const queue = new AsyncEventQueue();
    let settled = false;
    let stopping: Promise<void> | undefined;

    const finish = (code: number, reason?: 'timeout' | 'aborted', note?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      request.signal.removeEventListener('abort', abort);
      this.running.delete(handle);
      child.stdout?.destroy();
      child.stderr?.destroy();
      if (note) queue.push({ kind: 'stderr', text: `${note}\n` });
      queue.push({ kind: 'exit', code, ...(reason ? { reason } : {}) });
      queue.end();
    };
    const stop = (): Promise<void> => {
      stopping ??= (tree ? tree.kill() : Promise.resolve()).then(() => {
        child.stdout?.destroy();
        child.stderr?.destroy();
      });
      return stopping;
    };
    const terminate = async (code: number, reason: 'timeout' | 'aborted', note: string) => {
      if (settled) return;
      await stop();
      finish(code, reason, note);
    };
    const abort = () => void terminate(130, 'aborted', 'command aborted');
    const timeout = setTimeout(() => void terminate(124, 'timeout', timeoutMessage), remaining);
    timeout.unref();
    const handle = { stop: () => terminate(130, 'aborted', 'command stopped') };
    this.running.add(handle);
    request.signal.addEventListener('abort', abort, { once: true });

    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (text: string) => {
      if (!settled && !stopping) queue.push({ kind: 'stdout', text });
    });
    child.stderr?.on('data', (text: string) => {
      if (!settled && !stopping) queue.push({ kind: 'stderr', text });
    });
    child.on('error', (error) => {
      if (settled) return;
      queue.push({ kind: 'stderr', text: `${error.message}\n` });
      finish(1);
    });
    child.on('exit', (code, signal) => {
      clearTimeout(timeout);
      setTimeout(() => {
        if (stopping) return;
        finish(code ?? 1, undefined, signal ? `command terminated by ${signal}` : undefined);
      }, this.streamDrainMs).unref();
    });
    return queue;
  }

  async listFiles(requested: string): Promise<ComputerFileEntry[]> {
    const directory = await this.resolveInHome(requested, 'path');
    const realHome = await this.realHome();
    const entries = await readdir(directory, { withFileTypes: true });
    const listed = await Promise.all(
      entries.map(async (entry): Promise<ComputerFileEntry | undefined> => {
        const child = path.join(directory, entry.name);
        const real = await realpath(child).catch(() => undefined);
        if (real === undefined || !isInside(realHome, real)) return undefined;
        const info = await stat(real);
        return {
          path: path.relative(realHome, child),
          kind: info.isDirectory() ? 'dir' : 'file',
          size: info.size,
          ...(info.isFile() && info.mode & 0o100 ? { executable: true as const } : {}),
        };
      }),
    );
    return listed
      .filter((entry): entry is ComputerFileEntry => entry !== undefined)
      .sort((a, b) => a.path.localeCompare(b.path));
  }

  async readFile(requested: string): Promise<string> {
    const target = await this.resolveInHome(requested, 'path');
    const info = await stat(target).catch(() => undefined);
    if (!info) throw new ComputerRefusal('file not found');
    if (!info.isFile()) throw new ComputerRefusal('path is not a regular file');
    if (info.size > this.maxFileBytes) {
      throw new ComputerRefusal(`file exceeds ${this.maxFileBytes} bytes`);
    }
    const bytes = await readFile(target);
    if (bytes.byteLength > this.maxFileBytes) {
      throw new ComputerRefusal(`file exceeds ${this.maxFileBytes} bytes`);
    }
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      throw new ComputerRefusal('file is not valid UTF-8');
    }
  }

  async writeFile(requested: string, content: string): Promise<void> {
    const bytes = Buffer.from(content, 'utf8');
    if (bytes.byteLength > this.maxFileBytes) {
      throw new ComputerRefusal(`content exceeds ${this.maxFileBytes} bytes`);
    }
    const target = await this.resolveInHome(requested, 'path');
    if (target === (await this.realHome())) throw new ComputerRefusal('path is the home folder');
    const existing = await lstat(target).catch(() => undefined);
    if (existing && !existing.isFile()) throw new ComputerRefusal('path is not a regular file');
    const directory = path.dirname(target);
    await mkdir(directory, { recursive: true });
    if (!isInside(await this.realHome(), await realpath(directory))) {
      throw new ComputerRefusal('path resolves outside the home folder');
    }
    const temporary = path.join(directory, `.cairn-write-${randomBytes(8).toString('hex')}`);
    const handle = await open(
      temporary,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0),
      0o600,
    );
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      if (existing) await chmod(temporary, existing.mode & 0o777);
      await rename(temporary, target);
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
  }
}
