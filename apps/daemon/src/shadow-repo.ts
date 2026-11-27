import { execFile, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import {
  CACHEDIR_TAG_SIGNATURE,
  isPlainFolderExcluded,
  type LocalFolderActionResult,
  PLAIN_FOLDER_EXCLUDES,
  PLAIN_FOLDER_GIT_TIMEOUT_MS,
  PLAIN_FOLDER_HUGE_BYTES,
  type PlainFolderStatus,
  type PlainFolderStepMeta,
} from '@cairn/shared';
import { childEnv } from './child-env.js';
import { gitPrim, runGit } from './git.js';
import type { DaemonLogger } from './log.js';

const execFileAsync = promisify(execFile);

const FULL_SHA = /^[0-9a-f]{40,64}$/;
const GC_EVERY_COMMITS = 25;
const SHADOW_GITCONFIG = [
  '[commit]',
  '\tgpgsign = false',
  '[core]',
  '\tautocrlf = false',
  '\tquotepath = false',
  '\tprecomposeunicode = true',
  '\tignorecase = false',
  '[gc]',
  '\tauto = 0',
  '',
].join('\n');

export class ShadowGitTimeoutError extends Error {
  constructor(command: string, timeoutMs: number) {
    super(`shadow git ${command} timed out after ${Math.round(timeoutMs / 1000)} s`);
    this.name = 'ShadowGitTimeoutError';
  }
}

export class ShadowDiskFullError extends Error {
  constructor(detail: string) {
    super(`disk full while operating on plain folder: ${detail}`);
    this.name = 'ShadowDiskFullError';
  }
}

export class ShadowPartialApplyError extends Error {
  constructor(detail: string) {
    super(`partial write-back failure: ${detail}`);
    this.name = 'ShadowPartialApplyError';
  }
}

export class ShadowConcurrentEditError extends Error {
  constructor(readonly conflictFiles: string[]) {
    super(`target files modified concurrently during write-back: ${conflictFiles.join(', ')}`);
    this.name = 'ShadowConcurrentEditError';
  }
}

export class ShadowCowFallbackTooLargeError extends Error {
  constructor(readonly bytes: number) {
    super(`plain folder total size (${bytes} bytes) exceeds CoW fallback budget`);
    this.name = 'ShadowCowFallbackTooLargeError';
  }
}

export class ShadowGitUnsupportedError extends Error {
  constructor(detail: string) {
    super(`git >= 2.38 is required for plain local folders (${detail})`);
    this.name = 'ShadowGitUnsupportedError';
  }
}

export interface ShadowDeliveryLeg {
  stepId: string;
  preCommit: string;
  postCommit: string;
}

export interface TaskShadowRecord {
  convId: string;
  projectId: string;
  mode: 'isolated' | 'in-place';
  realFolder: string;
  canonicalFolder: string;
  folderDev: number;
  folderIno: number;
  workDir: string;
  shadowDir: string;
  initialBaseCommit: string | null;
  legBaseCommit: string | null;
  headCommit: string | null;
  deliveries: ShadowDeliveryLeg[];
  status: PlainFolderStatus | 'running';
  conflictFiles: string[];
  reason?: string;
  checkpointsDisabled?: boolean;
  lastActionReceipts: Record<string, LocalFolderActionResult>;
}

interface ShadowWriteJournal {
  buildId: string;
  stepId?: string;
  action: 'merge' | 'undo';
  state: 'applying' | 'applied' | 'partial-unknown';
  preCommit: string;
  targetTree: string;
  postCommit?: string;
  updatedAt: number;
}

export type ShadowCopyImpl = (src: string, dst: string) => Promise<void>;
export type ShadowWriteFileImpl = (target: string, content: Buffer, mode: number) => void;

export interface ShadowManagerOpts {
  logger: DaemonLogger;
  hugeFolderBytes?: number;
  gitTimeoutMs?: number;
  copyImpl?: ShadowCopyImpl;
  writeFileImpl?: ShadowWriteFileImpl;
}

interface RawGitResult {
  code: number | null;
  stdout: Buffer;
  stderr: string;
  timedOut: boolean;
}

function isDiskFullMessage(text: string): boolean {
  return /no space left on device|\benospc\b/i.test(text);
}

export function isDiskFullError(err: unknown): boolean {
  if (err instanceof ShadowDiskFullError) return true;
  const code = (err as NodeJS.ErrnoException | null)?.code;
  if (code === 'ENOSPC') return true;
  const msg = err instanceof Error ? err.message : String(err);
  return isDiskFullMessage(msg);
}

function isSafeRepoPath(path: string): boolean {
  if (path === '' || path.startsWith('/') || path.includes('\0')) return false;
  return !path.split('/').includes('..');
}

function gitBlobSha1(buf: Buffer): string {
  const header = Buffer.from(`blob ${buf.length}\0`, 'utf8');
  return createHash('sha1').update(header).update(buf).digest('hex');
}

function measureTotalBytes(root: string, limitBytes: number): number {
  const stack: string[] = [root];
  let total = 0;
  while (stack.length > 0) {
    const dir = stack.pop();
    if (dir === undefined) break;
    let entries: string[] = [];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      const full = join(dir, name);
      let st: ReturnType<typeof lstatSync>;
      try {
        st = lstatSync(full);
      } catch {
        continue;
      }
      if (st.isSymbolicLink()) continue;
      if (st.isDirectory()) {
        stack.push(full);
      } else if (st.isFile()) {
        total += st.size;
        if (total > limitBytes) return total;
      }
    }
  }
  return total;
}

function canonicalFolderPath(dir: string): string {
  try {
    return realpathSync.native(resolve(dir));
  } catch {
    return resolve(dir);
  }
}

function sameOrOverlappingPath(a: string, b: string): boolean {
  const norm = (p: string) =>
    process.platform === 'darwin' || process.platform === 'win32' ? p.toLowerCase() : p;
  const na = norm(a);
  const nb = norm(b);
  if (na === nb) return true;
  const pa = na.endsWith(sep) ? na : na + sep;
  const pb = nb.endsWith(sep) ? nb : nb + sep;
  return na.startsWith(pb) || nb.startsWith(pa);
}

function escapeGitExcludeDir(relDir: string): string {
  const clean = relDir.endsWith('/') ? relDir : `${relDir}/`;
  return `/${clean.replace(/[\\*?[\]#! ]/g, '\\$&')}`;
}

export function scanPlainFolder(
  root: string,
  thresholdBytes: number,
): { huge: boolean; bytes: number; cacheTagDirs: string[] } {
  const canonicalRoot = canonicalFolderPath(root);
  const stack: string[] = [canonicalRoot];
  const cacheTagDirs: string[] = [];
  let bytes = 0;
  let huge = false;
  while (stack.length > 0) {
    const dir = stack.pop();
    if (dir === undefined) break;
    let entries: string[] = [];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    const relDir = relative(canonicalRoot, dir).split(sep).join('/');
    if (relDir !== '' && entries.includes('CACHEDIR.TAG')) {
      const tagPath = join(dir, 'CACHEDIR.TAG');
      try {
        const tagStat = lstatSync(tagPath);
        if (
          tagStat.isFile() &&
          tagStat.size <= 4096 &&
          readFileSync(tagPath, 'utf8').startsWith(CACHEDIR_TAG_SIGNATURE)
        ) {
          cacheTagDirs.push(escapeGitExcludeDir(relDir));
          continue;
        }
      } catch {}
    }
    for (const name of entries) {
      const full = join(dir, name);
      let stat: ReturnType<typeof lstatSync>;
      try {
        stat = lstatSync(full);
      } catch {
        continue;
      }
      if (stat.isSymbolicLink()) continue;
      const rel = relDir === '' ? name : `${relDir}/${name}`;
      if (stat.isDirectory()) {
        if (isPlainFolderExcluded(rel, true)) continue;
        stack.push(full);
      } else if (stat.isFile()) {
        if (isPlainFolderExcluded(rel, false)) continue;
        bytes += stat.size;
        if (bytes > thresholdBytes) {
          huge = true;
          break;
        }
      }
    }
    if (huge) break;
  }
  return { huge, bytes, cacheTagDirs };
}

function shadowGitEnv(
  shadowDir: string,
  workTree: string | null,
  indexFile?: string,
): Record<string, string> {
  const env = childEnv();
  for (const key of Object.keys(env)) {
    if (key.startsWith('GIT_')) delete env[key];
  }
  env.GIT_DIR = join(shadowDir, '.git');
  env.GIT_CONFIG_GLOBAL = join(shadowDir, 'gitconfig');
  env.GIT_CONFIG_SYSTEM = join(shadowDir, 'gitconfig_empty');
  env.GIT_CONFIG_NOSYSTEM = '1';
  env.GIT_AUTHOR_NAME = 'cairn-shadow';
  env.GIT_AUTHOR_EMAIL = 'shadow@cairn.invalid';
  env.GIT_COMMITTER_NAME = 'cairn-shadow';
  env.GIT_COMMITTER_EMAIL = 'shadow@cairn.invalid';
  env.GIT_TERMINAL_PROMPT = '0';
  env.GIT_NO_REPLACE_OBJECTS = '1';
  if (workTree !== null) env.GIT_WORK_TREE = workTree;
  if (indexFile !== undefined) env.GIT_INDEX_FILE = indexFile;
  return env;
}

