import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import { dirname, join, normalize, relative, resolve, sep } from 'node:path';
import { Readable, Transform, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip, gunzipSync, gzipSync } from 'node:zlib';

const TAR_BLOCK = 512;
const BACKUP_ENVELOPE_MAGIC = Buffer.from('CAIRNBAK\x01', 'binary');
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const MAX_ARCHIVE_FILES = 50_000;
const MAX_ARCHIVE_TOTAL_BYTES = 2 * 1024 * 1024 * 1024;
const DEFAULT_STREAM_MAX_BYTES = 1024 * 1024 * 1024;
const DEFAULT_MAX_COMPRESSED_BYTES = 256 * 1024 * 1024;
const STRICT_OCTAL_RE = /^[0-7]+$/;

export interface TarEntry {
  path: string;
  content: Buffer;
  mode: number;
}

export interface TarExtractLimits {
  maxFiles?: number;
  maxTotalBytes?: number;
  maxCompressedBytes?: number;
}

export function sha256Hex(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

function assertSafeRelativePath(rawPath: string): string {
  const posix = rawPath.replaceAll('\\', '/').replace(/^\.\//, '');
  if (
    posix === '' ||
    posix.startsWith('/') ||
    posix.includes('\0') ||
    posix.split('/').some((seg) => seg === '' || seg === '.' || seg === '..')
  ) {
    throw new Error(`unsafe backup archive path: ${rawPath}`);
  }
  return posix;
}

function splitTarPath(posixPath: string): { name: string; prefix: string } {
  const utf8 = Buffer.from(posixPath, 'utf8');
  if (utf8.length <= 100) return { name: posixPath, prefix: '' };
  const idx = posixPath.lastIndexOf('/');
  if (idx > 0) {
    const prefix = posixPath.slice(0, idx);
    const name = posixPath.slice(idx + 1);
    if (Buffer.byteLength(prefix, 'utf8') <= 155 && Buffer.byteLength(name, 'utf8') <= 100) {
      return { name, prefix };
    }
  }
  throw new Error(`backup archive path too long for ustar: ${posixPath}`);
}

function tarHeader(posixPath: string, size: number, mode: number): Buffer {
  const { name, prefix } = splitTarPath(posixPath);
  const header = Buffer.alloc(TAR_BLOCK, 0);
  header.write(name, 0, 100, 'utf8');
  header.write(`${(mode & 0o777).toString(8).padStart(7, '0')}\0`, 100, 8, 'ascii');
  header.write('0000000\0', 108, 8, 'ascii');
  header.write('0000000\0', 116, 8, 'ascii');
  header.write(`${size.toString(8).padStart(11, '0')}\0`, 124, 12, 'ascii');
  header.write(
    `${Math.floor(Date.now() / 1000)
      .toString(8)
      .padStart(11, '0')}\0`,
    136,
    12,
    'ascii',
  );
  header.fill(0x20, 148, 156);
  header.write('0', 156, 1, 'ascii');
  header.write('ustar\0', 257, 6, 'ascii');
  header.write('00', 263, 2, 'ascii');
  if (prefix !== '') header.write(prefix, 345, 155, 'utf8');
  let checksum = 0;
  for (let i = 0; i < TAR_BLOCK; i += 1) checksum += header[i] ?? 0;
  header.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii');
  return header;
}

export function packTarGz(entries: readonly TarEntry[]): Buffer {
  const chunks: Buffer[] = [];
  const sorted = [...entries].sort((a, b) => a.path.localeCompare(b.path));
  for (const entry of sorted) {
    const safePath = assertSafeRelativePath(entry.path);
    chunks.push(tarHeader(safePath, entry.content.length, entry.mode));
    if (entry.content.length > 0) {
      chunks.push(entry.content);
      const rem = entry.content.length % TAR_BLOCK;
      if (rem !== 0) chunks.push(Buffer.alloc(TAR_BLOCK - rem, 0));
    }
  }
  chunks.push(Buffer.alloc(TAR_BLOCK * 2, 0));
  return gzipSync(Buffer.concat(chunks), { level: 6 });
}

function readTarString(buf: Buffer, start: number, length: number): string {
  const slice = buf.subarray(start, start + length);
  const zero = slice.indexOf(0);
  return (zero >= 0 ? slice.subarray(0, zero) : slice).toString('utf8');
}

function parseTarOctal(
  raw: string,
  fieldName: string,
  fullPath: string,
  defaultValue?: number,
): number {
  const trimmed = raw.trim();
  if (trimmed === '') {
    if (defaultValue !== undefined) return defaultValue;
    throw new Error(`malformed tar entry ${fieldName} for ${fullPath}`);
  }
  if (!STRICT_OCTAL_RE.test(trimmed)) {
    throw new Error(`malformed tar entry ${fieldName} for ${fullPath}`);
  }
  const value = Number.parseInt(trimmed, 8);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`malformed tar entry ${fieldName} for ${fullPath}`);
  }
  return value;
}

