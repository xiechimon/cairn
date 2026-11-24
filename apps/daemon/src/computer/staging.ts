import { createHash, randomBytes } from 'node:crypto';
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, join, relative, resolve, sep } from 'node:path';
import { ATTACHMENT_MAX_BYTES, STAGED_UPLOADS_DIR_NAME } from '@cairn/shared';
import type { HostShellConfinement } from '../backend/host-shell-confinement.js';
import { ComputerRefusal } from './provider.js';

export const STAGED_UPLOADS_TTL_MS = 72 * 60 * 60 * 1000;

const SAFE_SEGMENT = /^[A-Za-z0-9_-]{1,128}$/;
const FORMAT_CHAR = /^\p{Cf}$/u;

export function defaultStagingRoot(): string {
  const base = existsSync(tmpdir()) ? realpathSync(tmpdir()) : resolve(tmpdir());
  const uid = process.getuid?.();
  const suffix = uid !== undefined ? `-${uid}` : '';
  return join(base, `${STAGED_UPLOADS_DIR_NAME}${suffix}`);
}

export function isSafeStagingRoot(stagingRoot: string): boolean {
  try {
    const st = lstatSync(stagingRoot);
    if (st.isSymbolicLink() || !st.isDirectory()) return false;
    const uid = process.getuid?.();
    if (uid !== undefined) {
      if (st.uid !== uid) return false;
      if ((st.mode & 0o077) !== 0) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function ensureSafeStagingRoot(stagingRoot: string): string {
  let exists = false;
  try {
    lstatSync(stagingRoot);
    exists = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw new ComputerRefusal('staging directory cannot be accessed');
    }
  }
  if (!exists) {
    mkdirSync(stagingRoot, { recursive: true, mode: 0o700 });
  }
  if (!isSafeStagingRoot(stagingRoot)) {
    throw new ComputerRefusal(
      'staging directory is unsafe (must be an owner-only directory, not a symlink)',
    );
  }
  return realpathSync(stagingRoot);
}

export function sanitizeStageSegment(value: string, prefix: string): string {
  if (SAFE_SEGMENT.test(value)) return value;
  const hash = createHash('sha256').update(value).digest('hex').slice(0, 24);
  return `${prefix}-${hash}`;
}

export function sanitizeStagedFileName(fileName: string): string {
  const base = basename(fileName.replaceAll('\\', '/'));
  let out = '';
  for (const ch of base) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp < 0x20 || cp === 0x85 || cp === 0x2028 || cp === 0x2029) continue;
    if (FORMAT_CHAR.test(ch)) continue;
    out += ch;
  }
  const trimmed = out.trim();
  return trimmed === '' || trimmed === '.' || trimmed === '..'
    ? 'attachment'
    : trimmed.slice(0, 180);
}

function insideDir(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !rel.startsWith('/');
}

export function writeStagedUpload(
  stagingRoot: string,
  input: { threadId: string; attachmentId: string; fileName: string; bytes: Buffer },
): { path: string; sizeBytes: number } {
  const realRoot = ensureSafeStagingRoot(stagingRoot);
  const threadSegment = sanitizeStageSegment(input.threadId, 'thread');
  const threadDir = join(realRoot, threadSegment);
  if (!insideDir(realRoot, threadDir)) {
    throw new ComputerRefusal('staged upload thread path escapes staging root');
  }
  mkdirSync(threadDir, { recursive: true, mode: 0o700 });
  const threadStat = lstatSync(threadDir);
  if (threadStat.isSymbolicLink() || !threadStat.isDirectory()) {
    throw new ComputerRefusal('staged upload thread directory is unsafe');
  }
  const realThreadDir = realpathSync(threadDir);
  if (!insideDir(realRoot, realThreadDir)) {
    throw new ComputerRefusal('staged upload thread path escapes staging root');
  }
  const attSegment = sanitizeStageSegment(input.attachmentId, 'att');
  const safeName = sanitizeStagedFileName(input.fileName);
  const targetName = `${attSegment}-${safeName}`;
  const finalPath = join(realThreadDir, targetName);
  if (!insideDir(realThreadDir, finalPath)) {
    throw new ComputerRefusal('staged upload filename escapes thread directory');
  }
  const tempPath = join(realThreadDir, `.cairn-stage-${randomBytes(8).toString('hex')}`);
  const fd = openSync(
    tempPath,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0),
    0o600,
  );
  try {
    let written = 0;
    while (written < input.bytes.byteLength) {
      written += writeSync(fd, input.bytes, written, input.bytes.byteLength - written);
    }
  } catch (error) {
    closeSync(fd);
    rmSync(tempPath, { force: true });
    throw error;
  }
  closeSync(fd);
  try {
    renameSync(tempPath, finalPath);
  } catch (error) {
    rmSync(tempPath, { force: true });
    throw error;
  }
  return { path: finalPath, sizeBytes: input.bytes.byteLength };
}