function parseMergeTreeZ(stdout: Buffer): {
  tree: string;
  conflictFiles: string[];
} {
  const parts = stdout.toString('utf8').split('\0');
  const tree = (parts[0] ?? '').trim();
  const conflictFiles: string[] = [];
  for (let i = 1; i < parts.length; i++) {
    const part = parts[i];
    if (part === undefined || part === '') break;
    conflictFiles.push(part);
  }
  return { tree, conflictFiles };
}

function assertInsideRealRoot(realRoot: string, relPath: string): string {
  const parts = relPath.split('/').filter(Boolean);
  let cur = realRoot;
  for (let i = 0; i < parts.length - 1; i++) {
    cur = join(cur, parts[i] ?? '');
    if (existsSync(cur)) {
      const st = lstatSync(cur);
      if (st.isSymbolicLink()) {
        throw new Error(`refusing to traverse symlink parent during write-back: ${relPath}`);
      }
    }
  }
  const target = join(realRoot, ...parts);
  const resolvedParent = resolve(dirname(target));
  if (
    resolvedParent !== realRoot &&
    !resolvedParent.startsWith(realRoot.endsWith(sep) ? realRoot : realRoot + sep)
  ) {
    throw new Error(`target escapes root folder: ${relPath}`);
  }
  return target;
}

function pruneEmptyParents(dir: string, stopAt: string): void {
  let cur = dir;
  while (cur !== stopAt && cur.startsWith(stopAt.endsWith(sep) ? stopAt : stopAt + sep)) {
    try {
      if (readdirSync(cur).length > 0) break;
      rmSync(cur, { recursive: true, force: true });
      cur = dirname(cur);
    } catch {
      break;
    }
  }
}

export class ShadowManager {
  private readonly logger: DaemonLogger;
  private readonly hugeFolderBytes: number;
  private readonly gitTimeoutMs: number;
  private readonly copyImpl?: ShadowCopyImpl;
  private readonly writeFileImpl?: ShadowWriteFileImpl;
  private readonly disabledShadows = new Set<string>();
  private readonly commitsSinceGc = new Map<string, number>();
  private readonly workDirToTaskMeta = new Map<string, string>();
  private readonly activeInPlace = new Map<symbol, string>();
  private readonly activeWriteOps = new Map<symbol, string>();
  private readonly waiters = new Set<() => void>();

  constructor(opts: ShadowManagerOpts) {
    this.logger = opts.logger;
    this.hugeFolderBytes = opts.hugeFolderBytes ?? PLAIN_FOLDER_HUGE_BYTES;
    this.gitTimeoutMs = opts.gitTimeoutMs ?? PLAIN_FOLDER_GIT_TIMEOUT_MS;
    if (opts.copyImpl !== undefined) this.copyImpl = opts.copyImpl;
    if (opts.writeFileImpl !== undefined) this.writeFileImpl = opts.writeFileImpl;
  }

  shadowDirFor(workspacesRoot: string, realFolder: string): string {
    const canonical = canonicalFolderPath(realFolder);
    const key = createHash('sha256').update(canonical).digest('hex').slice(0, 16);
    return join(workspacesRoot, 'shadows', key);
  }

  isDisabled(shadowDir: string): boolean {
    return this.disabledShadows.has(shadowDir);
  }

  private hasOverlap(map: ReadonlyMap<symbol, string>, canonical: string): boolean {
    for (const active of map.values()) {
      if (sameOrOverlappingPath(active, canonical)) return true;
    }
    return false;
  }

  private notifyWaiters(): void {
    for (const wake of [...this.waiters]) wake();
  }