export function unpackTarGz(archive: Buffer): TarEntry[] {
  const raw = gunzipSync(archive, { maxOutputLength: MAX_ARCHIVE_TOTAL_BYTES });
  const entries: TarEntry[] = [];
  let offset = 0;
  let totalBytes = 0;
  while (offset + TAR_BLOCK <= raw.length) {
    const header = raw.subarray(offset, offset + TAR_BLOCK);
    offset += TAR_BLOCK;
    if (header.every((b) => b === 0)) break;
    const typeFlag = header[156];
    const name = readTarString(header, 0, 100);
    const prefix = readTarString(header, 345, 155);
    const fullPath = prefix === '' ? name : `${prefix}/${name}`;
    const size = parseTarOctal(readTarString(header, 124, 12), 'size', fullPath, 0);
    const mode = parseTarOctal(readTarString(header, 100, 8), 'mode', fullPath, 0o600) & 0o777;
    const padded = Math.ceil(size / TAR_BLOCK) * TAR_BLOCK;
    if (offset + size > raw.length) {
      throw new Error(`truncated tar entry: ${fullPath}`);
    }
    if (typeFlag === 0 || typeFlag === 48) {
      entries.push({
        path: assertSafeRelativePath(fullPath),
        content: Buffer.from(raw.subarray(offset, offset + size)),
        mode,
      });
      totalBytes += size;
      if (entries.length > MAX_ARCHIVE_FILES || totalBytes > MAX_ARCHIVE_TOTAL_BYTES) {
        throw new Error('backup archive exceeds safe extraction limits');
      }
    } else if (typeFlag !== 53) {
      throw new Error(`unsupported tar entry type ${typeFlag} for ${fullPath}`);
    }
    offset += padded;
  }
  return entries;
}