export function sweepStagedUploads(
  stagingRoot: string,
  opts?: { ttlMs?: number; now?: number },
): string[] {
  if (!isSafeStagingRoot(stagingRoot)) return [];
  const ttlMs = opts?.ttlMs ?? STAGED_UPLOADS_TTL_MS;
  const now = opts?.now ?? Date.now();
  const removed: string[] = [];
  for (const entry of readdirSync(stagingRoot)) {
    const full = join(stagingRoot, entry);
    let mtimeMs: number | undefined;
    try {
      const st = lstatSync(full);
      if (st.isSymbolicLink() || !st.isDirectory()) continue;
      mtimeMs = st.mtimeMs;
    } catch {
      continue;
    }
    if (mtimeMs === undefined || now - mtimeMs < ttlMs) continue;
    rmSync(full, { recursive: true, force: true });
    removed.push(entry);
  }
  return removed;
}

export function readHostFileForAttach(
  requestedPath: string,
  confinement: Pick<HostShellConfinement, 'denied'>,
  opts: { home?: string; maxBytes?: number } = {},
): { fileName: string; bytes: Buffer } {
  const trimmed = requestedPath.trim();
  if (trimmed === '' || trimmed.includes('\0') || trimmed.length > 4096) {
    throw new ComputerRefusal('attach_file requires a valid non-empty file path');
  }
  const home = resolve(opts.home ?? homedir());
  const maxBytes = opts.maxBytes ?? ATTACHMENT_MAX_BYTES;
  const expanded =
    trimmed === '~'
      ? home
      : trimmed.startsWith('~/')
        ? join(home, trimmed.slice(2))
        : resolve(home, trimmed);
  if (confinement.denied(expanded)) {
    throw new ComputerRefusal('path is inside a protected directory');
  }
  let resolved: string;
  try {
    resolved = realpathSync(expanded);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') throw new ComputerRefusal('file not found');
    throw new ComputerRefusal('file cannot be accessed');
  }
  if (confinement.denied(resolved)) {
    throw new ComputerRefusal('path is inside a protected directory');
  }
  let fd: number;
  try {
    fd = openSync(
      resolved,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0),
    );
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') throw new ComputerRefusal('file not found');
    if (code === 'ELOOP') throw new ComputerRefusal('path changed while opening');
    throw new ComputerRefusal('file cannot be opened');
  }
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile()) throw new ComputerRefusal('path is not a regular file');
    const openedPath = realpathSync(resolved);
    const current = statSync(openedPath);
    if (confinement.denied(openedPath) || current.dev !== stat.dev || current.ino !== stat.ino) {
      throw new ComputerRefusal('path changed or is inside a protected directory');
    }
    if (stat.size <= 0) throw new ComputerRefusal('file is empty');
    if (stat.size > maxBytes) {
      throw new ComputerRefusal('file exceeds the 10 MiB attachment limit');
    }
    const bytes = Buffer.alloc(stat.size + 1);
    let readBytes = 0;
    while (readBytes < bytes.length) {
      const count = readSync(fd, bytes, readBytes, bytes.length - readBytes, null);
      if (count === 0) break;
      readBytes += count;
    }
    if (readBytes !== stat.size) {
      throw new ComputerRefusal('file changed while reading; retry with a stable file');
    }
    return { fileName: basename(resolved), bytes: bytes.subarray(0, readBytes) };
  } finally {
    closeSync(fd);
  }
}
