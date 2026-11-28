import { execFile, spawn } from 'node:child_process';
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';
import {
  accessSync,
  chmodSync,
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  linkSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  type Stats,
  statSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import { basename, delimiter, dirname, isAbsolute, join, relative, sep } from 'node:path';
import {
  WORKSPACE_FILE_LIMIT,
  type WorkspaceFileResult,
  workspaceFilePathSchema,
  workspaceFileResultSchema,
} from '@cairn/shared';
import { ensurePrivateDir } from './private-fs.js';

const KEY_BYTES = 32;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const INSTANCE_AAD = Buffer.from('cairn.workspace-file.instance.v1');
const ENCRYPTION_KEY_LABEL = 'cairn.workspace-file.encryption-key.v1';
const NONCE_KEY_LABEL = 'cairn.workspace-file.nonce-key.v1';
const INSTANCE_MAX_CHARS = 8192;
const HELPER_TIMEOUT_MS = 5_000;
const HELPER_MAX_CONCURRENT = 4;
const PROBE_RETRY_MS = 60_000;
const PROBE_MISSING_NAME = '.cairn-workspace-file-probe-missing';
const MAC_STUB_PYTHON = '/usr/bin/python3';
const FALLBACK_BIN_DIRECTORIES = ['/usr/local/bin', '/opt/homebrew/bin', '/usr/bin'];

const EXIT_GONE = 3;
const EXIT_UNSUPPORTED = 4;

export const WORKSPACE_FILE_HELPER_ARGS = ['-I', '-S', '-c'] as const;

export const WORKSPACE_FILE_HELPER_SOURCE = [
  'import errno, os, stat, sys',
  'GONE, UNSUPPORTED, UNAVAILABLE = 3, 4, 5',
  'DIRECTORY = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC',
  'FILE = os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_NOCTTY | os.O_CLOEXEC',
  'REFUSED = (errno.ELOOP, errno.ENOTDIR, errno.ENXIO, errno.EACCES, errno.EPERM, errno.EOPNOTSUPP)',
  'def refusal(error, name, parent):',
  '    if error.errno == errno.ENOENT:',
  '        return GONE',
  '    if error.errno in REFUSED:',
  '        try:',
  '            os.stat(name, dir_fd=parent, follow_symlinks=False)',
  '        except OSError:',
  '            return GONE',
  '        return UNSUPPORTED',
  '    return UNAVAILABLE',
  'def read(limit, parts):',
  '    root = 3',
  '    if not stat.S_ISDIR(os.fstat(root).st_mode):',
  '        return UNAVAILABLE, b""',
  '    current = root',
  '    for name in parts[:-1]:',
  '        try:',
  '            following = os.open(name, DIRECTORY, dir_fd=current)',
  '        except OSError as error:',
  '            return refusal(error, name, current), b""',
  '        if current != root:',
  '            os.close(current)',
  '        current = following',
  '    name = parts[-1]',
  '    try:',
  '        fd = os.open(name, FILE, dir_fd=current)',
  '    except OSError as error:',
  '        return refusal(error, name, current), b""',
  '    info = os.fstat(fd)',
  '    if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_size > limit:',
  '        return UNSUPPORTED, b""',
  '    chunks = []',
  '    total = 0',
  '    while total <= limit:',
  '        chunk = os.read(fd, limit + 1 - total)',
  '        if not chunk:',
  '            break',
  '        chunks.append(chunk)',
  '        total += len(chunk)',
  '    if total > limit:',
  '        return UNSUPPORTED, b""',
  '    after = os.fstat(fd)',
  '    if after.st_nlink != 1 or after.st_ino != info.st_ino or after.st_dev != info.st_dev:',
  '        return UNSUPPORTED, b""',
  '    return 0, b"".join(chunks)',
  'def main():',
  '    try:',
  '        limit = int(sys.argv[1])',
  '        parts = sys.argv[2].split("/")',
  '        if any(part in ("", ".", "..") or "\\\\" in part for part in parts):',
  '            return UNSUPPORTED, b""',
  '        return read(limit, parts)',
  '    except BaseException:',
  '        return UNAVAILABLE, b""',
  'code, data = main()',
  'if code == 0:',
  '    sys.stdout.buffer.write(data)',
  '    sys.stdout.buffer.flush()',
  'sys.exit(code)',
].join('\n');

interface RootIdentity {
  dev: bigint;
  ino: bigint;
  birth: bigint;
}

interface InstancePayload {
  root: string;
  identity: RootIdentity;
}

type RootOpened =
  | { kind: 'ok'; fd: number; identity: RootIdentity }
  | { kind: 'missing' }
  | { kind: 'failed' };

export interface WorkspaceFileServiceOptions {
  keyPath: string;
  log?: (line: string) => void;
  onSupportChange?: () => void;
  candidates?: readonly string[];
  spawnHelper?: typeof spawn;
  timeoutMs?: number;
  maxConcurrent?: number;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  now?: () => number;
}

export interface WorkspaceFileService {
  supported(): boolean;
  probe(): Promise<boolean>;
  bind(root: string): string | null;
  read(instance: string, path: string, signal?: AbortSignal): Promise<WorkspaceFileResult>;
}

function decodeText(bytes: Buffer): WorkspaceFileResult {
  if (bytes.byteLength > WORKSPACE_FILE_LIMIT) return { status: 'unsupported' };
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return { status: 'unsupported' };
  }
  const parsed = workspaceFileResultSchema.safeParse({ status: 'ok', text });
  return parsed.success ? parsed.data : { status: 'unsupported' };
}