export async function extractTarGzStreamToDir(
  source: Buffer | Readable,
  destDir: string,
  limits: TarExtractLimits = {},
): Promise<void> {
  const maxFiles = limits.maxFiles ?? MAX_ARCHIVE_FILES;
  const maxTotalBytes = limits.maxTotalBytes ?? DEFAULT_STREAM_MAX_BYTES;
  const maxCompressedBytes = limits.maxCompressedBytes ?? DEFAULT_MAX_COMPRESSED_BYTES;
  if (Buffer.isBuffer(source)) {
    if (source.length === 0) throw new Error('backup archive is empty');
    if (source.length > maxCompressedBytes) {
      throw new Error('backup archive exceeds safe extraction limits');
    }
  }
  const resolvedRoot = resolve(destDir);
  mkdirSync(resolvedRoot, { recursive: true, mode: 0o700 });

  let compressedBytes = 0;
  let totalUncompressedBytes = 0;
  let fileCount = 0;
  const seenPaths = new Set<string>();
  const hdrScratch = Buffer.alloc(TAR_BLOCK);
  let hdrFill = 0;
  let state: 'header' | 'file' | 'pad' | 'done' = 'header';
  let fileRemaining = 0;
  let padRemaining = 0;
  let currentFd: number | null = null;
  let currentTarget = '';

  const closeActiveFd = () => {
    if (currentFd !== null) {
      try {
        closeSync(currentFd);
      } catch {}
      currentFd = null;
    }
  };

  const compressedMeter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      compressedBytes += chunk.length;
      if (compressedBytes > maxCompressedBytes) {
        callback(new Error('backup archive exceeds safe extraction limits'));
        return;
      }
      callback(null, chunk);
    },
    flush(callback) {
      if (compressedBytes === 0) {
        callback(new Error('backup archive is empty'));
        return;
      }
      callback();
    },
  });

  const tarExtractor = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      try {
        totalUncompressedBytes += chunk.length;
        if (totalUncompressedBytes > maxTotalBytes) {
          throw new Error('backup archive exceeds safe extraction limits');
        }
        let pos = 0;
        while (pos < chunk.length) {
          if (state === 'done') {
            break;
          }
          if (state === 'header') {
            const take = Math.min(TAR_BLOCK - hdrFill, chunk.length - pos);
            chunk.copy(hdrScratch, hdrFill, pos, pos + take);
            hdrFill += take;
            pos += take;
            if (hdrFill < TAR_BLOCK) break;
            hdrFill = 0;
            if (hdrScratch.every((b) => b === 0)) {
              state = 'done';
              break;
            }
            const typeFlag = hdrScratch[156];
            const name = readTarString(hdrScratch, 0, 100);
            const prefix = readTarString(hdrScratch, 345, 155);
            const fullPath = prefix === '' ? name : `${prefix}/${name}`;
            const size = parseTarOctal(readTarString(hdrScratch, 124, 12), 'size', fullPath, 0);
            parseTarOctal(readTarString(hdrScratch, 100, 8), 'mode', fullPath, 0o600);
            const rem = size % TAR_BLOCK;
            const entryPad = rem === 0 ? 0 : TAR_BLOCK - rem;

            if (typeFlag === 0 || typeFlag === 48) {
              const safeRel = assertSafeRelativePath(fullPath);
              if (seenPaths.has(safeRel)) {
                throw new Error(`duplicate backup archive entry: ${safeRel}`);
              }
              seenPaths.add(safeRel);
              fileCount += 1;
              if (fileCount > maxFiles) {
                throw new Error('backup archive exceeds safe extraction limits');
              }
              const target = resolve(resolvedRoot, normalize(safeRel));
              if (!target.startsWith(`${resolvedRoot}${sep}`)) {
                throw new Error(`archive entry escapes destination: ${safeRel}`);
              }
              mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
              currentFd = openSync(target, 'w', 0o600);
              currentTarget = target;
              fileRemaining = size;
              padRemaining = entryPad;
              if (fileRemaining === 0) {
                closeActiveFd();
                chmodSync(currentTarget, 0o600);
                state = padRemaining > 0 ? 'pad' : 'header';
              } else {
                state = 'file';
              }
            } else if (typeFlag === 53) {
              assertSafeRelativePath(fullPath);
              const skipTotal = size + entryPad;
              if (skipTotal > 0) {
                padRemaining = skipTotal;
                state = 'pad';
              }
            } else {
              throw new Error(`unsupported tar entry type ${typeFlag} for ${fullPath}`);
            }
          } else if (state === 'file') {
            const take = Math.min(fileRemaining, chunk.length - pos);
            let written = 0;
            while (written < take && currentFd !== null) {
              written += writeSync(currentFd, chunk, pos + written, take - written);
            }
            pos += take;
            fileRemaining -= take;
            if (fileRemaining === 0) {
              closeActiveFd();
              chmodSync(currentTarget, 0o600);
              state = padRemaining > 0 ? 'pad' : 'header';
            }
          } else if (state === 'pad') {
            const skip = Math.min(padRemaining, chunk.length - pos);
            pos += skip;
            padRemaining -= skip;
            if (padRemaining === 0) {
              state = 'header';
            }
          }
        }
        callback();
      } catch (error) {
        closeActiveFd();
        callback(error instanceof Error ? error : new Error(String(error)));
      }
    },
    final(callback) {
      closeActiveFd();
      if (hdrFill !== 0 || state === 'file' || state === 'pad') {
        callback(new Error('truncated tar entry in backup archive'));
        return;
      }
      callback();
    },
  });

  const inputStream = Buffer.isBuffer(source) ? Readable.from([source]) : source;
  try {
    await pipeline(
      inputStream,
      compressedMeter,
      createGunzip({ chunkSize: 64 * 1024 }),
      tarExtractor,
    );
  } finally {
    closeActiveFd();
  }
}

