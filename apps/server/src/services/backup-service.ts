import { randomBytes } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statfsSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { hostname } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
import {
  type BackupHealth,
  type BackupManagedInfo,
  type BackupRestoreResult,
  type BackupSnapshotKind,
  type BackupSnapshotSummary,
  type BackupStatus,
  backupSnapshotSummarySchema,
  DAILY_BACKUP_STALE_AFTER_MS,
  isValidBackupSnapshotId,
} from '@cairn/shared';
import Database from 'better-sqlite3';
import {
  collectDirectoryEntries,
  decryptBackupPayload,
  encryptBackupPayload,
  extractEntriesToDir,
  packTarGz,
  resolveBackupEncryptionKey,
  sha256Hex,
  unpackTarGz,
} from './backup-archive.js';
import type { BackupObjectStore } from './backup-s3.js';
import { readBackupHealth } from './backup-status.js';

const ARCHIVE_EXT = '.cairn-bak';
const META_EXT = '.meta.json';
const RESTORE_MARKER = 'restore-pending.json';
const DAY_MS = 24 * 60 * 60 * 1000;
const CHECK_INTERVAL_MS = 60 * 60 * 1000;
const DEFAULT_INITIAL_DELAY_MS = 60 * 1000;
const DEFAULT_RETENTION_COUNT = 7;
const CLOUD_LOCAL_CACHE_COUNT = 2;
const DEFAULT_MIN_FREE_BYTES = 512 * 1024 * 1024;
const DATA_DIRS = ['attachments', 'repos'] as const;
const DATA_FILES = ['environment-id', 'vapid.json', 'secretbox.key'] as const;
const EXPORT_EXCLUDED_PATHS: readonly string[] = ['secretbox.key', 'vapid.json'];

interface BackupManifest {
  version: 1;
  id: string;
  createdAt: number;
  kind: BackupSnapshotKind;
  files: Record<string, string>;
  counts: {
    projects: number;
    todos: number;
    messages: number;
  };
}

interface PendingRestoreRecord {
  version: 1;
  snapshotId: string;
  stagedDir: string;
  createdAt: number;
}

export class BackupInProgressError extends Error {
  constructor(message = 'A backup or restore is already running.') {
    super(message);
    this.name = 'BackupInProgressError';
  }
}

export class BackupNotFoundError extends Error {
  constructor(id: string) {
    super(`Backup snapshot not found: ${id}`);
    this.name = 'BackupNotFoundError';
  }
}

export interface BackupService {
  health(): Promise<BackupHealth>;
  runBackup(kind?: BackupSnapshotKind): Promise<BackupSnapshotSummary>;
  exportArchive(): Promise<{ filename: string; buffer: Buffer; snapshotId: string }>;
  prepareRestore(snapshotId: string): Promise<BackupRestoreResult>;
  start(): void;
  stop(): void;
}

export interface BackupServiceOptions {
  dataDir: string;
  dbPath: string;
  statusPath: string;
  skillsDir?: string;
  backupsDir?: string;
  sqlite: Database.Database;
  encryptionKeyEnv?: string | null;
  objectStore?: BackupObjectStore | null;
  objectPrefix?: string;
  retentionCount?: number;
  minFreeBytes?: number;
  initialDelayMs?: number;
  intervalMs?: number;
  hostName?: string;
  now?: () => number;
  onRestart?: () => void;
  logger?: { info(obj: unknown, msg?: string): void; warn(obj: unknown, msg?: string): void };
}

function assertSnapshotId(id: string): string {
  if (!isValidBackupSnapshotId(id)) {
    throw new BackupNotFoundError(id);
  }
  return id;
}

