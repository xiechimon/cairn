import { randomBytes } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statfsSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { hostname } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
import type { Readable } from 'node:stream';
import {
  type BackupHealth,
  type BackupImportResult,
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
import { createKeyfileSecretBox, type KeySecretBox } from '../lib/secret-box.js';
import {
  collectDirectoryEntries,
  decryptBackupPayload,
  encryptBackupPayload,
  extractEntriesToDir,
  extractTarGzStreamToDir,
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
const EXPORT_EXCLUDED_PATHS: readonly string[] = ['environment-id', 'secretbox.key', 'vapid.json'];
const HOST_IDENTITY_FILES: readonly string[] = ['environment-id', 'secretbox.key', 'vapid.json'];
const MAX_IMPORT_BYTES = 256 * 1024 * 1024;
const OAUTH_CIPHER_PREFIX = 'oauth-personal:';
const BOUND_OAUTH_CIPHER_PREFIX = `${OAUTH_CIPHER_PREFIX}v2:`;

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
  keepHost?: boolean;
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

export class BackupImportInvalidError extends Error {
  constructor(message = 'Invalid or corrupted backup archive.') {
    super(message);
    this.name = 'BackupImportInvalidError';
  }
}

export interface BackupImportOptions {
  keepHost?: boolean;
  pauseExternalConnectors?: boolean;
}

export interface BackupService {
  health(): Promise<BackupHealth>;
  runBackup(kind?: BackupSnapshotKind): Promise<BackupSnapshotSummary>;
  exportArchive(): Promise<{ filename: string; buffer: Buffer; snapshotId: string }>;
  prepareRestore(snapshotId: string): Promise<BackupRestoreResult>;
  prepareImport(
    archive: Buffer | Readable,
    options?: BackupImportOptions,
  ): Promise<BackupImportResult>;
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

function finalizeStagedSqlite(dbFilePath: string): void {
  const rw = new Database(dbFilePath);
  try {
    rw.pragma('wal_checkpoint(TRUNCATE)');
    rw.pragma('journal_mode = DELETE');
  } finally {
    rw.close();
  }
  removeWalSidecars(dbFilePath);
}

function installVerifiedDirIntoDataDir(
  stagedDir: string,
  dataDir: string,
  dbPath: string,
  skillsDir?: string,
  keepHost = false,
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

  if (!keepHost) {
    for (const fileName of DATA_FILES) {
      const src = join(stagedDir, fileName);
      if (existsSync(src)) {
        copyAtomic(src, join(dataDir, fileName), 0o600);
      }
    }
  }
}

function hasSqliteTable(db: Database.Database, name: string): boolean {
  return (
    db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) !==
    undefined
  );
}

function unwrapCipherPrefix(raw: string): { prefix: string; envelope: string } {
  if (raw.startsWith(BOUND_OAUTH_CIPHER_PREFIX)) {
    return {
      prefix: BOUND_OAUTH_CIPHER_PREFIX,
      envelope: raw.slice(BOUND_OAUTH_CIPHER_PREFIX.length),
    };
  }
  if (raw.startsWith(OAUTH_CIPHER_PREFIX)) {
    return {
      prefix: OAUTH_CIPHER_PREFIX,
      envelope: raw.slice(OAUTH_CIPHER_PREFIX.length),
    };
  }
  return { prefix: '', envelope: raw };
}

function canOpenCipher(raw: string, box: KeySecretBox): boolean {
  try {
    box.open(unwrapCipherPrefix(raw).envelope);
    return true;
  } catch {
    return false;
  }
}

function resealCipherValue(raw: string, sourceBox: KeySecretBox, targetBox: KeySecretBox): string {
  const { prefix, envelope } = unwrapCipherPrefix(raw);
  return `${prefix}${targetBox.seal(sourceBox.open(envelope))}`;
}

function resealAllTables(
  rw: Database.Database,
  sourceBox: KeySecretBox,
  targetBox: KeySecretBox,
): number {
  let updated = 0;

  if (hasSqliteTable(rw, 'provider')) {
    const rows = rw
      .prepare('SELECT id, apiKeyCipher FROM provider WHERE apiKeyCipher IS NOT NULL')
      .all() as Array<{ id: string; apiKeyCipher: string }>;
    const stmt = rw.prepare('UPDATE provider SET apiKeyCipher = ? WHERE id = ?');
    for (const row of rows) {
      stmt.run(resealCipherValue(row.apiKeyCipher, sourceBox, targetBox), row.id);
      updated += 1;
    }
  }

  if (hasSqliteTable(rw, 'secret')) {
    const rows = rw
      .prepare(
        'SELECT id, valueCipher, usernameCipher, envSeal FROM secret WHERE valueCipher IS NOT NULL OR usernameCipher IS NOT NULL',
      )
      .all() as Array<{
      id: string;
      valueCipher: string | null;
      usernameCipher: string | null;
      envSeal: string | null;
    }>;
    const stmt = rw.prepare(
      'UPDATE secret SET valueCipher = ?, usernameCipher = ?, envSeal = ? WHERE id = ?',
    );
    for (const row of rows) {
      const nextValueCipher =
        row.valueCipher === null ? null : resealCipherValue(row.valueCipher, sourceBox, targetBox);
      const nextUsernameCipher =
        row.usernameCipher === null
          ? null
          : resealCipherValue(row.usernameCipher, sourceBox, targetBox);
      const wasEnv =
        row.valueCipher !== null &&
        row.envSeal !== null &&
        row.envSeal === sha256Hex(Buffer.from(row.valueCipher, 'utf8'));
      const nextEnvSeal =
        wasEnv && nextValueCipher !== null
          ? sha256Hex(Buffer.from(nextValueCipher, 'utf8'))
          : row.envSeal;
      stmt.run(nextValueCipher, nextUsernameCipher, nextEnvSeal, row.id);
      updated += 1;
    }
  }

  if (hasSqliteTable(rw, 'github_connection')) {
    const rows = rw
      .prepare('SELECT teamId, accessTokenCipher, refreshTokenCipher FROM github_connection')
      .all() as Array<{
      teamId: string;
      accessTokenCipher: string;
      refreshTokenCipher: string | null;
    }>;
    const stmt = rw.prepare(
      'UPDATE github_connection SET accessTokenCipher = ?, refreshTokenCipher = ? WHERE teamId = ?',
    );
    for (const row of rows) {
      stmt.run(
        resealCipherValue(row.accessTokenCipher, sourceBox, targetBox),
        row.refreshTokenCipher === null
          ? null
          : resealCipherValue(row.refreshTokenCipher, sourceBox, targetBox),
        row.teamId,
      );
      updated += 1;
    }
  }

  for (const table of ['claude_subscription', 'devin_subscription'] as const) {
    if (!hasSqliteTable(rw, table)) continue;
    const rows = rw.prepare(`SELECT id, tokenCipher FROM ${table}`).all() as Array<{
      id: string;
      tokenCipher: string;
    }>;
    const stmt = rw.prepare(`UPDATE ${table} SET tokenCipher = ? WHERE id = ?`);
    for (const row of rows) {
      stmt.run(resealCipherValue(row.tokenCipher, sourceBox, targetBox), row.id);
      updated += 1;
    }
  }

  if (hasSqliteTable(rw, 'antigravity_subscription')) {
    const rows = rw
      .prepare('SELECT id, tokenCipher FROM antigravity_subscription WHERE tokenCipher IS NOT NULL')
      .all() as Array<{ id: string; tokenCipher: string }>;
    const stmt = rw.prepare('UPDATE antigravity_subscription SET tokenCipher = ? WHERE id = ?');
    for (const row of rows) {
      stmt.run(resealCipherValue(row.tokenCipher, sourceBox, targetBox), row.id);
      updated += 1;
    }
  }

  if (hasSqliteTable(rw, 'mcp_connector')) {
    const rows = rw
      .prepare(
        'SELECT id, valuesCipher, oauthCipher FROM mcp_connector WHERE valuesCipher IS NOT NULL OR oauthCipher IS NOT NULL',
      )
      .all() as Array<{ id: string; valuesCipher: string | null; oauthCipher: string | null }>;
    const stmt = rw.prepare(
      'UPDATE mcp_connector SET valuesCipher = ?, oauthCipher = ? WHERE id = ?',
    );
    for (const row of rows) {
      stmt.run(
        row.valuesCipher === null
          ? null
          : resealCipherValue(row.valuesCipher, sourceBox, targetBox),
        row.oauthCipher === null ? null : resealCipherValue(row.oauthCipher, sourceBox, targetBox),
        row.id,
      );
      updated += 1;
    }
  }

  if (hasSqliteTable(rw, 'im_connection')) {
    const rows = rw.prepare('SELECT id, secretCipher FROM im_connection').all() as Array<{
      id: string;
      secretCipher: string;
    }>;
    const stmt = rw.prepare('UPDATE im_connection SET secretCipher = ? WHERE id = ?');
    for (const row of rows) {
      stmt.run(resealCipherValue(row.secretCipher, sourceBox, targetBox), row.id);
      updated += 1;
    }
  }

  return updated;
}

function scrubUnreadableTables(rw: Database.Database, targetBox: KeySecretBox): number {
  let cleared = 0;

  if (hasSqliteTable(rw, 'provider')) {
    const rows = rw
      .prepare('SELECT id, apiKeyCipher FROM provider WHERE apiKeyCipher IS NOT NULL')
      .all() as Array<{ id: string; apiKeyCipher: string }>;
    const stmt = rw.prepare('UPDATE provider SET apiKeyCipher = NULL WHERE id = ?');
    for (const row of rows) {
      if (!canOpenCipher(row.apiKeyCipher, targetBox)) {
        stmt.run(row.id);
        cleared += 1;
      }
    }
  }

  if (hasSqliteTable(rw, 'secret')) {
    const rows = rw
      .prepare(
        'SELECT id, valueCipher, usernameCipher FROM secret WHERE valueCipher IS NOT NULL OR usernameCipher IS NOT NULL',
      )
      .all() as Array<{ id: string; valueCipher: string | null; usernameCipher: string | null }>;
    const stmt = rw.prepare(
      'UPDATE secret SET valueCipher = NULL, usernameCipher = NULL, envSeal = NULL WHERE id = ?',
    );
    for (const row of rows) {
      const valueBroken = row.valueCipher !== null && !canOpenCipher(row.valueCipher, targetBox);
      const userBroken =
        row.usernameCipher !== null && !canOpenCipher(row.usernameCipher, targetBox);
      if (valueBroken || userBroken) {
        stmt.run(row.id);
        cleared += 1;
      }
    }
  }

  if (hasSqliteTable(rw, 'github_connection')) {
    const rows = rw
      .prepare('SELECT teamId, accessTokenCipher, refreshTokenCipher FROM github_connection')
      .all() as Array<{
      teamId: string;
      accessTokenCipher: string;
      refreshTokenCipher: string | null;
    }>;
    const delStmt = rw.prepare('DELETE FROM github_connection WHERE teamId = ?');
    const clearRefreshStmt = rw.prepare(
      'UPDATE github_connection SET refreshTokenCipher = NULL WHERE teamId = ?',
    );
    for (const row of rows) {
      if (!canOpenCipher(row.accessTokenCipher, targetBox)) {
        delStmt.run(row.teamId);
        cleared += 1;
      } else if (
        row.refreshTokenCipher !== null &&
        !canOpenCipher(row.refreshTokenCipher, targetBox)
      ) {
        clearRefreshStmt.run(row.teamId);
        cleared += 1;
      }
    }
  }

  for (const table of ['claude_subscription', 'devin_subscription'] as const) {
    if (!hasSqliteTable(rw, table)) continue;
    const rows = rw.prepare(`SELECT id, tokenCipher FROM ${table}`).all() as Array<{
      id: string;
      tokenCipher: string;
    }>;
    const delStmt = rw.prepare(`DELETE FROM ${table} WHERE id = ?`);
    for (const row of rows) {
      if (!canOpenCipher(row.tokenCipher, targetBox)) {
        delStmt.run(row.id);
        cleared += 1;
      }
    }
  }

  if (hasSqliteTable(rw, 'antigravity_subscription')) {
    const rows = rw
      .prepare(
        'SELECT id, tokenCipher, runnerId FROM antigravity_subscription WHERE tokenCipher IS NOT NULL',
      )
      .all() as Array<{ id: string; tokenCipher: string; runnerId: string | null }>;
    const clearTokenStmt = rw.prepare(
      'UPDATE antigravity_subscription SET tokenCipher = NULL WHERE id = ?',
    );
    const delStmt = rw.prepare('DELETE FROM antigravity_subscription WHERE id = ?');
    for (const row of rows) {
      if (!canOpenCipher(row.tokenCipher, targetBox)) {
        if (row.runnerId !== null) clearTokenStmt.run(row.id);
        else delStmt.run(row.id);
        cleared += 1;
      }
    }
  }

  if (hasSqliteTable(rw, 'mcp_connector')) {
    const rows = rw
      .prepare(
        'SELECT id, valuesCipher, oauthCipher FROM mcp_connector WHERE valuesCipher IS NOT NULL OR oauthCipher IS NOT NULL',
      )
      .all() as Array<{ id: string; valuesCipher: string | null; oauthCipher: string | null }>;
    const stmt = rw.prepare(
      'UPDATE mcp_connector SET valuesCipher = ?, oauthCipher = ? WHERE id = ?',
    );
    for (const row of rows) {
      const clearValues = row.valuesCipher !== null && !canOpenCipher(row.valuesCipher, targetBox);
      const clearOauth = row.oauthCipher !== null && !canOpenCipher(row.oauthCipher, targetBox);
      if (clearValues || clearOauth) {
        stmt.run(
          clearValues ? null : row.valuesCipher,
          clearOauth ? null : row.oauthCipher,
          row.id,
        );
        cleared += 1;
      }
    }
  }

  if (hasSqliteTable(rw, 'im_connection')) {
    const rows = rw.prepare('SELECT id, secretCipher FROM im_connection').all() as Array<{
      id: string;
      secretCipher: string;
    }>;
    const stmt = rw.prepare(
      "UPDATE im_connection SET secretCipher = ?, status = 'expired', statusDetail = 'Credentials excluded from portable export — reconnect to re-enter credentials on this host.', pollOffset = NULL WHERE id = ?",
    );
    for (const row of rows) {
      if (!canOpenCipher(row.secretCipher, targetBox)) {
        stmt.run(targetBox.seal('{}'), row.id);
        cleared += 1;
      }
    }
  }

  return cleared;
}

function reconcileStagedCredentials(
  stagedDir: string,
  stagedDbPath: string,
  targetDataDir: string,
  keepHost: boolean,
): { resealedCredentials: number; clearedCredentials: number } {
  const stagedKeyPath = join(stagedDir, 'secretbox.key');
  const hasArchiveKey = existsSync(stagedKeyPath);
  if (hasArchiveKey && !keepHost) {
    try {
      createKeyfileSecretBox(stagedKeyPath);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Invalid secretbox.key inside backup archive.';
      throw new BackupImportInvalidError(message);
    }
    return { resealedCredentials: 0, clearedCredentials: 0 };
  }

  const targetBox = createKeyfileSecretBox(join(targetDataDir, 'secretbox.key'));
  let sourceBox: KeySecretBox | null = null;
  if (hasArchiveKey && keepHost) {
    try {
      sourceBox = createKeyfileSecretBox(stagedKeyPath);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Invalid secretbox.key inside backup archive.';
      throw new BackupImportInvalidError(message);
    }
  }

  const rw = new Database(stagedDbPath);
  let resealedCredentials = 0;
  let clearedCredentials = 0;
  try {
    const tx = rw.transaction(() => {
      if (sourceBox !== null) {
        try {
          resealedCredentials = resealAllTables(rw, sourceBox, targetBox);
        } catch (error) {
          const message =
            error instanceof Error
              ? `Archive credentials could not be opened with archive keyfile: ${error.message}`
              : 'Archive credentials could not be opened with archive keyfile.';
          throw new BackupImportInvalidError(message);
        }
      } else {
        clearedCredentials = scrubUnreadableTables(rw, targetBox);
      }
    });
    tx();
    rw.pragma('wal_checkpoint(TRUNCATE)');
    rw.pragma('journal_mode = DELETE');
  } finally {
    rw.close();
  }
  removeWalSidecars(stagedDbPath);
  verifySqliteIntegrity(stagedDbPath);
  return { resealedCredentials, clearedCredentials };
}

function pauseStagedConnectors(stagedDbPath: string): {
  pausedImConnections: number;
  pausedSchedules: number;
  pausedMailAccounts: number;
} {
  const rw = new Database(stagedDbPath);
  let pausedImConnections = 0;
  let pausedSchedules = 0;
  let pausedMailAccounts = 0;
  try {
    if (hasSqliteTable(rw, 'im_connection')) {
      pausedImConnections = rw
        .prepare(
          "UPDATE im_connection SET status = 'expired', statusDetail = 'Paused after data import — reconnect to resume on this host.', pollOffset = NULL WHERE status IN ('connecting', 'ready', 'degraded')",
        )
        .run().changes;
    }
    if (hasSqliteTable(rw, 'schedule')) {
      pausedSchedules = rw
        .prepare(
          "UPDATE schedule SET enabled = 0, pausedReason = 'Paused after data import — re-enable when ready on this host.' WHERE enabled = 1",
        )
        .run().changes;
    }
    if (hasSqliteTable(rw, 'mail_account')) {
      pausedMailAccounts = rw
        .prepare(
          "UPDATE mail_account SET status = 'disconnected', lastError = 'Paused after data import — reconnect to resume on this host.' WHERE status IN ('connecting', 'watching', 'degraded')",
        )
        .run().changes;
    }
    rw.pragma('wal_checkpoint(TRUNCATE)');
    rw.pragma('journal_mode = DELETE');
  } finally {
    rw.close();
  }
  removeWalSidecars(stagedDbPath);
  verifySqliteIntegrity(stagedDbPath);
  return { pausedImConnections, pausedSchedules, pausedMailAccounts };
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
  const canonicalParent = existsSync(stagedParent) ? realpathSync(stagedParent) : stagedParent;
  const canonicalStaged = existsSync(stagedPath) ? realpathSync(stagedPath) : stagedPath;
  if (!canonicalStaged.startsWith(`${canonicalParent}${sep}`) || !existsSync(canonicalStaged)) {
    logger?.warn({ snapshotId: record.snapshotId }, 'pending restore staging directory missing');
    rmSync(markerPath, { force: true });
    rmSync(stagedParent, { recursive: true, force: true });
    return null;
  }
  verifyExtractedSnapshot(canonicalStaged, record.snapshotId);
  installVerifiedDirIntoDataDir(
    canonicalStaged,
    dataDir,
    dbPath,
    skillsDir,
    record.keepHost === true,
  );
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

  async function buildSnapshotBundle(
    id: string,
    startedAt: number,
    kind: BackupSnapshotKind,
    includeHostIdentity: boolean,
  ): Promise<{ manifest: BackupManifest; tarGz: Buffer }> {
    const stagingDir = join(backupsDir, `.staging-${id}`);
    try {
      ensureDiskSpace();
      mkdirSync(stagingDir, { recursive: true, mode: 0o700 });

      const serverDbDest = join(stagingDir, 'server.db');
      await options.sqlite.backup(serverDbDest);
      finalizeStagedSqlite(serverDbDest);
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
          finalizeStagedSqlite(destPath);
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
        if (!includeHostIdentity && EXPORT_EXCLUDED_PATHS.includes(fileName)) continue;
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
      return { manifest, tarGz };
    } finally {
      rmSync(stagingDir, { recursive: true, force: true });
    }
  }

  async function runBackupUnlocked(kind: BackupSnapshotKind): Promise<BackupSnapshotSummary> {
    const startedAt = now();
    const id = formatSnapshotId(startedAt);
    try {
      const { tarGz } = await buildSnapshotBundle(id, startedAt, kind, true);
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
    if (inProgress || restorePending) {
      throw new BackupInProgressError();
    }
    inProgress = true;
    try {
      const startedAt = now();
      const snapshotId = formatSnapshotId(startedAt);
      const { tarGz } = await buildSnapshotBundle(snapshotId, startedAt, 'manual', false);
      const dateStamp = new Date(startedAt).toISOString().slice(0, 10);
      return {
        filename: `cairn-backup-${dateStamp}.tar.gz`,
        buffer: tarGz,
        snapshotId,
      };
    } finally {
      inProgress = false;
    }
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
      await extractTarGzStreamToDir(tarGz, stagedDir);
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
      const stagedParent = join(options.dataDir, '.restore-staged');
      if (existsSync(stagedParent) && readdirSync(stagedParent).length === 0) {
        rmSync(stagedParent, { recursive: true, force: true });
      }
      throw error;
    } finally {
      inProgress = false;
    }
  }

  async function prepareImport(
    archive: Buffer | Readable,
    importOptions: BackupImportOptions = {},
  ): Promise<BackupImportResult> {
    if (inProgress || restorePending) {
      throw new BackupInProgressError();
    }
    if (Buffer.isBuffer(archive) && (archive.length === 0 || archive.length > MAX_IMPORT_BYTES)) {
      throw new BackupImportInvalidError(
        'Backup archive is empty or exceeds maximum allowed size.',
      );
    }
    const keepHost = importOptions.keepHost ?? true;
    const pauseExternalConnectors = importOptions.pauseExternalConnectors ?? true;
    inProgress = true;
    const stagedDir = join(
      options.dataDir,
      '.restore-staged',
      `import-${randomBytes(6).toString('hex')}`,
    );
    try {
      let manifest: BackupManifest;
      try {
        await extractTarGzStreamToDir(archive, stagedDir, { maxCompressedBytes: MAX_IMPORT_BYTES });
        const manifestPath = join(stagedDir, 'manifest.json');
        if (!existsSync(manifestPath)) {
          throw new Error('backup archive is missing manifest.json');
        }
        const rawManifest = parseManifest(readFileSync(manifestPath, 'utf8'));
        manifest = verifyExtractedSnapshot(stagedDir, rawManifest.id);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Invalid or corrupted backup archive.';
        throw new BackupImportInvalidError(message);
      }

      const stagedDbPath = join(stagedDir, 'server.db');
      let pausedImConnections = 0;
      let pausedSchedules = 0;
      let pausedMailAccounts = 0;
      if (pauseExternalConnectors) {
        const paused = pauseStagedConnectors(stagedDbPath);
        pausedImConnections = paused.pausedImConnections;
        pausedSchedules = paused.pausedSchedules;
        pausedMailAccounts = paused.pausedMailAccounts;
      }

      const { resealedCredentials, clearedCredentials } = reconcileStagedCredentials(
        stagedDir,
        stagedDbPath,
        options.dataDir,
        keepHost,
      );

      if (keepHost) {
        for (const relPath of HOST_IDENTITY_FILES) {
          rmSync(join(stagedDir, relPath), { force: true });
          delete manifest.files[relPath];
        }
      }
      removeWalSidecars(stagedDbPath);

      manifest.files['server.db'] = sha256Hex(readFileSync(stagedDbPath));
      manifest.counts = readDbCounts(stagedDbPath);
      writeAtomic(
        join(stagedDir, 'manifest.json'),
        `${JSON.stringify(manifest, null, 2)}\n`,
        0o600,
      );
      verifyExtractedSnapshot(stagedDir, manifest.id);

      ensureDiskSpace();
      const undoSnapshot = await runBackupUnlocked('pre-restore');
      const marker: PendingRestoreRecord = {
        version: 1,
        snapshotId: manifest.id,
        stagedDir,
        createdAt: now(),
        keepHost,
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
        importedId: manifest.id,
        undoBackupId: undoSnapshot.id,
        restarting,
        pausedImConnections,
        pausedSchedules,
        pausedMailAccounts,
        resealedCredentials,
        clearedCredentials,
        counts: manifest.counts,
      };
    } catch (error) {
      rmSync(stagedDir, { recursive: true, force: true });
      const stagedParent = join(options.dataDir, '.restore-staged');
      if (existsSync(stagedParent) && readdirSync(stagedParent).length === 0) {
        rmSync(stagedParent, { recursive: true, force: true });
      }
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
    prepareImport,
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