export function collectDirectoryEntries(rootDir: string): TarEntry[] {
  const entries: TarEntry[] = [];
  const walk = (dir: string): void => {
    for (const item of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, item.name);
      if (item.isSymbolicLink()) continue;
      if (item.isDirectory()) {
        walk(full);
      } else if (item.isFile()) {
        const rel = relative(rootDir, full).split(sep).join('/');
        const mode = statSync(full).mode & 0o777;
        entries.push({
          path: assertSafeRelativePath(rel),
          content: readFileSync(full),
          mode: mode === 0 ? 0o600 : mode,
        });
      }
    }
  };
  walk(rootDir);
  return entries;
}

export function extractEntriesToDir(entries: readonly TarEntry[], destDir: string): void {
  const resolvedRoot = resolve(destDir);
  mkdirSync(resolvedRoot, { recursive: true, mode: 0o700 });
  for (const entry of entries) {
    const safeRel = assertSafeRelativePath(entry.path);
    const target = resolve(resolvedRoot, normalize(safeRel));
    if (!target.startsWith(`${resolvedRoot}${sep}`)) {
      throw new Error(`archive entry escapes destination: ${entry.path}`);
    }
    mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
    writeFileSync(target, entry.content, { mode: 0o600 });
    chmodSync(target, 0o600);
  }
}

export function encryptBackupPayload(plaintext: Buffer, key: Buffer, aad: string): Buffer {
  if (key.length !== KEY_BYTES) {
    throw new Error(`backup encryption key must be ${KEY_BYTES} bytes`);
  }
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([BACKUP_ENVELOPE_MAGIC, iv, ciphertext, cipher.getAuthTag()]);
}

export function decryptBackupPayload(payload: Buffer, key: Buffer, aad: string): Buffer {
  if (key.length !== KEY_BYTES) {
    throw new Error(`backup encryption key must be ${KEY_BYTES} bytes`);
  }
  const minLength = BACKUP_ENVELOPE_MAGIC.length + IV_BYTES + TAG_BYTES;
  if (
    payload.length < minLength ||
    !payload.subarray(0, BACKUP_ENVELOPE_MAGIC.length).equals(BACKUP_ENVELOPE_MAGIC)
  ) {
    throw new Error('unrecognized or truncated backup archive envelope');
  }
  const body = payload.subarray(BACKUP_ENVELOPE_MAGIC.length);
  const iv = body.subarray(0, IV_BYTES);
  const tag = body.subarray(body.length - TAG_BYTES);
  const ciphertext = body.subarray(IV_BYTES, body.length - TAG_BYTES);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAAD(Buffer.from(aad, 'utf8'));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

export function resolveBackupEncryptionKey(dataDir: string, envKeyBase64: string | null): Buffer {
  if (envKeyBase64 !== null && envKeyBase64.trim() !== '') {
    const key = Buffer.from(envKeyBase64.trim(), 'base64');
    if (key.length !== KEY_BYTES) {
      throw new Error(`CAIRN_BACKUP_ENCRYPTION_KEY must be base64 of ${KEY_BYTES} bytes`);
    }
    return key;
  }
  const keyPath = join(dataDir, 'backup.key');
  mkdirSync(dirname(keyPath), { recursive: true, mode: 0o700 });
  if (!existsSync(keyPath)) {
    writeFileSync(keyPath, `${randomBytes(KEY_BYTES).toString('base64')}\n`, { mode: 0o600 });
    chmodSync(keyPath, 0o600);
  }
  const key = Buffer.from(readFileSync(keyPath, 'utf8').trim(), 'base64');
  if (key.length !== KEY_BYTES) {
    throw new Error(`backup keyfile malformed: ${keyPath}`);
  }
  return key;
}