function writeAtomic(path: string, content: Buffer | string, mode = 0o600): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`;
  writeFileSync(tmp, content, { mode });
  chmodSync(tmp, mode);
  renameSync(tmp, path);
}

function copyAtomic(src: string, dest: string, mode = 0o600): void {
  mkdirSync(dirname(dest), { recursive: true, mode: 0o700 });
  const tmp = `${dest}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`;
  copyFileSync(src, tmp);
  chmodSync(tmp, mode);
  renameSync(tmp, dest);
}

function formatSnapshotId(nowMs: number): string {
  const stamp = new Date(nowMs)
    .toISOString()
    .replace(/:/g, '-')
    .replace(/\.\d{3}Z$/, 'Z');
  return `${stamp}-${randomBytes(3).toString('hex')}`;
}

function verifySqliteIntegrity(path: string): void {
  const ro = new Database(path, { readonly: true });
  try {
    const row = ro.pragma('integrity_check', { simple: true });
    if (row !== 'ok') {
      throw new Error(`sqlite integrity check failed for ${basename(path)}: ${String(row)}`);
    }
  } finally {
    ro.close();
  }
}

function readDbCounts(path: string): { projects: number; todos: number; messages: number } {
  const ro = new Database(path, { readonly: true });
  try {
    const count = (table: string): number => {
      const exists = ro
        .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
        .get(table);
      if (exists === undefined) return 0;
      const row = ro.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number };
      return Number(row.n ?? 0);
    };
    return {
      projects: count('project'),
      todos: count('todo'),
      messages: count('message'),
    };
  } finally {
    ro.close();
  }
}

function copyDirectoryTree(srcDir: string, destDir: string, fileMode?: number): void {
  if (!existsSync(srcDir)) return;
  mkdirSync(destDir, { recursive: true, mode: 0o700 });
  for (const item of readdirSync(srcDir, { withFileTypes: true })) {
    if (item.isSymbolicLink()) continue;
    const src = join(srcDir, item.name);
    const dest = join(destDir, item.name);
    if (item.isDirectory()) {
      copyDirectoryTree(src, dest, fileMode);
    } else if (item.isFile()) {
      copyFileSync(src, dest);
      if (fileMode !== undefined) chmodSync(dest, fileMode);
    }
  }
}

function parseSnapshotSummary(raw: string, expectedId: string): BackupSnapshotSummary | null {
  if (!isValidBackupSnapshotId(expectedId)) return null;
  try {
    const parsed = backupSnapshotSummarySchema.safeParse(JSON.parse(raw));
    if (!parsed.success || parsed.data.id !== expectedId) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

function parseManifest(raw: string): BackupManifest {
  const parsed = JSON.parse(raw) as Partial<BackupManifest>;
  if (
    parsed.version !== 1 ||
    typeof parsed.id !== 'string' ||
    !isValidBackupSnapshotId(parsed.id) ||
    typeof parsed.createdAt !== 'number' ||
    typeof parsed.files !== 'object' ||
    parsed.files === null
  ) {
    throw new Error('malformed backup manifest');
  }
  return parsed as BackupManifest;
}

function verifyExtractedSnapshot(dir: string, expectedSnapshotId: string): BackupManifest {
  const resolvedDir = resolve(dir);
  const manifestPath = join(resolvedDir, 'manifest.json');
  if (!existsSync(manifestPath)) {
    throw new Error('backup archive is missing manifest.json');
  }
  const manifest = parseManifest(readFileSync(manifestPath, 'utf8'));
  if (manifest.id !== expectedSnapshotId) {
    throw new Error('backup manifest snapshot id mismatch');
  }
  if (!Object.hasOwn(manifest.files, 'server.db')) {
    throw new Error('backup manifest does not cover server.db');
  }

  const extractedEntries = collectDirectoryEntries(resolvedDir).filter(
    (entry) => entry.path !== 'manifest.json',
  );
  const manifestKeys = Object.keys(manifest.files);
  if (extractedEntries.length !== manifestKeys.length) {
    throw new Error('backup archive contains unmanifested or missing files');
  }
  for (const entry of extractedEntries) {
    if (!Object.hasOwn(manifest.files, entry.path)) {
      throw new Error(`unmanifested file in backup archive: ${entry.path}`);
    }
  }

  for (const [relPath, expectedHash] of Object.entries(manifest.files)) {
    const target = resolve(resolvedDir, relPath);
    if (!target.startsWith(`${resolvedDir}${sep}`)) {
      throw new Error(`unsafe manifest entry: ${relPath}`);
    }
    if (!existsSync(target)) {
      throw new Error(`backup archive is missing file: ${relPath}`);
    }
    const actualHash = sha256Hex(readFileSync(target));
    if (actualHash !== expectedHash) {
      throw new Error(`checksum mismatch for ${relPath}`);
    }
  }
  const serverDb = join(resolvedDir, 'server.db');
  if (!existsSync(serverDb)) {
    throw new Error('backup archive is missing server.db');
  }
  verifySqliteIntegrity(serverDb);
  const coordDir = join(resolvedDir, 'coordinator');
  if (existsSync(coordDir)) {
    for (const file of readdirSync(coordDir)) {
      if (file.endsWith('.sqlite')) {
        verifySqliteIntegrity(join(coordDir, file));
      }
    }
  }
  return manifest;
}

function removeWalSidecars(dbFilePath: string): void {
  for (const suffix of ['-wal', '-shm']) {
    rmSync(`${dbFilePath}${suffix}`, { force: true });
  }
}

function installVerifiedDirIntoDataDir(
  stagedDir: string,
  dataDir: string,
  dbPath: string,
  skillsDir?: string,
): void {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  mkdirSync(dirname(dbPath), { recursive: true, mode: 0o700 });

  removeWalSidecars(dbPath);
  copyAtomic(join(stagedDir, 'server.db'), dbPath, 0o600);

  const coordDest = join(dataDir, 'coordinator');
  rmSync(coordDest, { recursive: true, force: true });
  const coordSrc = join(stagedDir, 'coordinator');
  if (existsSync(coordSrc)) {
    copyDirectoryTree(coordSrc, coordDest, 0o600);
  }

  for (const dirName of DATA_DIRS) {
    const dest = join(dataDir, dirName);
    rmSync(dest, { recursive: true, force: true });
    const src = join(stagedDir, dirName);
    if (existsSync(src)) {
      copyDirectoryTree(src, dest, 0o600);
    }
  }

  const skillsSrc = join(stagedDir, 'skills');
  if (skillsDir !== undefined && existsSync(skillsSrc)) {
    rmSync(skillsDir, { recursive: true, force: true });
    copyDirectoryTree(skillsSrc, skillsDir);
  }

  for (const fileName of DATA_FILES) {
    const src = join(stagedDir, fileName);
    if (existsSync(src)) {
      copyAtomic(src, join(dataDir, fileName), 0o600);
    }
  }
}

function sanitizeBackupErrorDetail(error: unknown): string {
  const msg = error instanceof Error ? error.message : String(error);
  if (/insufficient free disk space/i.test(msg)) return 'insufficient disk space';
  if (/integrity check failed/i.test(msg)) return 'database integrity check failed';
  if (/upload failed|download failed|list failed/i.test(msg))
    return 'remote storage request failed';
  if (/timeout|aborted/i.test(msg)) return 'backup timed out';
  return 'backup failed';
}

export function restoreBackupArchiveToDir(input: {
  encryptedArchive: Buffer;
  snapshotId: string;
  encryptionKey: Buffer;
  targetDataDir: string;
  targetDbPath?: string;
  targetSkillsDir?: string;
}): BackupManifest {
  assertSnapshotId(input.snapshotId);
  const tarGz = decryptBackupPayload(input.encryptedArchive, input.encryptionKey, input.snapshotId);
  const entries = unpackTarGz(tarGz);
  const staging = join(
    input.targetDataDir,
    `.restore-verify-${process.pid}-${randomBytes(4).toString('hex')}`,
  );
  try {
    extractEntriesToDir(entries, staging);
    const manifest = verifyExtractedSnapshot(staging, input.snapshotId);
    installVerifiedDirIntoDataDir(
      staging,
      input.targetDataDir,
      input.targetDbPath ?? join(input.targetDataDir, 'server.db'),
      input.targetSkillsDir,
    );
    return manifest;
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

export function applyPendingRestoreIfAny(
  dataDir: string,
  dbPath: string,
  skillsDir?: string,
  logger?: { info(obj: unknown, msg?: string): void; warn(obj: unknown, msg?: string): void },
): string | null {
  const markerPath = join(dataDir, RESTORE_MARKER);
  const stagedParent = resolve(dataDir, '.restore-staged');
  if (!existsSync(markerPath)) {
    rmSync(stagedParent, { recursive: true, force: true });
    return null;
  }
  let record: PendingRestoreRecord;
  try {
    const parsed = JSON.parse(readFileSync(markerPath, 'utf8')) as Partial<PendingRestoreRecord>;
    if (
      parsed.version !== 1 ||
      typeof parsed.snapshotId !== 'string' ||
      !isValidBackupSnapshotId(parsed.snapshotId) ||
      typeof parsed.stagedDir !== 'string'
    ) {
      throw new Error('malformed restore marker');
    }
    record = parsed as PendingRestoreRecord;
  } catch (error) {
    logger?.warn({ err: error }, 'ignoring unreadable pending restore marker');
    rmSync(markerPath, { force: true });
    rmSync(stagedParent, { recursive: true, force: true });
    return null;
  }
  const stagedPath = resolve(record.stagedDir);
  if (!stagedPath.startsWith(`${stagedParent}${sep}`) || !existsSync(stagedPath)) {
    logger?.warn({ snapshotId: record.snapshotId }, 'pending restore staging directory missing');
    rmSync(markerPath, { force: true });
    rmSync(stagedParent, { recursive: true, force: true });
    return null;
  }
  verifyExtractedSnapshot(stagedPath, record.snapshotId);
  installVerifiedDirIntoDataDir(stagedPath, dataDir, dbPath, skillsDir);
  rmSync(markerPath, { force: true });
  rmSync(stagedParent, { recursive: true, force: true });
  logger?.info({ snapshotId: record.snapshotId }, 'applied pending backup restore');
  return record.snapshotId;
}

export function createBackupService(options: BackupServiceOptions): BackupService {
  const backupsDir = options.backupsDir ?? join(options.dataDir, 'backups');
  const retentionCount = Math.max(1, options.retentionCount ?? DEFAULT_RETENTION_COUNT);
  const minFreeBytes = options.minFreeBytes ?? DEFAULT_MIN_FREE_BYTES;
  const hostName = options.hostName ?? hostname();
  const now = options.now ?? (() => Date.now());
  const objectStore = options.objectStore ?? null;
  const objectPrefix = options.objectPrefix ?? 'cairn-backups/';
  const storageKind = objectStore === null ? 'local' : 'cloud';
  const encryptionKey = resolveBackupEncryptionKey(
    options.dataDir,
    options.encryptionKeyEnv ?? null,
  );

  let inProgress = false;
  let restorePending = false;
  let initialTimer: ReturnType<typeof setTimeout> | null = null;
  let periodicTimer: ReturnType<typeof setInterval> | null = null;

  const localArchivePath = (id: string): string =>
    join(backupsDir, `${assertSnapshotId(id)}${ARCHIVE_EXT}`);
  const localMetaPath = (id: string): string =>
    join(backupsDir, `${assertSnapshotId(id)}${META_EXT}`);
  const remoteArchiveKey = (id: string): string =>
    `${objectPrefix}${assertSnapshotId(id)}${ARCHIVE_EXT}`;
  const remoteMetaKey = (id: string): string => `${objectPrefix}${assertSnapshotId(id)}${META_EXT}`;

  function listLocalSnapshots(): BackupSnapshotSummary[] {
    if (!existsSync(backupsDir)) return [];
    const results: BackupSnapshotSummary[] = [];
    for (const file of readdirSync(backupsDir)) {
      if (!file.endsWith(META_EXT)) continue;
      const expectedId = basename(file, META_EXT);
      const summary = parseSnapshotSummary(
        readFileSync(join(backupsDir, file), 'utf8'),
        expectedId,
      );
      if (summary !== null && existsSync(localArchivePath(summary.id))) {
        results.push(summary);
      }
    }
    return results.sort((a, b) => b.createdAt - a.createdAt);
  }

  async function listSnapshots(): Promise<BackupSnapshotSummary[]> {
    const byId = new Map<string, BackupSnapshotSummary>();
    for (const snap of listLocalSnapshots()) {
      byId.set(snap.id, snap);
    }
    if (objectStore !== null) {
      try {
        const keys = await objectStore.listObjects(objectPrefix);
        const metaKeys = keys.filter(
          (k) =>
            k.startsWith(objectPrefix) &&
            k.endsWith(META_EXT) &&
            !k.slice(objectPrefix.length).includes('/'),
        );
        for (const key of metaKeys) {
          const expectedId = basename(key, META_EXT);
          if (!isValidBackupSnapshotId(expectedId) || byId.has(expectedId)) continue;
          const raw = await objectStore.getObject(key);
          if (raw === null) continue;
          const summary = parseSnapshotSummary(raw.toString('utf8'), expectedId);
          if (summary !== null) byId.set(summary.id, summary);
        }
      } catch (error) {
        options.logger?.warn({ err: error }, 'could not list remote backup snapshots');
      }
    }
    return [...byId.values()].sort((a, b) => b.createdAt - a.createdAt);
  }

  function removeLocalSnapshot(id: string): void {
    rmSync(localArchivePath(id), { force: true });
    rmSync(localMetaPath(id), { force: true });
  }

  function freeBytesAt(dir: string): number {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const stats = statfsSync(dir);
    return Number(stats.bavail) * Number(stats.bsize);
  }

  function ensureDiskSpace(): void {
    const dbSize = existsSync(options.dbPath) ? statSync(options.dbPath).size : 0;
    const needed = Math.max(minFreeBytes, Math.ceil(dbSize * 2.5));
    let free = freeBytesAt(backupsDir);
    if (free >= needed) return;
    const locals = listLocalSnapshots().reverse();
    while (free < needed && locals.length > 1) {
      const oldest = locals.shift();
      if (oldest === undefined) break;
      removeLocalSnapshot(oldest.id);
      free = freeBytesAt(backupsDir);
    }
    if (free < needed) {
      throw new Error('insufficient free disk space for backup');
    }
  }

  function recordStatus(result: 'success' | 'error', detail: string, atMs: number): void {
    const previous = readBackupHealth(options.statusPath);
    const prevSuccess = previous.state === 'recorded' ? previous.status.lastSuccessAt : null;
    const next: BackupStatus = {
      host: hostName,
      lastRunAt: atMs,
      lastRunResult: result,
      lastRunExitStatus: detail,
      lastSuccessAt: result === 'success' ? atMs : prevSuccess,
      staleAfterMs: DAILY_BACKUP_STALE_AFTER_MS,
    };
    writeAtomic(options.statusPath, `${JSON.stringify(next, null, 2)}\n`, 0o600);
  }

  async function pruneRetention(): Promise<void> {
    const localLimit = objectStore === null ? retentionCount : CLOUD_LOCAL_CACHE_COUNT;
    const locals = listLocalSnapshots();
    for (const stale of locals.slice(localLimit)) {
      removeLocalSnapshot(stale.id);
    }
    if (objectStore !== null) {
      const all = await listSnapshots();
      for (const stale of all.slice(retentionCount)) {
        await objectStore.deleteObject(remoteArchiveKey(stale.id)).catch(() => {});
        await objectStore.deleteObject(remoteMetaKey(stale.id)).catch(() => {});
      }
    }
  }

  async function readEncryptedSnapshot(snapshotId: string): Promise<Buffer> {
    const validId = assertSnapshotId(snapshotId);
    const localPath = localArchivePath(validId);
    if (existsSync(localPath)) {
      return readFileSync(localPath);
    }
    if (objectStore !== null) {
      const remote = await objectStore.getObject(remoteArchiveKey(validId));
      if (remote !== null) return remote;
    }
    throw new BackupNotFoundError(validId);
  }

  async function runBackupUnlocked(kind: BackupSnapshotKind): Promise<BackupSnapshotSummary> {
    const startedAt = now();
    const id = formatSnapshotId(startedAt);
    const stagingDir = join(backupsDir, `.staging-${id}`);
    try {
      ensureDiskSpace();
      mkdirSync(stagingDir, { recursive: true, mode: 0o700 });

      const serverDbDest = join(stagingDir, 'server.db');
      await options.sqlite.backup(serverDbDest);
      verifySqliteIntegrity(serverDbDest);

      const coordSrc = join(options.dataDir, 'coordinator');
      if (existsSync(coordSrc)) {
        const coordDest = join(stagingDir, 'coordinator');
        mkdirSync(coordDest, { recursive: true, mode: 0o700 });
        for (const file of readdirSync(coordSrc)) {
          if (!file.endsWith('.sqlite')) continue;
          const srcDb = new Database(join(coordSrc, file), { readonly: true });
          const destPath = join(coordDest, file);
          try {
            await srcDb.backup(destPath);
          } finally {
            srcDb.close();
          }
          verifySqliteIntegrity(destPath);
        }
      }

      for (const dirName of DATA_DIRS) {
        copyDirectoryTree(join(options.dataDir, dirName), join(stagingDir, dirName), 0o600);
      }
      if (options.skillsDir !== undefined) {
        copyDirectoryTree(options.skillsDir, join(stagingDir, 'skills'), 0o600);
      }
      for (const fileName of DATA_FILES) {
        const src = join(options.dataDir, fileName);
        if (existsSync(src)) {
          copyAtomic(src, join(stagingDir, fileName), 0o600);
        }
      }

      const dataEntries = collectDirectoryEntries(stagingDir);
      const files: Record<string, string> = {};
      for (const entry of dataEntries) {
        files[entry.path] = sha256Hex(entry.content);
      }
      const manifest: BackupManifest = {
        version: 1,
        id,
        createdAt: startedAt,
        kind,
        files,
        counts: readDbCounts(serverDbDest),
      };
      const manifestBuf = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
      const tarGz = packTarGz([
        ...dataEntries,
        { path: 'manifest.json', content: manifestBuf, mode: 0o600 },
      ]);
      const encrypted = encryptBackupPayload(tarGz, encryptionKey, id);

      const summary: BackupSnapshotSummary = {
        id,
        createdAt: startedAt,
        sizeBytes: encrypted.length,
        kind,
        storage: storageKind,
        verified: true,
      };
      const metaBuf = Buffer.from(`${JSON.stringify(summary, null, 2)}\n`, 'utf8');

      if (objectStore !== null) {
        await objectStore.putObject(remoteArchiveKey(id), encrypted, 'application/octet-stream');
        await objectStore.putObject(remoteMetaKey(id), metaBuf, 'application/json');
      }
      writeAtomic(localArchivePath(id), encrypted, 0o600);
      writeAtomic(localMetaPath(id), metaBuf, 0o600);

      await pruneRetention();
      recordStatus('success', '0', now());
      options.logger?.info(
        { snapshotId: id, sizeBytes: summary.sizeBytes, storage: storageKind, kind },
        'backup completed',
      );
      return summary;
    } catch (error) {
      recordStatus('error', sanitizeBackupErrorDetail(error), now());
      options.logger?.warn({ err: error, kind }, 'backup failed');
      throw error;
    } finally {
      rmSync(stagingDir, { recursive: true, force: true });
    }
  }

  async function runBackup(kind: BackupSnapshotKind = 'manual'): Promise<BackupSnapshotSummary> {
    if (inProgress || restorePending) throw new BackupInProgressError();
    inProgress = true;
    try {
      return await runBackupUnlocked(kind);
    } finally {
      inProgress = false;
    }
  }

  async function health(): Promise<BackupHealth> {
    const base = readBackupHealth(options.statusPath);
    const managed: BackupManagedInfo = {
      enabled: true,
      storage: storageKind,
      schedule: 'daily',
      inProgress: inProgress || restorePending,
      snapshots: await listSnapshots(),
    };
    return { ...base, managed };
  }

  async function exportArchive(): Promise<{
    filename: string;
    buffer: Buffer;
    snapshotId: string;
  }> {
    let latest = (await listSnapshots())[0];
    if (latest === undefined || now() - latest.createdAt > 5 * 60 * 1000) {
      latest = await runBackup('manual');
    }
    const encrypted = await readEncryptedSnapshot(latest.id);
    const tarGz = decryptBackupPayload(encrypted, encryptionKey, latest.id);
    const filteredEntries = unpackTarGz(tarGz).filter(
      (entry) => !EXPORT_EXCLUDED_PATHS.includes(entry.path),
    );
    const exportFiles: Record<string, string> = {};
    const nonManifest = filteredEntries.filter((entry) => entry.path !== 'manifest.json');
    for (const entry of nonManifest) {
      exportFiles[entry.path] = sha256Hex(entry.content);
    }
    const manifestEntry = filteredEntries.find((entry) => entry.path === 'manifest.json');
    const updatedEntries = [...nonManifest];
    if (manifestEntry !== undefined) {
      const parsed = parseManifest(manifestEntry.content.toString('utf8'));
      const exportManifest = { ...parsed, files: exportFiles };
      updatedEntries.push({
        path: 'manifest.json',
        content: Buffer.from(`${JSON.stringify(exportManifest, null, 2)}\n`, 'utf8'),
        mode: 0o600,
      });
    }
    const sanitizedTarGz = packTarGz(updatedEntries);
    const dateStamp = new Date(latest.createdAt).toISOString().slice(0, 10);
    return {
      filename: `cairn-backup-${dateStamp}.tar.gz`,
      buffer: sanitizedTarGz,
      snapshotId: latest.id,
    };
  }

  async function prepareRestore(snapshotId: string): Promise<BackupRestoreResult> {
    const validId = assertSnapshotId(snapshotId);
    if (inProgress || restorePending) {
      throw new BackupInProgressError();
    }
    inProgress = true;
    const stagedDir = join(
      options.dataDir,
      '.restore-staged',
      `${validId}-${randomBytes(4).toString('hex')}`,
    );
    try {
      ensureDiskSpace();
      const encrypted = await readEncryptedSnapshot(validId);
      const tarGz = decryptBackupPayload(encrypted, encryptionKey, validId);
      const entries = unpackTarGz(tarGz);
      extractEntriesToDir(entries, stagedDir);
      verifyExtractedSnapshot(stagedDir, validId);

      const undoSnapshot = await runBackupUnlocked('pre-restore');
      const marker: PendingRestoreRecord = {
        version: 1,
        snapshotId: validId,
        stagedDir,
        createdAt: now(),
      };
      writeAtomic(
        join(options.dataDir, RESTORE_MARKER),
        `${JSON.stringify(marker, null, 2)}\n`,
        0o600,
      );
      restorePending = true;
      const restarting = options.onRestart !== undefined;
      if (options.onRestart !== undefined) {
        setTimeout(() => options.onRestart?.(), 250).unref();
      }
      return {
        restoredId: validId,
        undoBackupId: undoSnapshot.id,
        restarting,
      };
    } catch (error) {
      rmSync(stagedDir, { recursive: true, force: true });
      throw error;
    } finally {
      inProgress = false;
    }
  }

  async function maybeRunScheduled(): Promise<void> {
    if (inProgress || restorePending) return;
    const current = readBackupHealth(options.statusPath);
    const lastSuccess = current.state === 'recorded' ? current.status.lastSuccessAt : null;
    if (lastSuccess !== null && now() - lastSuccess < DAY_MS) return;
    try {
      await runBackup('scheduled');
    } catch {}
  }

  return {
    health,
    runBackup,
    exportArchive,
    prepareRestore,
    start() {
      if (initialTimer !== null || periodicTimer !== null) return;
      initialTimer = setTimeout(() => {
        initialTimer = null;
        void maybeRunScheduled();
      }, options.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS);
      initialTimer.unref();
      periodicTimer = setInterval(() => {
        void maybeRunScheduled();
      }, options.intervalMs ?? CHECK_INTERVAL_MS);
      periodicTimer.unref();
    },
    stop() {
      if (initialTimer !== null) {
        clearTimeout(initialTimer);
        initialTimer = null;
      }
      if (periodicTimer !== null) {
        clearInterval(periodicTimer);
        periodicTimer = null;
      }
    },
  };
}