function readKeyFile(path: string): Buffer | null {
  try {
    const info = lstatSync(path);
    if (!info.isFile()) throw new Error('workspace file key is not a regular file');
    const material = /^[0-9a-f]{64}\s*$/.exec(readFileSync(path, 'utf8'));
    if (material === null)
      throw new Error('workspace file key is unreadable and was left untouched');
    if ((info.mode & 0o077) !== 0) chmodSync(path, 0o600);
    return Buffer.from(material[0].trim(), 'hex');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

function loadOrCreateKey(path: string): Buffer {
  const existing = readKeyFile(path);
  if (existing !== null) return existing;
  ensurePrivateDir(dirname(path));
  const fresh = randomBytes(KEY_BYTES);
  const temporary = `${path}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  const fd = openSync(
    temporary,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o600,
  );
  try {
    writeSync(fd, `${fresh.toString('hex')}\n`);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  try {
    linkSync(temporary, path);
    return fresh;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    const raced = readKeyFile(path);
    if (raced === null) throw error;
    return raced;
  } finally {
    unlinkSync(temporary);
  }
}

function openRoot(root: string): RootOpened {
  let fd: number;
  try {
    fd = openSync(root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === 'ENOENT' || code === 'ENOTDIR' || code === 'ELOOP'
      ? { kind: 'missing' }
      : { kind: 'failed' };
  }
  try {
    const info = fstatSync(fd, { bigint: true });
    if (!info.isDirectory()) {
      closeSync(fd);
      return { kind: 'missing' };
    }
    return {
      kind: 'ok',
      fd,
      identity: { dev: info.dev, ino: info.ino, birth: info.birthtimeNs },
    };
  } catch {
    closeSync(fd);
    return { kind: 'failed' };
  }
}

function sameIdentity(a: RootIdentity, b: RootIdentity): boolean {
  return a.dev === b.dev && a.ino === b.ino && a.birth === b.birth;
}

function isInside(root: string, target: string): boolean {
  const relation = relative(root, target);
  return (
    relation !== '' &&
    relation !== '..' &&
    !relation.startsWith(`..${sep}`) &&
    !isAbsolute(relation)
  );
}

const KNOWN_GROUP_WRITABLE: ReadonlySet<string> = new Set([
  '/usr/local',
  '/usr/local/bin',
  '/usr/local/Cellar',
  '/opt/homebrew',
  '/opt/homebrew/bin',
  '/opt/homebrew/Cellar',
]);

function trustedOwner(info: Stats): boolean {
  const uid = process.getuid?.();
  return info.uid === 0 || uid === undefined || info.uid === uid;
}

function trustedExecutable(candidate: string): string | null {
  if (!isAbsolute(candidate)) return null;
  try {
    const real = realpathSync(candidate);
    accessSync(real, constants.X_OK);
    const info = statSync(real);
    if (!info.isFile() || !trustedOwner(info) || (info.mode & 0o022) !== 0) return null;
    for (let directory = dirname(real); ; directory = dirname(directory)) {
      const entry = statSync(directory);
      const writableByOthers =
        (entry.mode & (KNOWN_GROUP_WRITABLE.has(directory) ? 0o002 : 0o022)) !== 0;
      if (!trustedOwner(entry) || writableByOthers) return null;
      if (directory === dirname(directory)) break;
    }
    return real;
  } catch {
    return null;
  }
}

function defaultCandidates(env: NodeJS.ProcessEnv): string[] {
  const directories = [
    ...(env.PATH ?? '').split(delimiter).filter((entry) => isAbsolute(entry)),
    ...FALLBACK_BIN_DIRECTORIES,
  ];
  return [...new Set(directories.map((directory) => join(directory, 'python3')))];
}

interface HelperRun {
  code: number | null;
  stdout: Buffer;
  overflow: boolean;
}

function runHelper(
  launch: typeof spawn,
  python: string,
  args: readonly string[],
  options: { rootFd: number; timeoutMs: number; signal?: AbortSignal },
): Promise<HelperRun> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(new Error('aborted'));
      return;
    }
    const child = launch(
      python,
      [...WORKSPACE_FILE_HELPER_ARGS, WORKSPACE_FILE_HELPER_SOURCE, ...args],
      {
        env: {},
        cwd: '/',
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'ignore', options.rootFd],
      },
    );
    const chunks: Buffer[] = [];
    let size = 0;
    let overflow = false;
    let settled = false;
    const finish = (settle: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      settle();
    };
    const kill = () => {
      child.kill('SIGKILL');
    };
    const onAbort = () => {
      kill();
      finish(() => reject(new Error('aborted')));
    };
    const timer = setTimeout(() => {
      kill();
      finish(() => reject(new Error('helper timed out')));
    }, options.timeoutMs);
    options.signal?.addEventListener('abort', onAbort, { once: true });
    child.stdout?.on('data', (chunk: Buffer) => {
      size += chunk.byteLength;
      if (size > WORKSPACE_FILE_LIMIT + 1) {
        overflow = true;
        kill();
        return;
      }
      chunks.push(chunk);
    });
    child.on('error', (error) => finish(() => reject(error)));
    child.on('close', (code) =>
      finish(() => resolve({ code, stdout: Buffer.concat(chunks), overflow })),
    );
  });
}

export function createWorkspaceFileService(
  options: WorkspaceFileServiceOptions,
): WorkspaceFileService {
  const launch = options.spawnHelper ?? spawn;
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const now = options.now ?? Date.now;
  const timeoutMs = options.timeoutMs ?? HELPER_TIMEOUT_MS;
  const maxConcurrent = options.maxConcurrent ?? HELPER_MAX_CONCURRENT;
  let key: { encryption: Buffer; nonce: Buffer } | null = null;
  let python: string | null = null;
  let pendingProbe: Promise<boolean> | null = null;
  let lastFailureAt: number | null = null;
  let active = 0;

  const holdsKey = (root: string): boolean => {
    try {
      keys();
      const keyDirectory = realpathSync(dirname(options.keyPath));
      return isInside(root, join(keyDirectory, basename(options.keyPath)));
    } catch {
      return true;
    }
  };

  const keys = (): { encryption: Buffer; nonce: Buffer } => {
    if (key === null) {
      const master = loadOrCreateKey(options.keyPath);
      key = {
        encryption: createHmac('sha256', master).update(ENCRYPTION_KEY_LABEL).digest(),
        nonce: createHmac('sha256', master).update(NONCE_KEY_LABEL).digest(),
      };
    }
    return key;
  };

  const seal = (payload: InstancePayload): string | null => {
    const plaintext = Buffer.from(
      JSON.stringify({
        r: payload.root,
        d: payload.identity.dev.toString(),
        i: payload.identity.ino.toString(),
        b: payload.identity.birth.toString(),
      }),
      'utf8',
    );
    const { encryption, nonce: nonceKey } = keys();
    const nonce = createHmac('sha256', nonceKey)
      .update(plaintext)
      .digest()
      .subarray(0, NONCE_BYTES);
    const cipher = createCipheriv('aes-256-gcm', encryption, nonce);
    cipher.setAAD(INSTANCE_AAD);
    const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const instance = Buffer.concat([nonce, cipher.getAuthTag(), body]).toString('base64url');
    return instance.length <= INSTANCE_MAX_CHARS ? instance : null;
  };

  const open = (instance: string): InstancePayload | null => {
    if (instance.length > INSTANCE_MAX_CHARS) return null;
    const raw = Buffer.from(instance, 'base64url');
    if (raw.toString('base64url') !== instance || raw.byteLength <= NONCE_BYTES + TAG_BYTES) {
      return null;
    }
    try {
      const decipher = createDecipheriv(
        'aes-256-gcm',
        keys().encryption,
        raw.subarray(0, NONCE_BYTES),
      );
      decipher.setAAD(INSTANCE_AAD);
      decipher.setAuthTag(raw.subarray(NONCE_BYTES, NONCE_BYTES + TAG_BYTES));
      const text = Buffer.concat([
        decipher.update(raw.subarray(NONCE_BYTES + TAG_BYTES)),
        decipher.final(),
      ]).toString('utf8');
      const parsed = JSON.parse(text) as { r?: unknown; d?: unknown; i?: unknown; b?: unknown };
      if (
        typeof parsed.r !== 'string' ||
        !isAbsolute(parsed.r) ||
        typeof parsed.d !== 'string' ||
        typeof parsed.i !== 'string' ||
        typeof parsed.b !== 'string'
      ) {
        return null;
      }
      return {
        root: parsed.r,
        identity: { dev: BigInt(parsed.d), ino: BigInt(parsed.i), birth: BigInt(parsed.b) },
      };
    } catch {
      return null;
    }
  };

  const macToolsInstalled = (): Promise<boolean> =>
    new Promise((resolve) => {
      execFile('/usr/bin/xcode-select', ['-p'], { timeout: 3_000, env: {} }, (error) =>
        resolve(error === null),
      );
    });

  const works = async (listed: string): Promise<boolean> => {
    const candidate = trustedExecutable(listed);
    if (candidate === null) return false;
    if (platform === 'darwin' && listed === MAC_STUB_PYTHON && !(await macToolsInstalled())) {
      return false;
    }
    const opened = openRoot('/');
    if (opened.kind !== 'ok') return false;
    try {
      const run = await runHelper(
        launch,
        candidate,
        [String(WORKSPACE_FILE_LIMIT), PROBE_MISSING_NAME],
        { rootFd: opened.fd, timeoutMs },
      );
      return run.code === EXIT_GONE;
    } catch {
      return false;
    } finally {
      closeSync(opened.fd);
    }
  };

  const discover = async (): Promise<boolean> => {
    for (const candidate of options.candidates ?? defaultCandidates(env)) {
      if (await works(candidate)) {
        python = candidate;
        return true;
      }
    }
    return false;
  };

  const readThroughHelper = async (
    root: string,
    expected: RootIdentity,
    path: string,
    signal: AbortSignal | undefined,
  ): Promise<WorkspaceFileResult> => {
    const opened = openRoot(root);
    if (opened.kind === 'missing') return { status: 'gone' };
    if (opened.kind === 'failed') return { status: 'unavailable' };
    try {
      if (!sameIdentity(opened.identity, expected)) return { status: 'gone' };
      const trusted = python === null ? null : trustedExecutable(python);
      if (trusted === null) return { status: 'unsupported' };
      const run = await runHelper(launch, trusted, [String(WORKSPACE_FILE_LIMIT), path], {
        rootFd: opened.fd,
        timeoutMs,
        ...(signal !== undefined ? { signal } : {}),
      });
      if (run.overflow) return { status: 'unsupported' };
      if (run.code === 0) return decodeText(run.stdout);
      if (run.code === EXIT_GONE) return { status: 'gone' };
      if (run.code === EXIT_UNSUPPORTED) return { status: 'unsupported' };
      return { status: 'unavailable' };
    } catch {
      return { status: 'unavailable' };
    } finally {
      closeSync(opened.fd);
    }
  };

  return {
    supported: () => python !== null,

    probe() {
      if (python !== null) return Promise.resolve(true);
      if (pendingProbe !== null) return pendingProbe;
      if (lastFailureAt !== null && now() - lastFailureAt < PROBE_RETRY_MS) {
        return Promise.resolve(false);
      }
      pendingProbe = discover()
        .then((found) => {
          if (found) options.onSupportChange?.();
          else lastFailureAt = now();
          return found;
        })
        .finally(() => {
          pendingProbe = null;
        });
      return pendingProbe;
    },

    bind(root) {
      if (!isAbsolute(root)) return null;
      try {
        const real = realpathSync(root);
        if (real === '/' || holdsKey(real)) return null;
        const opened = openRoot(real);
        if (opened.kind !== 'ok') return null;
        closeSync(opened.fd);
        if (opened.identity.birth <= 0n) return null;
        return seal({ root: real, identity: opened.identity });
      } catch (error) {
        options.log?.(
          `workspace file binding failed: ${error instanceof Error ? error.message : String(error)}`,
        );
        return null;
      }
    },

    async read(instance, path, signal) {
      if (!workspaceFilePathSchema.safeParse(path).success) return { status: 'unsupported' };
      if (python === null) return { status: 'unsupported' };
      let payload: InstancePayload | null;
      try {
        payload = open(instance);
      } catch {
        return { status: 'unavailable' };
      }
      if (payload === null) return { status: 'gone' };
      if (holdsKey(payload.root)) return { status: 'unsupported' };
      if (signal?.aborted || active >= maxConcurrent) return { status: 'unavailable' };
      active += 1;
      try {
        return await readThroughHelper(payload.root, payload.identity, path, signal);
      } finally {
        active -= 1;
      }
    },
  };
}