  private waitNextWake(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) {
      return Promise.reject(new Error('Aborted while waiting for local folder lock'));
    }
    return new Promise<void>((resolvePromise, rejectPromise) => {
      const cleanup = () => {
        this.waiters.delete(wake);
        signal?.removeEventListener('abort', onAbort);
      };
      const wake = () => {
        cleanup();
        resolvePromise();
      };
      const onAbort = () => {
        cleanup();
        rejectPromise(new Error('Aborted while waiting for local folder lock'));
      };
      this.waiters.add(wake);
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  private async withFolderWriteLock<T>(
    canonicalFolder: string,
    fn: () => Promise<T>,
    opts: { allowWhileInPlace?: boolean } = {},
  ): Promise<T> {
    const canonical = canonicalFolderPath(canonicalFolder);
    const ready = () =>
      !this.hasOverlap(this.activeWriteOps, canonical) &&
      (opts.allowWhileInPlace === true || !this.hasOverlap(this.activeInPlace, canonical));
    while (!ready()) {
      await this.waitNextWake();
    }
    const token = Symbol('write-op');
    this.activeWriteOps.set(token, canonical);
    try {
      return await fn();
    } finally {
      this.activeWriteOps.delete(token);
      this.notifyWaiters();
    }
  }

  async acquireInPlaceLease(canonicalFolder: string, signal?: AbortSignal): Promise<() => void> {
    const canonical = canonicalFolderPath(canonicalFolder);
    const ready = () =>
      !this.hasOverlap(this.activeInPlace, canonical) &&
      !this.hasOverlap(this.activeWriteOps, canonical);
    while (!ready()) {
      await this.waitNextWake(signal);
    }
    const token = Symbol('in-place');
    this.activeInPlace.set(token, canonical);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.activeInPlace.delete(token);
      this.notifyWaiters();
    };
  }

  measureFolder(realFolder: string): { huge: boolean; bytes: number; cacheTagDirs: string[] } {
    return scanPlainFolder(realFolder, this.hugeFolderBytes);
  }

  private async runShadowGitRaw(
    shadowDir: string,
    args: string[],
    opts: { workTree?: string | null; indexFile?: string; cwd?: string } = {},
  ): Promise<RawGitResult> {
    if (this.disabledShadows.has(shadowDir)) {
      throw new ShadowGitTimeoutError(args[0] ?? 'git', this.gitTimeoutMs);
    }
    const env = shadowGitEnv(shadowDir, opts.workTree ?? null, opts.indexFile);
    const r = await runGit(args, {
      cwd: opts.cwd ?? shadowDir,
      env,
      timeoutMs: this.gitTimeoutMs,
    });
    if (r.timedOut) {
      this.disabledShadows.add(shadowDir);
      this.logger.workspace(
        `plain-folder shadow git ${args[0] ?? ''} timed out after ${this.gitTimeoutMs}ms; disabling checkpoints for ${shadowDir}`,
      );
      throw new ShadowGitTimeoutError(args[0] ?? 'git', this.gitTimeoutMs);
    }
    return {
      code: r.code,
      stdout: Buffer.from(r.stdout, 'utf8'),
      stderr: r.stderr,
      timedOut: r.timedOut,
    };
  }

  private async runShadowGitBuffer(shadowDir: string, args: string[]): Promise<Buffer> {
    if (this.disabledShadows.has(shadowDir)) {
      throw new ShadowGitTimeoutError(args[0] ?? 'git', this.gitTimeoutMs);
    }
    const env = shadowGitEnv(shadowDir, null);
    return new Promise((resolvePromise, rejectPromise) => {
      const child = spawn('git', args, {
        cwd: shadowDir,
        env,
        windowsHide: true,
        timeout: this.gitTimeoutMs,
      });
      const chunks: Buffer[] = [];
      let stderr = '';
      child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf8');
      });
      child.on('error', rejectPromise);
      child.on('close', (code, signal) => {
        if (signal === 'SIGTERM' || signal === 'SIGKILL') {
          this.disabledShadows.add(shadowDir);
          rejectPromise(new ShadowGitTimeoutError(args[0] ?? 'git', this.gitTimeoutMs));
          return;
        }
        if (code !== 0) {
          if (isDiskFullMessage(stderr)) {
            rejectPromise(new ShadowDiskFullError(stderr.trim()));
            return;
          }
          rejectPromise(
            new Error(`shadow git ${args[0] ?? ''} failed (${code}): ${stderr.trim()}`),
          );
          return;
        }
        resolvePromise(Buffer.concat(chunks));
      });
      child.stdin.end();
    });
  }

  private async runShadowGitOk(
    shadowDir: string,
    args: string[],
    opts: { workTree?: string | null; indexFile?: string; cwd?: string } = {},
  ): Promise<string> {
    const r = await this.runShadowGitRaw(shadowDir, args, opts);
    if (r.code === 0) return r.stdout.toString('utf8').trim();
    if (isDiskFullMessage(r.stderr)) throw new ShadowDiskFullError(r.stderr.trim());
    throw new Error(`shadow git ${args[0] ?? ''} failed (${r.code}): ${r.stderr.trim()}`);
  }

  private async ensureShadow(shadowDir: string, cacheTagDirs: readonly string[]): Promise<void> {
    if (this.disabledShadows.has(shadowDir)) {
      throw new ShadowGitTimeoutError('init', this.gitTimeoutMs);
    }
    try {
      mkdirSync(shadowDir, { recursive: true, mode: 0o700 });
      mkdirSync(join(shadowDir, 'indexes'), { recursive: true, mode: 0o700 });
      mkdirSync(join(shadowDir, 'tasks'), { recursive: true, mode: 0o700 });
      mkdirSync(join(shadowDir, 'journals'), { recursive: true, mode: 0o700 });
      writeFileSync(join(shadowDir, 'gitconfig'), SHADOW_GITCONFIG, { mode: 0o600 });
      writeFileSync(join(shadowDir, 'gitconfig_empty'), '', { mode: 0o600 });
      if (!existsSync(join(shadowDir, '.git', 'HEAD'))) {
        await this.runShadowGitOk(shadowDir, ['init', '--initial-branch=main', '--template='], {
          cwd: shadowDir,
        });
      }
      const infoDir = join(shadowDir, '.git', 'info');
      mkdirSync(infoDir, { recursive: true });
      const excludeText =
        cacheTagDirs.length === 0
          ? PLAIN_FOLDER_EXCLUDES
          : `${PLAIN_FOLDER_EXCLUDES}\n# CACHEDIR.TAG\n${cacheTagDirs.join('\n')}\n`;
      writeFileSync(join(infoDir, 'exclude'), excludeText);
    } catch (err) {
      if (isDiskFullError(err))
        throw new ShadowDiskFullError(err instanceof Error ? err.message : String(err));
      throw err;
    }
  }

  private async commitExists(shadowDir: string, commit: string): Promise<boolean> {
    if (!FULL_SHA.test(commit)) return false;
    const r = await this.runShadowGitRaw(shadowDir, ['cat-file', '-e', `${commit}^{commit}`]);
    return r.code === 0;
  }

  private async treeOf(shadowDir: string, commit: string): Promise<string> {
    return this.runShadowGitOk(shadowDir, ['rev-parse', '--verify', `${commit}^{tree}`]);
  }

  private async commitTreeToRef(
    shadowDir: string,
    tree: string,
    parentSha: string | null,
    refName: string,
    label: string,
  ): Promise<string> {
    const commitArgs =
      parentSha !== null && (await this.commitExists(shadowDir, parentSha))
        ? ['commit-tree', tree, '-p', parentSha, '-m', label]
        : ['commit-tree', tree, '-m', label];
    const commit = await this.runShadowGitOk(shadowDir, commitArgs);
    await this.runShadowGitOk(shadowDir, ['update-ref', refName, commit]);
    await this.maybeCollectGc(shadowDir);
    return commit;
  }

  private async snapshotWorkTree(
    shadowDir: string,
    workTree: string,
    refName: string,
    parentSha: string | null,
    label: string,
  ): Promise<{ commit: string; tree: string; changed: boolean }> {
    const indexFile = join(shadowDir, 'indexes', `${randomUUID()}.index`);
    try {
      await this.runShadowGitOk(shadowDir, ['read-tree', '--empty'], { indexFile });
      await this.runShadowGitOk(shadowDir, ['add', '-A', '--', '.'], {
        workTree,
        indexFile,
        cwd: workTree,
      });
      const tree = await this.runShadowGitOk(shadowDir, ['write-tree'], { indexFile });
      if (parentSha !== null && (await this.commitExists(shadowDir, parentSha))) {
        const parentTree = await this.treeOf(shadowDir, parentSha);
        if (parentTree === tree) {
          return { commit: parentSha, tree, changed: false };
        }
      }
      const commit = await this.commitTreeToRef(shadowDir, tree, parentSha, refName, label);
      return { commit, tree, changed: true };
    } finally {
      rmSync(indexFile, { force: true });
    }
  }

  private async maybeCollectGc(shadowDir: string): Promise<void> {
    const count = (this.commitsSinceGc.get(shadowDir) ?? 0) + 1;
    if (count < GC_EVERY_COMMITS) {
      this.commitsSinceGc.set(shadowDir, count);
      return;
    }
    this.commitsSinceGc.set(shadowDir, 0);
    try {
      await this.runShadowGitRaw(shadowDir, ['gc', '--auto', '--quiet']);
    } catch {}
  }

  private async cloneCow(realFolder: string, convDir: string): Promise<void> {
    if (existsSync(convDir)) rmSync(convDir, { recursive: true, force: true });
    mkdirSync(convDir, { recursive: true });
    try {
      if (this.copyImpl !== undefined) {
        try {
          await this.copyImpl(realFolder, convDir);
          return;
        } catch (err) {
          if (isDiskFullError(err)) throw err;
          const total = measureTotalBytes(realFolder, this.hugeFolderBytes);
          if (total > this.hugeFolderBytes) {
            throw new ShadowCowFallbackTooLargeError(total);
          }
          throw err;
        }
      }
      if (readdirSync(realFolder).length === 0) return;
      if (process.platform === 'darwin') {
        try {
          await execFileAsync('cp', ['-c', '-R', `${realFolder}/.`, convDir], {
            windowsHide: true,
          });
          return;
        } catch (err) {
          if (isDiskFullError(err)) throw err;
          const total = measureTotalBytes(realFolder, this.hugeFolderBytes);
          if (total > this.hugeFolderBytes) {
            throw new ShadowCowFallbackTooLargeError(total);
          }
          rmSync(convDir, { recursive: true, force: true });
          mkdirSync(convDir, { recursive: true });
          await execFileAsync('cp', ['-R', `${realFolder}/.`, convDir], {
            windowsHide: true,
          });
          return;
        }
      }
      try {
        await execFileAsync('cp', ['--reflink=always', '-a', `${realFolder}/.`, convDir], {
          windowsHide: true,
        });
      } catch (err) {
        if (isDiskFullError(err)) throw err;
        const total = measureTotalBytes(realFolder, this.hugeFolderBytes);
        if (total > this.hugeFolderBytes) {
          throw new ShadowCowFallbackTooLargeError(total);
        }
        rmSync(convDir, { recursive: true, force: true });
        mkdirSync(convDir, { recursive: true });
        await execFileAsync('cp', ['-a', `${realFolder}/.`, convDir], {
          windowsHide: true,
        });
      }
    } catch (err) {
      rmSync(convDir, { recursive: true, force: true });
      if (isDiskFullError(err)) {
        throw new ShadowDiskFullError(err instanceof Error ? err.message : String(err));
      }
      throw err;
    }
  }

  private taskMetaPath(shadowDir: string, convId: string): string {
    return join(shadowDir, 'tasks', `${convId}.json`);
  }

  private readTaskRecord(shadowDir: string, convId: string): TaskShadowRecord | null {
    const file = this.taskMetaPath(shadowDir, convId);
    if (!existsSync(file)) return null;
    try {
      return JSON.parse(readFileSync(file, 'utf8')) as TaskShadowRecord;
    } catch {
      return null;
    }
  }

  private writeTaskRecord(record: TaskShadowRecord): void {
    const file = this.taskMetaPath(record.shadowDir, record.convId);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
    this.workDirToTaskMeta.set(record.workDir, file);
  }

  private taskRecordForWorkDir(workDir: string): TaskShadowRecord | null {
    const directMarker = join(workDir, '.cairn-plain-folder.json');
    if (existsSync(directMarker)) {
      try {
        const marker = JSON.parse(readFileSync(directMarker, 'utf8')) as {
          shadowDir: string;
          convId: string;
        };
        const rec = this.readTaskRecord(marker.shadowDir, marker.convId);
        if (rec !== null) {
          this.workDirToTaskMeta.set(workDir, this.taskMetaPath(marker.shadowDir, marker.convId));
          return rec;
        }
      } catch {}
    }
    const metaPath = this.workDirToTaskMeta.get(workDir);
    if (metaPath !== undefined && existsSync(metaPath)) {
      try {
        return JSON.parse(readFileSync(metaPath, 'utf8')) as TaskShadowRecord;
      } catch {
        return null;
      }
    }
    return null;
  }

  isPlainFolderWorkspace(workDir: string): boolean {
    return this.taskRecordForWorkDir(workDir) !== null;
  }

  private journalPath(shadowDir: string, buildId: string): string {
    return join(shadowDir, 'journals', `${buildId}.json`);
  }

  private writeJournal(shadowDir: string, journal: ShadowWriteJournal): void {
    const file = this.journalPath(shadowDir, journal.buildId);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(journal, null, 2)}\n`);
  }

  private readJournal(shadowDir: string, buildId: string): ShadowWriteJournal | null {
    const file = this.journalPath(shadowDir, buildId);
    if (!existsSync(file)) return null;
    try {
      return JSON.parse(readFileSync(file, 'utf8')) as ShadowWriteJournal;
    } catch {
      return null;
    }
  }

  private async verifyFolderIdentity(
    record: Pick<TaskShadowRecord, 'realFolder' | 'canonicalFolder' | 'folderDev' | 'folderIno'>,
  ): Promise<'ok' | 'missing-folder' | 'folder-replaced'> {
    if (!existsSync(record.realFolder)) return 'missing-folder';
    let st: ReturnType<typeof statSync>;
    try {
      st = statSync(record.realFolder);
    } catch {
      return 'missing-folder';
    }
    if (!st.isDirectory()) return 'folder-replaced';
    if (canonicalFolderPath(record.realFolder) !== record.canonicalFolder) return 'folder-replaced';
    if (st.dev !== record.folderDev || st.ino !== record.folderIno) return 'folder-replaced';
    if (await gitPrim.isGitDir(record.realFolder)) return 'folder-replaced';
    return 'ok';
  }

  private async mergeVirtualThreeWay(
    shadowDir: string,
    mergeBaseCommit: string,
    oursTreeOrCommit: string,
    theirsTreeOrCommit: string,
  ): Promise<{ ok: true; tree: string } | { ok: false; conflictFiles: string[] }> {
    const oursTree = await this.treeOf(shadowDir, oursTreeOrCommit);
    const theirsTree = await this.treeOf(shadowDir, theirsTreeOrCommit);
    const oursCommit = await this.runShadowGitOk(shadowDir, [
      'commit-tree',
      oursTree,
      '-p',
      mergeBaseCommit,
      '-m',
      'virtual ours',
    ]);
    const theirsCommit = await this.runShadowGitOk(shadowDir, [
      'commit-tree',
      theirsTree,
      '-p',
      mergeBaseCommit,
      '-m',
      'virtual theirs',
    ]);
    const res = await this.runShadowGitRaw(shadowDir, [
      'merge-tree',
      '--write-tree',
      '--name-only',
      '-z',
      oursCommit,
      theirsCommit,
    ]);
    if (res.code === 0) {
      const parsed = parseMergeTreeZ(res.stdout);
      if (!FULL_SHA.test(parsed.tree)) {
        throw new Error(`unexpected merge-tree output: ${res.stdout.toString('utf8')}`);
      }
      return { ok: true, tree: parsed.tree };
    }
    if (res.code === 1) {
      const parsed = parseMergeTreeZ(res.stdout);
      return { ok: false, conflictFiles: parsed.conflictFiles };
    }
    if (res.code === 129) {
      throw new ShadowGitUnsupportedError(
        res.stderr.trim() || 'merge-tree --write-tree unsupported',
      );
    }
    if (isDiskFullMessage(res.stderr)) throw new ShadowDiskFullError(res.stderr.trim());
    throw new Error(`shadow git merge-tree failed (${res.code}): ${res.stderr.trim()}`);
  }

  private async applyTreeDeltaToFolder(
    shadowDir: string,
    realFolder: string,
    fromCommit: string,
    toTree: string,
  ): Promise<void> {
    const diffOut = await this.runShadowGitRaw(shadowDir, [
      'diff-tree',
      '-r',
      '-z',
      '--no-renames',
      fromCommit,
      toTree,
    ]);
    if (diffOut.code !== 0) {
      throw new Error(`shadow git diff-tree failed (${diffOut.code}): ${diffOut.stderr.trim()}`);
    }
    const parts = diffOut.stdout.toString('utf8').split('\0');
    interface DeltaItem {
      status: string;
      oldMode: string;
      newMode: string;
      oldSha: string;
      newSha: string;
      path: string;
    }
    const items: DeltaItem[] = [];
    for (let i = 0; i + 1 < parts.length && parts[i] !== ''; i += 2) {
      const meta = (parts[i] ?? '').replace(/^:/, '').split(' ');
      const relPath = parts[i + 1] ?? '';
      if (meta.length < 5 || relPath === '') continue;
      if (!isSafeRepoPath(relPath)) throw new Error(`unsafe delta path: ${relPath}`);
      if (isPlainFolderExcluded(relPath, false)) continue;
      items.push({
        oldMode: meta[0] ?? '000000',
        newMode: meta[1] ?? '000000',
        oldSha: meta[2] ?? '0'.repeat(40),
        newSha: meta[3] ?? '0'.repeat(40),
        status: meta[4] ?? '',
        path: relPath,
      });
    }
    if (items.length === 0) return;

    const canonicalRoot = canonicalFolderPath(realFolder);
    const ordered = [
      ...items.filter((x) => x.status === 'D'),
      ...items.filter((x) => x.status !== 'D'),
    ];
    const diskEntryMatchesSha = (
      targetPath: string,
      expectedSha: string,
      expectedMode: string,
    ): boolean => {
      if (!existsSync(targetPath)) return false;
      try {
        const st = lstatSync(targetPath);
        if (expectedMode === '120000') {
          if (!st.isSymbolicLink()) return false;
          return gitBlobSha1(Buffer.from(readlinkSync(targetPath), 'utf8')) === expectedSha;
        }
        if (!st.isFile()) return false;
        return gitBlobSha1(readFileSync(targetPath)) === expectedSha;
      } catch {
        return false;
      }
    };
    const applied: Array<{ item: DeltaItem; prevMode?: number }> = [];
    const resolveTargetMode = (item: DeltaItem, prevMode: number | undefined): number => {
      const newExec = (Number.parseInt(item.newMode, 8) & 0o111) !== 0;
      if (prevMode === undefined) return newExec ? 0o755 : 0o644;
      const oldExec = (Number.parseInt(item.oldMode, 8) & 0o111) !== 0;
      if (oldExec === newExec) return prevMode;
      if (newExec) return prevMode | ((prevMode & 0o444) >> 2);
      return prevMode & ~0o111;
    };
    const writeFile =
      this.writeFileImpl ??
      ((target: string, content: Buffer, mode: number) => {
        const tmp = `${target}.cairn-tmp-${randomUUID()}`;
        try {
          writeFileSync(tmp, content, { mode });
          chmodSync(tmp, mode);
          renameSync(tmp, target);
        } catch (err) {
          rmSync(tmp, { force: true });
          throw err;
        }
      });

    try {
      for (const item of ordered) {
        const content =
          item.status === 'D'
            ? null
            : await this.runShadowGitBuffer(shadowDir, ['cat-file', 'blob', item.newSha]);
        const target = assertInsideRealRoot(canonicalRoot, item.path);
        let prevMode: number | undefined;
        if (item.status === 'A') {
          if (existsSync(target) && !diskEntryMatchesSha(target, item.newSha, item.newMode)) {
            throw new ShadowConcurrentEditError([item.path]);
          }
        } else {
          if (!diskEntryMatchesSha(target, item.oldSha, item.oldMode)) {
            throw new ShadowConcurrentEditError([item.path]);
          }
          try {
            const st = lstatSync(target);
            if (st.isFile()) prevMode = st.mode & 0o777;
          } catch {}
        }
        if (item.status === 'D') {
          rmSync(target, { force: true });
          pruneEmptyParents(dirname(target), canonicalRoot);
          applied.push({ item, ...(prevMode !== undefined ? { prevMode } : {}) });
          continue;
        }
        mkdirSync(dirname(target), { recursive: true });
        const body = content ?? Buffer.alloc(0);
        if (item.newMode === '120000') {
          const linkTmp = `${target}.cairn-link-${randomUUID()}`;
          try {
            symlinkSync(body.toString('utf8'), linkTmp);
            renameSync(linkTmp, target);
          } catch (err) {
            rmSync(linkTmp, { force: true });
            throw err;
          }
        } else {
          const mode = resolveTargetMode(item, prevMode);
          writeFile(target, body, mode);
        }
        applied.push({ item, ...(prevMode !== undefined ? { prevMode } : {}) });
      }
    } catch (applyErr) {
      let rollbackFailed: string | null = null;
      for (const entry of [...applied].reverse()) {
        const prev = entry.item;
        try {
          const target = assertInsideRealRoot(canonicalRoot, prev.path);
          if (prev.status === 'A') {
            rmSync(target, { force: true });
            pruneEmptyParents(dirname(target), canonicalRoot);
          } else {
            mkdirSync(dirname(target), { recursive: true });
            const oldBuf = await this.runShadowGitBuffer(shadowDir, [
              'cat-file',
              'blob',
              prev.oldSha,
            ]);
            if (prev.oldMode === '120000') {
              const linkTmp = `${target}.cairn-link-${randomUUID()}`;
              try {
                symlinkSync(oldBuf.toString('utf8'), linkTmp);
                renameSync(linkTmp, target);
              } catch (linkErr) {
                rmSync(linkTmp, { force: true });
                throw linkErr;
              }
            } else {
              const mode =
                entry.prevMode ??
                ((Number.parseInt(prev.oldMode, 8) & 0o111) !== 0 ? 0o755 : 0o644);
              const tmp = `${target}.cairn-rb-${randomUUID()}`;
              try {
                writeFileSync(tmp, oldBuf, { mode });
                chmodSync(tmp, mode);
                renameSync(tmp, target);
              } catch (rbWriteErr) {
                rmSync(tmp, { force: true });
                throw rbWriteErr;
              }
            }
          }
        } catch (rbErr) {
          rollbackFailed = rbErr instanceof Error ? rbErr.message : String(rbErr);
          break;
        }
      }
      if (rollbackFailed !== null) {
        throw new ShadowPartialApplyError(
          `${applyErr instanceof Error ? applyErr.message : String(applyErr)}; rollback failed: ${rollbackFailed}`,
        );
      }
      if (applyErr instanceof ShadowConcurrentEditError) {
        throw applyErr;
      }
      if (isDiskFullError(applyErr)) {
        throw new ShadowDiskFullError(
          applyErr instanceof Error ? applyErr.message : String(applyErr),
        );
      }
      throw applyErr;
    }
  }

  private async reconcilePendingJournalUnlocked(
    fresh: TaskShadowRecord,
  ): Promise<'clean' | 'applied' | 'partial-unknown'> {
    const journal = this.readJournal(fresh.shadowDir, fresh.convId);
    if (journal === null) {
      return fresh.status === 'partial-unknown' ? 'partial-unknown' : 'clean';
    }
    if (journal.state === 'applied') {
      let changed = false;
      if (journal.action === 'merge') {
        const legStepId = journal.stepId ?? fresh.convId;
        if (!fresh.deliveries.some((d) => d.stepId === legStepId)) {
          const postCommit =
            journal.postCommit ??
            (await this.commitTreeToRef(
              fresh.shadowDir,
              journal.targetTree,
              (await this.commitExists(fresh.shadowDir, journal.preCommit))
                ? journal.preCommit
                : null,
              `refs/cairn/tasks/${fresh.convId}/deliveries/${legStepId}/post`,
              `recover ${fresh.convId} ${legStepId}`,
            ));
          fresh.deliveries.push({
            stepId: legStepId,
            preCommit: journal.preCommit,
            postCommit,
          });
          fresh.legBaseCommit = fresh.headCommit;
          fresh.status = 'merged';
          fresh.conflictFiles = [];
          delete fresh.reason;
          changed = true;
        }
      } else if (fresh.status !== 'undone') {
        fresh.status = 'undone';
        fresh.conflictFiles = [];
        delete fresh.reason;
        if (journal.stepId && fresh.lastActionReceipts[journal.stepId] === undefined) {
          fresh.lastActionReceipts[journal.stepId] = {
            outcome: 'undone',
            ...(journal.postCommit !== undefined ? { commit: journal.postCommit } : {}),
          };
        }
        changed = true;
      }
      if (changed) this.writeTaskRecord(fresh);
      return 'clean';
    }
    if (journal.state === 'partial-unknown') {
      fresh.status = 'partial-unknown';
      fresh.reason = '上次本地文件夹写回或撤销中断，目录状态未知，请先手动核对后再操作';
      this.writeTaskRecord(fresh);
      return 'partial-unknown';
    }
    try {
      const current = await this.snapshotWorkTree(
        fresh.shadowDir,
        fresh.canonicalFolder,
        `refs/cairn/tasks/${fresh.convId}/recover`,
        null,
        `recover ${fresh.convId}`,
      );
      if (current.tree === journal.targetTree) {
        const legStepId = journal.stepId ?? fresh.convId;
        const postRef =
          journal.action === 'merge'
            ? `refs/cairn/tasks/${fresh.convId}/deliveries/${legStepId}/post`
            : `refs/cairn/tasks/${fresh.convId}/post-undo`;
        const postCommit = await this.commitTreeToRef(
          fresh.shadowDir,
          journal.targetTree,
          (await this.commitExists(fresh.shadowDir, journal.preCommit)) ? journal.preCommit : null,
          postRef,
          `recover ${fresh.convId}`,
        );
        if (journal.action === 'merge') {
          if (!fresh.deliveries.some((d) => d.stepId === legStepId)) {
            fresh.deliveries.push({
              stepId: legStepId,
              preCommit: journal.preCommit,
              postCommit,
            });
          }
          fresh.legBaseCommit = fresh.headCommit;
          fresh.status = 'merged';
          fresh.conflictFiles = [];
        } else {
          fresh.status = 'undone';
          fresh.conflictFiles = [];
          if (journal.stepId && fresh.lastActionReceipts[journal.stepId] === undefined) {
            fresh.lastActionReceipts[journal.stepId] = {
              outcome: 'undone',
              commit: postCommit,
            };
          }
        }
        delete fresh.reason;
        this.writeTaskRecord(fresh);
        this.writeJournal(fresh.shadowDir, {
          ...journal,
          state: 'applied',
          postCommit,
          updatedAt: Date.now(),
        });
        return 'applied';
      }
      if (await this.commitExists(fresh.shadowDir, journal.preCommit)) {
        const preTree = await this.treeOf(fresh.shadowDir, journal.preCommit);
        if (current.tree === preTree) {
          rmSync(this.journalPath(fresh.shadowDir, fresh.convId), { force: true });
          return 'clean';
        }
      }
    } catch {}
    this.writeJournal(fresh.shadowDir, {
      ...journal,
      state: 'partial-unknown',
      updatedAt: Date.now(),
    });
    fresh.status = 'partial-unknown';
    fresh.reason = '上次写回在完成前中断，请手动检查本地目录改动';
    this.writeTaskRecord(fresh);
    return 'partial-unknown';
  }

  private async reconcileAllShadowJournalsUnlocked(
    shadowDir: string,
  ): Promise<'clean' | 'partial-unknown'> {
    const jDir = join(shadowDir, 'journals');
    if (existsSync(jDir)) {
      for (const file of readdirSync(jDir)) {
        if (!file.endsWith('.json')) continue;
        const convId = file.slice(0, -'.json'.length);
        const journal = this.readJournal(shadowDir, convId);
        if (journal === null) continue;
        const rec = this.readTaskRecord(shadowDir, journal.buildId);
        if (rec === null) {
          if (journal.state === 'applied') continue;
          return 'partial-unknown';
        }
        const verdict = await this.reconcilePendingJournalUnlocked(rec);
        if (verdict === 'partial-unknown') return 'partial-unknown';
      }
    }
    const tDir = join(shadowDir, 'tasks');
    if (existsSync(tDir)) {
      for (const file of readdirSync(tDir)) {
        if (!file.endsWith('.json')) continue;
        const rec = this.readTaskRecord(shadowDir, file.slice(0, -'.json'.length));
        if (rec?.status === 'partial-unknown') return 'partial-unknown';
      }
    }
    return 'clean';
  }

  async prepareIsolated(input: {
    workspacesRoot: string;
    projectId: string;
    convId: string;
    realFolder: string;
    convDir: string;
  }): Promise<{
    shadowDir: string;
    baseCommit: string | null;
    reused: boolean;
    checkpointsDisabled: boolean;
  }> {
    const canonical = canonicalFolderPath(input.realFolder);
    const st = statSync(input.realFolder);
    const shadowDir = this.shadowDirFor(input.workspacesRoot, input.realFolder);
    const scan = this.measureFolder(input.realFolder);
    return this.withFolderWriteLock(canonical, async () => {
      if (existsSync(shadowDir)) {
        const shadowVerdict = await this.reconcileAllShadowJournalsUnlocked(shadowDir);
        if (shadowVerdict === 'partial-unknown') {
          throw new Error('上次写回在完成前中断，请手动检查本地目录改动');
        }
      }
      const existing = this.readTaskRecord(shadowDir, input.convId);
      if (
        existing !== null &&
        existing.mode === 'isolated' &&
        existing.canonicalFolder === canonical &&
        existsSync(input.convDir)
      ) {
        this.workDirToTaskMeta.set(input.convDir, this.taskMetaPath(shadowDir, input.convId));
        return {
          shadowDir,
          baseCommit: existing.initialBaseCommit,
          reused: true,
          checkpointsDisabled:
            existing.checkpointsDisabled === true || this.disabledShadows.has(shadowDir),
        };
      }
      await this.cloneCow(canonical, input.convDir);
      let baseCommit: string | null = null;
      let checkpointsDisabled = this.disabledShadows.has(shadowDir);
      if (!checkpointsDisabled) {
        try {
          await this.ensureShadow(shadowDir, scan.cacheTagDirs);
          const snap = await this.snapshotWorkTree(
            shadowDir,
            input.convDir,
            `refs/cairn/tasks/${input.convId}/base`,
            null,
            `base ${input.convId}`,
          );
          baseCommit = snap.commit;
        } catch (err) {
          if (err instanceof ShadowGitTimeoutError) {
            checkpointsDisabled = true;
          } else {
            throw err;
          }
        }
      }
      writeFileSync(
        join(input.convDir, '.cairn-plain-folder.json'),
        `${JSON.stringify({ shadowDir, convId: input.convId })}\n`,
      );
      this.writeTaskRecord({
        convId: input.convId,
        projectId: input.projectId,
        mode: 'isolated',
        realFolder: input.realFolder,
        canonicalFolder: canonical,
        folderDev: st.dev,
        folderIno: st.ino,
        workDir: input.convDir,
        shadowDir,
        initialBaseCommit: baseCommit,
        legBaseCommit: baseCommit,
        headCommit: baseCommit,
        deliveries: [],
        status: checkpointsDisabled ? 'disabled' : 'running',
        conflictFiles: [],
        checkpointsDisabled,
        lastActionReceipts: {},
      });
      return { shadowDir, baseCommit, reused: false, checkpointsDisabled };
    });
  }

  async prepareInPlace(input: {
    workspacesRoot: string;
    projectId: string;
    convId: string;
    realFolder: string;
    cacheTagDirs: readonly string[];
    signal?: AbortSignal;
  }): Promise<{
    shadowDir: string;
    baseCommit: string | null;
    checkpointsDisabled: boolean;
    release: () => void;
  }> {
    const canonical = canonicalFolderPath(input.realFolder);
    const release = await this.acquireInPlaceLease(canonical, input.signal);
    try {
      const st = statSync(input.realFolder);
      const shadowDir = this.shadowDirFor(input.workspacesRoot, input.realFolder);
      return await this.withFolderWriteLock(
        canonical,
        async () => {
          if (existsSync(shadowDir)) {
            const shadowVerdict = await this.reconcileAllShadowJournalsUnlocked(shadowDir);
            if (shadowVerdict === 'partial-unknown') {
              throw new Error('上次写回在完成前中断，请手动检查本地目录改动');
            }
          }
          const existing = this.readTaskRecord(shadowDir, input.convId);
          let baseCommit: string | null = null;
          let checkpointsDisabled = this.disabledShadows.has(shadowDir);
          if (!checkpointsDisabled) {
            try {
              await this.ensureShadow(shadowDir, input.cacheTagDirs);
              const snap = await this.snapshotWorkTree(
                shadowDir,
                canonical,
                `refs/cairn/tasks/${input.convId}/base`,
                null,
                `in-place base ${input.convId}`,
              );
              baseCommit = snap.commit;
            } catch (err) {
              if (err instanceof ShadowGitTimeoutError) {
                checkpointsDisabled = true;
              } else {
                throw err;
              }
            }
          }
          this.writeTaskRecord({
            convId: input.convId,
            projectId: input.projectId,
            mode: 'in-place',
            realFolder: input.realFolder,
            canonicalFolder: canonical,
            folderDev: st.dev,
            folderIno: st.ino,
            workDir: input.realFolder,
            shadowDir,
            initialBaseCommit: existing?.initialBaseCommit ?? baseCommit,
            legBaseCommit: baseCommit,
            headCommit: baseCommit,
            deliveries: existing?.deliveries ?? [],
            status: checkpointsDisabled ? 'disabled' : 'running',
            conflictFiles: [],
            checkpointsDisabled,
            lastActionReceipts: existing?.lastActionReceipts ?? {},
          });
          return { shadowDir, baseCommit, checkpointsDisabled, release };
        },
        { allowWhileInPlace: true },
      );
    } catch (err) {
      release();
      throw err;
    }
  }

  async snapshotTask(
    workDir: string,
    label: string,
  ): Promise<{ committed: boolean; head: string | null }> {
    const record = this.taskRecordForWorkDir(workDir);
    if (record === null) return { committed: false, head: null };
    if (record.checkpointsDisabled === true || this.disabledShadows.has(record.shadowDir)) {
      return { committed: false, head: null };
    }
    return this.withFolderWriteLock(
      record.canonicalFolder,
      async () => {
        const fresh = this.readTaskRecord(record.shadowDir, record.convId) ?? record;
        if (fresh.legBaseCommit === null) return { committed: false, head: null };
        try {
          const snap = await this.snapshotWorkTree(
            fresh.shadowDir,
            fresh.workDir,
            `refs/cairn/tasks/${fresh.convId}/head`,
            fresh.headCommit ?? fresh.legBaseCommit,
            label,
          );
          fresh.headCommit = snap.commit;
          this.writeTaskRecord(fresh);
          return { committed: snap.changed, head: snap.commit };
        } catch (err) {
          if (err instanceof ShadowGitTimeoutError) {
            fresh.checkpointsDisabled = true;
            fresh.status = 'disabled';
            this.writeTaskRecord(fresh);
            return { committed: false, head: null };
          }
          throw err;
        }
      },
      { allowWhileInPlace: record.mode === 'in-place' },
    );
  }

  async currentHead(workDir: string): Promise<string | null> {
    const record = this.taskRecordForWorkDir(workDir);
    return record?.headCommit ?? null;
  }

  async countAhead(workDir: string): Promise<number> {
    const record = this.taskRecordForWorkDir(workDir);
    if (
      record === null ||
      record.initialBaseCommit === null ||
      record.headCommit === null ||
      this.disabledShadows.has(record.shadowDir)
    ) {
      return 0;
    }
    const baseSha = record.initialBaseCommit;
    const headSha = record.headCommit;
    return this.withFolderWriteLock(
      record.canonicalFolder,
      async () => {
        if (!(await this.commitExists(record.shadowDir, baseSha))) return 0;
        if (!(await this.commitExists(record.shadowDir, headSha))) return 0;
        const baseTree = await this.treeOf(record.shadowDir, baseSha);
        const headTree = await this.treeOf(record.shadowDir, headSha);
        return baseTree === headTree ? 0 : 1;
      },
      { allowWhileInPlace: record.mode === 'in-place' },
    );
  }

  async diffTask(workDir: string): Promise<string> {
    const record = this.taskRecordForWorkDir(workDir);
    if (
      record === null ||
      record.initialBaseCommit === null ||
      record.headCommit === null ||
      this.disabledShadows.has(record.shadowDir)
    ) {
      return '';
    }
    const baseSha = record.initialBaseCommit;
    const headSha = record.headCommit;
    return this.withFolderWriteLock(
      record.canonicalFolder,
      async () => {
        if (
          !(await this.commitExists(record.shadowDir, baseSha)) ||
          !(await this.commitExists(record.shadowDir, headSha))
        ) {
          return '';
        }
        const res = await this.runShadowGitRaw(record.shadowDir, [
          '--literal-pathspecs',
          'diff',
          '--no-ext-diff',
          '--no-textconv',
          '--unified=3',
          baseSha,
          headSha,
          '--',
        ]);
        return res.code === 0 ? res.stdout.toString('utf8') : '';
      },
      { allowWhileInPlace: record.mode === 'in-place' },
    );
  }

  async restoreTask(workDir: string, commit: string): Promise<void> {
    const record = this.taskRecordForWorkDir(workDir);
    if (record === null || this.disabledShadows.has(record.shadowDir)) return;
    await this.withFolderWriteLock(
      record.canonicalFolder,
      async () => {
        const fresh = this.readTaskRecord(record.shadowDir, record.convId) ?? record;
        if (
          (await this.reconcileAllShadowJournalsUnlocked(fresh.shadowDir)) === 'partial-unknown'
        ) {
          throw new Error('上次写回在完成前中断，请手动检查本地目录改动');
        }
        if (!(await this.commitExists(fresh.shadowDir, commit))) return;
        const current = await this.snapshotWorkTree(
          fresh.shadowDir,
          fresh.workDir,
          `refs/cairn/tasks/${fresh.convId}/rewind-tmp`,
          fresh.headCommit,
          `pre-rewind ${fresh.convId}`,
        );
        const targetTree = await this.treeOf(fresh.shadowDir, commit);
        if (current.tree !== targetTree) {
          await this.applyTreeDeltaToFolder(
            fresh.shadowDir,
            fresh.workDir,
            current.commit,
            targetTree,
          );
        }
        fresh.headCommit = commit;
        this.writeTaskRecord(fresh);
      },
      { allowWhileInPlace: record.mode === 'in-place' },
    );
  }

  async mergeTaskBack(workDir: string, stepId: string): Promise<PlainFolderStepMeta> {
    const record = this.taskRecordForWorkDir(workDir);
    if (record === null) {
      return { mode: 'isolated', status: 'no-changes', undoable: false };
    }
    if (record.checkpointsDisabled === true || this.disabledShadows.has(record.shadowDir)) {
      return {
        mode: record.mode,
        status: 'disabled',
        undoable: false,
        reason: '快照超时，本目录本轮已停用保护快照',
      };
    }
    return this.withFolderWriteLock(
      record.canonicalFolder,
      async () => {
        const fresh = this.readTaskRecord(record.shadowDir, record.convId) ?? record;
        return this.mergeTaskBackUnlocked(fresh, stepId);
      },
      { allowWhileInPlace: record.mode === 'in-place' },
    );
  }

  private async mergeTaskBackUnlocked(
    fresh: TaskShadowRecord,
    stepId: string,
  ): Promise<PlainFolderStepMeta> {
    const recStatus = await this.reconcileAllShadowJournalsUnlocked(fresh.shadowDir);
    if (recStatus === 'partial-unknown') {
      const updated = this.readTaskRecord(fresh.shadowDir, fresh.convId) ?? fresh;
      updated.status = 'partial-unknown';
      updated.reason ??= '上次本地文件夹写回或撤销中断，目录状态未知，请先手动核对后再操作';
      this.writeTaskRecord(updated);
      return {
        mode: updated.mode,
        status: 'partial-unknown',
        undoable: false,
        reason: updated.reason,
      };
    }
    if (fresh.checkpointsDisabled === true || this.disabledShadows.has(fresh.shadowDir)) {
      return {
        mode: fresh.mode,
        status: 'disabled',
        undoable: false,
        reason: '快照超时，本目录本轮已停用保护快照',
      };
    }
    if (fresh.mode === 'in-place') {
      if (fresh.legBaseCommit === null || fresh.headCommit === null) {
        fresh.status = 'no-changes';
        this.writeTaskRecord(fresh);
        return { mode: 'in-place', status: 'no-changes', undoable: fresh.deliveries.length > 0 };
      }
      const baseTree = await this.treeOf(fresh.shadowDir, fresh.legBaseCommit);
      const headTree = await this.treeOf(fresh.shadowDir, fresh.headCommit);
      if (baseTree === headTree) {
        fresh.status = fresh.deliveries.length > 0 ? 'merged' : 'no-changes';
        this.writeTaskRecord(fresh);
        return {
          mode: 'in-place',
          status: fresh.status,
          undoable: fresh.deliveries.length > 0,
        };
      }
      await this.runShadowGitOk(fresh.shadowDir, [
        'update-ref',
        `refs/cairn/tasks/${fresh.convId}/deliveries/${stepId}/pre`,
        fresh.legBaseCommit,
      ]);
      fresh.deliveries.push({
        stepId,
        preCommit: fresh.legBaseCommit,
        postCommit: fresh.headCommit,
      });
      await this.runShadowGitOk(fresh.shadowDir, [
        'update-ref',
        `refs/cairn/tasks/${fresh.convId}/deliveries/${stepId}/post`,
        fresh.headCommit,
      ]);
      fresh.legBaseCommit = fresh.headCommit;
      fresh.status = 'merged';
      fresh.conflictFiles = [];
      this.writeTaskRecord(fresh);
      return { mode: 'in-place', status: 'merged', undoable: true };
    }

    if (fresh.legBaseCommit === null || fresh.headCommit === null) {
      fresh.status = 'no-changes';
      this.writeTaskRecord(fresh);
      return { mode: 'isolated', status: 'no-changes', undoable: fresh.deliveries.length > 0 };
    }
    const baseTree = await this.treeOf(fresh.shadowDir, fresh.legBaseCommit);
    const headTree = await this.treeOf(fresh.shadowDir, fresh.headCommit);
    if (baseTree === headTree) {
      fresh.status = fresh.deliveries.length > 0 ? 'merged' : 'no-changes';
      this.writeTaskRecord(fresh);
      return {
        mode: 'isolated',
        status: fresh.status,
        undoable: fresh.deliveries.length > 0,
      };
    }
    const idVerdict = await this.verifyFolderIdentity(fresh);
    if (idVerdict !== 'ok') {
      fresh.status = idVerdict;
      fresh.reason =
        idVerdict === 'missing-folder'
          ? '目标本地文件夹已不存在或被移动'
          : '目标本地文件夹已被替换或初始化为 Git 仓库，拒绝写入';
      this.writeTaskRecord(fresh);
      return {
        mode: 'isolated',
        status: idVerdict,
        undoable: fresh.deliveries.length > 0,
        reason: fresh.reason,
      };
    }
    try {
      const ours = await this.snapshotWorkTree(
        fresh.shadowDir,
        fresh.canonicalFolder,
        `refs/cairn/tasks/${fresh.convId}/deliveries/${stepId}/pre`,
        null,
        `pre-merge ${fresh.convId} ${stepId}`,
      );
      const merged = await this.mergeVirtualThreeWay(
        fresh.shadowDir,
        fresh.legBaseCommit,
        ours.commit,
        fresh.headCommit,
      );
      if (!merged.ok) {
        fresh.status = 'conflict';
        fresh.conflictFiles = merged.conflictFiles;
        fresh.reason = `合并冲突：${merged.conflictFiles.join(', ')}`;
        this.writeTaskRecord(fresh);
        return {
          mode: 'isolated',
          status: 'conflict',
          undoable: fresh.deliveries.length > 0,
          conflictFiles: merged.conflictFiles,
          reason: fresh.reason,
        };
      }
      if (merged.tree === ours.tree) {
        fresh.legBaseCommit = fresh.headCommit;
        fresh.status = 'merged';
        fresh.conflictFiles = [];
        this.writeTaskRecord(fresh);
        return {
          mode: 'isolated',
          status: 'merged',
          undoable: fresh.deliveries.length > 0,
        };
      }
      const recheck = await this.verifyFolderIdentity(fresh);
      if (recheck !== 'ok') {
        fresh.status = recheck;
        this.writeTaskRecord(fresh);
        return {
          mode: 'isolated',
          status: recheck,
          undoable: fresh.deliveries.length > 0,
        };
      }
      this.writeJournal(fresh.shadowDir, {
        buildId: fresh.convId,
        stepId,
        action: 'merge',
        state: 'applying',
        preCommit: ours.commit,
        targetTree: merged.tree,
        updatedAt: Date.now(),
      });
      await this.applyTreeDeltaToFolder(
        fresh.shadowDir,
        fresh.canonicalFolder,
        ours.commit,
        merged.tree,
      );
      const postCommit = await this.commitTreeToRef(
        fresh.shadowDir,
        merged.tree,
        ours.commit,
        `refs/cairn/tasks/${fresh.convId}/deliveries/${stepId}/post`,
        `post-merge ${fresh.convId} ${stepId}`,
      );
      fresh.deliveries.push({
        stepId,
        preCommit: ours.commit,
        postCommit,
      });
      fresh.legBaseCommit = fresh.headCommit;
      fresh.status = 'merged';
      fresh.conflictFiles = [];
      delete fresh.reason;
      this.writeTaskRecord(fresh);
      this.writeJournal(fresh.shadowDir, {
        buildId: fresh.convId,
        stepId,
        action: 'merge',
        state: 'applied',
        preCommit: ours.commit,
        targetTree: merged.tree,
        postCommit,
        updatedAt: Date.now(),
      });
      return { mode: 'isolated', status: 'merged', undoable: true };
    } catch (err) {
      if (err instanceof ShadowConcurrentEditError) {
        fresh.status = 'conflict';
        fresh.conflictFiles = err.conflictFiles;
        fresh.reason = `写回期间目标文件被修改：${err.conflictFiles.join(', ')}`;
        this.writeTaskRecord(fresh);
        return {
          mode: 'isolated',
          status: 'conflict',
          undoable: fresh.deliveries.length > 0,
          conflictFiles: err.conflictFiles,
          reason: fresh.reason,
        };
      }
      if (err instanceof ShadowGitTimeoutError || err instanceof ShadowGitUnsupportedError) {
        fresh.checkpointsDisabled = true;
        fresh.status = 'disabled';
        fresh.reason = err.message;
        this.writeTaskRecord(fresh);
        return { mode: 'isolated', status: 'disabled', undoable: false, reason: err.message };
      }
      if (err instanceof ShadowDiskFullError) {
        fresh.status = 'disk-full';
        fresh.reason = err.message;
        this.writeTaskRecord(fresh);
        return {
          mode: 'isolated',
          status: 'disk-full',
          undoable: fresh.deliveries.length > 0,
          reason: err.message,
        };
      }
      if (err instanceof ShadowPartialApplyError) {
        this.writeJournal(fresh.shadowDir, {
          buildId: fresh.convId,
          stepId,
          action: 'merge',
          state: 'partial-unknown',
          preCommit: fresh.legBaseCommit,
          targetTree: '',
          updatedAt: Date.now(),
        });
        fresh.status = 'partial-unknown';
        fresh.reason = err.message;
        this.writeTaskRecord(fresh);
        return {
          mode: 'isolated',
          status: 'partial-unknown',
          undoable: false,
          reason: err.message,
        };
      }
      throw err;
    }
  }

  plainFolderMeta(workDir: string): PlainFolderStepMeta | null {
    const record = this.taskRecordForWorkDir(workDir);
    if (record === null || record.status === 'running') return null;
    return {
      mode: record.mode,
      status: record.status,
      undoable: record.deliveries.length > 0 && record.status !== 'undone',
      ...(record.conflictFiles.length > 0 ? { conflictFiles: record.conflictFiles } : {}),
      ...(record.reason !== undefined ? { reason: record.reason } : {}),
    };
  }

  async runAction(input: {
    workspacesRoot: string;
    buildId: string;
    stepId: string;
    realFolder: string;
    action: 'undo' | 'merge';
  }): Promise<LocalFolderActionResult> {
    const shadowDir = this.shadowDirFor(input.workspacesRoot, input.realFolder);
    if (this.disabledShadows.has(shadowDir)) {
      return { outcome: 'disabled', reason: '快照超时，本目录本轮已停用保护快照' };
    }
    const canonical = canonicalFolderPath(input.realFolder);
    return this.withFolderWriteLock(canonical, async () => {
      const fresh = this.readTaskRecord(shadowDir, input.buildId);
      if (fresh === null) {
        return { outcome: 'snapshot-missing', reason: '找不到该任务的快照记录' };
      }
      const priorReceipt = fresh.lastActionReceipts[input.stepId];
      if (priorReceipt !== undefined) return priorReceipt;

      const finish = (result: LocalFolderActionResult): LocalFolderActionResult => {
        fresh.lastActionReceipts[input.stepId] = result;
        this.writeTaskRecord(fresh);
        return result;
      };

      const recStatus = await this.reconcileAllShadowJournalsUnlocked(fresh.shadowDir);
      if (recStatus === 'partial-unknown') {
        const latest = this.readTaskRecord(shadowDir, input.buildId) ?? fresh;
        return finish({
          outcome: 'partial-unknown',
          reason: latest.reason ?? '上次本地文件夹写回中断，请先手动核对目录',
        });
      }

      if (fresh.checkpointsDisabled === true) {
        return finish({ outcome: 'disabled', reason: '快照超时，本目录本轮已停用保护快照' });
      }
      if (input.action === 'merge') {
        if (fresh.mode === 'in-place') {
          return finish({ outcome: 'failed', reason: '原地运行的大目录任务不支持单独再合并' });
        }
        if (fresh.status === 'undone') {
          return finish({
            outcome: 'failed',
            reason: '本次本地目录改动已撤销，如需再次改动请新建或重跑任务',
          });
        }
        if (fresh.status === 'merged' && fresh.deliveries.length > 0) {
          const last = fresh.deliveries.at(-1);
          return finish({
            outcome: 'already-merged',
            ...(last !== undefined ? { commit: last.postCommit } : {}),
          });
        }
        const merged = await this.mergeTaskBackUnlocked(fresh, input.stepId);
        if (merged.status === 'merged') {
          const last = this.readTaskRecord(shadowDir, input.buildId)?.deliveries.at(-1);
          return finish({
            outcome: 'merged',
            ...(last !== undefined ? { commit: last.postCommit } : {}),
          });
        }
        if (merged.status === 'conflict') {
          return finish({
            outcome: 'conflict',
            ...(merged.conflictFiles !== undefined ? { conflictFiles: merged.conflictFiles } : {}),
            ...(merged.reason !== undefined ? { reason: merged.reason } : {}),
          });
        }
        return finish({
          outcome: merged.status,
          ...(merged.reason !== undefined ? { reason: merged.reason } : {}),
        });
      }

      if (fresh.status === 'undone') {
        return finish({ outcome: 'already-undone' });
      }
      if (fresh.deliveries.length === 0) {
        return finish({ outcome: 'no-changes' });
      }
      const idVerdict = await this.verifyFolderIdentity(fresh);
      if (idVerdict !== 'ok') {
        fresh.status = idVerdict;
        return finish({
          outcome: idVerdict,
          reason:
            idVerdict === 'missing-folder'
              ? '目标本地文件夹已不存在或被移动'
              : '目标本地文件夹已被替换或初始化为 Git 仓库',
        });
      }
      for (const leg of fresh.deliveries) {
        if (
          !(await this.commitExists(fresh.shadowDir, leg.preCommit)) ||
          !(await this.commitExists(fresh.shadowDir, leg.postCommit))
        ) {
          fresh.status = 'snapshot-missing';
          return finish({
            outcome: 'snapshot-missing',
            reason: '历史快照已被清理或缺失，无法自动撤销',
          });
        }
      }
      try {
        const current = await this.snapshotWorkTree(
          fresh.shadowDir,
          fresh.canonicalFolder,
          `refs/cairn/tasks/${fresh.convId}/pre-undo`,
          null,
          `pre-undo ${fresh.convId}`,
        );
        let runningCommit = current.commit;
        for (const leg of [...fresh.deliveries].reverse()) {
          const rev = await this.mergeVirtualThreeWay(
            fresh.shadowDir,
            leg.postCommit,
            runningCommit,
            leg.preCommit,
          );
          if (!rev.ok) {
            fresh.status = 'conflict';
            fresh.conflictFiles = rev.conflictFiles;
            fresh.reason = `撤销冲突：${rev.conflictFiles.join(', ')}`;
            return finish({
              outcome: 'conflict',
              conflictFiles: rev.conflictFiles,
              reason: fresh.reason,
            });
          }
          runningCommit = await this.runShadowGitOk(fresh.shadowDir, [
            'commit-tree',
            rev.tree,
            '-p',
            runningCommit,
            '-m',
            `undo step ${leg.stepId}`,
          ]);
        }
        const finalTree = await this.treeOf(fresh.shadowDir, runningCommit);
        this.writeJournal(fresh.shadowDir, {
          buildId: fresh.convId,
          stepId: input.stepId,
          action: 'undo',
          state: 'applying',
          preCommit: current.commit,
          targetTree: finalTree,
          updatedAt: Date.now(),
        });
        await this.applyTreeDeltaToFolder(
          fresh.shadowDir,
          fresh.canonicalFolder,
          current.commit,
          finalTree,
        );
        const postUndoCommit = await this.commitTreeToRef(
          fresh.shadowDir,
          finalTree,
          current.commit,
          `refs/cairn/tasks/${fresh.convId}/post-undo`,
          `post-undo ${fresh.convId}`,
        );
        fresh.status = 'undone';
        fresh.conflictFiles = [];
        delete fresh.reason;
        const result: LocalFolderActionResult = { outcome: 'undone', commit: postUndoCommit };
        fresh.lastActionReceipts[input.stepId] = result;
        this.writeTaskRecord(fresh);
        this.writeJournal(fresh.shadowDir, {
          buildId: fresh.convId,
          stepId: input.stepId,
          action: 'undo',
          state: 'applied',
          preCommit: current.commit,
          targetTree: finalTree,
          postCommit: postUndoCommit,
          updatedAt: Date.now(),
        });
        return result;
      } catch (err) {
        if (err instanceof ShadowConcurrentEditError) {
          fresh.status = 'conflict';
          fresh.conflictFiles = err.conflictFiles;
          fresh.reason = `撤销期间目标文件被修改：${err.conflictFiles.join(', ')}`;
          return finish({
            outcome: 'conflict',
            conflictFiles: err.conflictFiles,
            reason: fresh.reason,
          });
        }
        if (err instanceof ShadowGitTimeoutError || err instanceof ShadowGitUnsupportedError) {
          fresh.status = 'disabled';
          return finish({ outcome: 'disabled', reason: err.message });
        }
        if (err instanceof ShadowDiskFullError) {
          fresh.status = 'disk-full';
          return finish({ outcome: 'disk-full', reason: err.message });
        }
        if (err instanceof ShadowPartialApplyError) {
          this.writeJournal(fresh.shadowDir, {
            buildId: fresh.convId,
            stepId: input.stepId,
            action: 'undo',
            state: 'partial-unknown',
            preCommit: '',
            targetTree: '',
            updatedAt: Date.now(),
          });
          fresh.status = 'partial-unknown';
          return finish({ outcome: 'partial-unknown', reason: err.message });
        }
        throw err;
      }
    });
  }

  removeIsolatedWorkspace(convDir: string): void {
    const rec = this.taskRecordForWorkDir(convDir);
    if (rec?.mode === 'isolated') {
      rmSync(convDir, { recursive: true, force: true });
    }
    this.workDirToTaskMeta.delete(convDir);
  }
}
