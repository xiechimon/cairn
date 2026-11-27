import { randomBytes } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  constants,
  fchmodSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';

const PRIVATE_DIR_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;
const PRIVATE_TEMP_FILE = /^\.(.+)\.(\d+)\.\d+(?:\.[0-9a-f]+)?\.tmp$/;
const TEMP_OPEN_ATTEMPTS = 32;

export function ensurePrivateDir(dir: string): void {
  mkdirSync(dir, { recursive: true, mode: PRIVATE_DIR_MODE });
  chmodSync(dir, PRIVATE_DIR_MODE);
}

let writeSequence = 0;

function isWriterAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export function sweepStalePrivateTemps(
  dir: string,
  options?: {
    now?: number;
    ttlMs?: number;
    targetPrefix?: string;
    isPidAlive?: (pid: number) => boolean;
  },
): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  const alive = options?.isPidAlive ?? isWriterAlive;
  const removed: string[] = [];
  for (const name of entries) {
    const match = PRIVATE_TEMP_FILE.exec(name);
    if (match === null) continue;
    const targetName = match[1];
    const pid = Number(match[2]);
    if (targetName === undefined) continue;
    if (options?.targetPrefix !== undefined && !targetName.startsWith(options.targetPrefix)) {
      continue;
    }
    const path = join(dir, name);
    try {
      const deadWriter = !alive(pid);
      const expired =
        options?.now !== undefined &&
        options?.ttlMs !== undefined &&
        options.now - statSync(path).mtimeMs > options.ttlMs;
      if (!deadWriter && !expired) continue;
      rmSync(path, { force: true });
      removed.push(name);
    } catch {}
  }
  return removed;
}

function refuseSymlink(path: string): void {
  try {
    if (lstatSync(path).isSymbolicLink()) {
      throw Object.assign(new Error(`ELOOP: refusing to overwrite symbolic link: ${path}`), {
        code: 'ELOOP',
      });
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
}

export function writePrivateFile(path: string, contents: string): void {
  refuseSymlink(path);
  let temporary = '';
  let fd: number | null = null;
  for (let attempt = 0; attempt < TEMP_OPEN_ATTEMPTS; attempt += 1) {
    const suffix = randomBytes(6).toString('hex');
    temporary = join(
      dirname(path),
      `.${basename(path)}.${process.pid}.${writeSequence++}.${suffix}.tmp`,
    );
    try {
      fd = openSync(
        temporary,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
        PRIVATE_FILE_MODE,
      );
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || attempt === TEMP_OPEN_ATTEMPTS - 1)
        throw error;
    }
  }
  if (fd === null) throw new Error(`could not create temporary file for: ${path}`);
  let closed = false;
  try {
    const data = Buffer.from(contents, 'utf8');
    let offset = 0;
    while (offset < data.length) {
      const written = writeSync(fd, data.subarray(offset));
      if (written === 0) throw new Error(`short write: ${path}`);
      offset += written;
    }
    fchmodSync(fd, PRIVATE_FILE_MODE);
    fsyncSync(fd);
    closed = true;
    closeSync(fd);
    refuseSymlink(path);
    renameSync(temporary, path);
  } catch (error) {
    if (!closed) {
      try {
        closeSync(fd);
      } catch {}
    }
    rmSync(temporary, { force: true });
    throw error;
  }
}
