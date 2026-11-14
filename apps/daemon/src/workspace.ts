import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import {
  type BoundGitCredentials,
  BRIEF_MARKER_BEGIN,
  BRIEF_RECONCILE_FILENAMES,
  type CommitIdentity,
  conversationBranch,
  type GitCredentialSource,
  LOCAL_ERROR_REASON_COPY,
  LocalRepoUnreachableError,
  normalizedRepoRef,
  ORPHAN_WORKTREE_TTL_MS,
  type OrphanCleanupInput,
  type PreparedWorkspace,
  type PushPublication,
  READONLY_EXPORT_MARKER,
  ReadOnlyWorkspaceError,
  RemoteBranchDivergedError,
  WORKSPACE_HOOK_TIMEOUT_MS,
  type WorkspaceHookNoteData,
  type WorktreeOps,
  type WorktreePrepareInput,
} from '@cairn/shared';
import {
  GIT_NET_RETRY_DELAYS_MS,
  gitPrim,
  withGitCredentialFallback,
  withGitNetRetries,
} from './git.js';
import type { DaemonLogger } from './log.js';
import { attributeStepCommits } from './step-attribution.js';
import {
  runWorkspaceHook,
  WorkspaceHookError,
  workspaceHookErrorMessage,
} from './workspace-hooks.js';

const SETUP_DRIFT_FILE = 'cairn-setup-drift.json';

type PathFingerprints = Record<string, string>;

async function worktreeFingerprint(cwd: string, path: string): Promise<string> {
  const full = join(cwd, path);
  if (!existsSync(full) && !isDanglingLink(full)) return 'absent';
  const stat = lstatSync(full);
  if (stat.isSymbolicLink()) return `link:${readlinkSync(full)}`;
  if (stat.isDirectory()) {
    const head = existsSync(join(full, '.git')) ? await gitPrim.head(full) : null;
    return `dir:${head ?? 'none'}`;
  }
  const executable = (stat.mode & 0o111) !== 0 ? 'x' : '-';
  return `file:${executable}:${createHash('sha256').update(readFileSync(full)).digest('hex')}`;
}

function isDanglingLink(full: string): boolean {
  try {
    return lstatSync(full).isSymbolicLink();
  } catch {
    return false;
  }
}

async function fingerprintsOf(cwd: string, paths: readonly string[]): Promise<PathFingerprints> {
  const index = await gitPrim.indexEntries(cwd, paths);
  const entries = await Promise.all(
    paths.map(
      async (path) =>
        [
          path,
          `${await worktreeFingerprint(cwd, path)}|index:${index.get(path) ?? 'absent'}`,
        ] as const,
    ),
  );
  return Object.fromEntries(entries);
}

function readSetupDrift(file: string): PathFingerprints {
  if (!existsSync(file)) return {};
  const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  return Object.fromEntries(
    Object.entries(parsed).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
}

const CONV_DIR_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export { normalizedRepoRef } from '@cairn/shared';

async function localSourceUsable(
  localPath: string,
  cloneUrl: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!existsSync(localPath)) return { ok: false, reason: 'not found' };
  const origin = await gitPrim.remoteUrl(localPath);
  if (origin === null) return { ok: false, reason: 'no origin remote' };
  if (normalizedRepoRef(origin) !== normalizedRepoRef(cloneUrl)) {
    return { ok: false, reason: `origin mismatch (got ${origin})` };
  }
  return { ok: true };
}

export interface WorkspaceManagerOpts {
  logger: DaemonLogger;
  orphanTtlMs?: number;
  hookTimeoutMs?: number;
  seedRoot?: string;
}

export class WorkspaceManager implements WorktreeOps {
  private readonly locks = new Map<string, Promise<unknown>>();
  private readonly logger: DaemonLogger;
  private readonly orphanTtlMs: number;
  private readonly hookTimeoutMs: number;
  private readonly seedRoot: string | undefined;

  constructor(opts: WorkspaceManagerOpts) {
    this.logger = opts.logger;
    this.seedRoot = opts.seedRoot;
    this.orphanTtlMs = opts.orphanTtlMs ?? ORPHAN_WORKTREE_TTL_MS;
    this.hookTimeoutMs = opts.hookTimeoutMs ?? WORKSPACE_HOOK_TIMEOUT_MS;
  }

  private async withProjectLock<T>(projectId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(projectId) ?? Promise.resolve();
    const run = prev.then(fn, fn);
    const tail = run.then(
      () => undefined,
      () => undefined,
    );
    this.locks.set(projectId, tail);
    try {
      return await run;
    } finally {
      if (this.locks.get(projectId) === tail) this.locks.delete(projectId);
    }
  }

  async prepare(input: WorktreePrepareInput): Promise<PreparedWorkspace> {
    return this.withProjectLock(input.projectId, async () => {
      const seed = this.seedRoot ? join(this.seedRoot, input.projectId, 'repo') : null;
      const cloneUrl = seed && input.repoKind === 'local' ? seed : input.cloneUrl;
      const branch = conversationBranch(input.conversationId);
      const baseRepoDir = join(input.workspacesRoot, input.projectId, 'repo');
      const convDir = join(input.workspacesRoot, input.conversationId);

      if (input.repoKind === 'local') {
        if (!existsSync(cloneUrl)) {
          throw new LocalRepoUnreachableError(cloneUrl, 'not_found');
        }
        if (!(await gitPrim.isGitDir(cloneUrl))) {
          throw new LocalRepoUnreachableError(cloneUrl, 'not_git');
        }
      }

      const credFallback = !this.seedRoot && input.machineCredentialFallback === true;
      let credentialSource: GitCredentialSource = 'integration';
      const runNet = async (
        what: string,
        op: (cred: BoundGitCredentials | null) => Promise<void>,
        onFallback?: (reason: string) => void,
      ): Promise<GitCredentialSource> => {
        const source = await withGitCredentialFallback(
          (cred) => {
            let attempt = 0;
            return withGitNetRetries(() => {
              if (attempt > 0) {
                this.logger.workspace(
                  `git ${what} network retry ${attempt}/${GIT_NET_RETRY_DELAYS_MS.length} after ${GIT_NET_RETRY_DELAYS_MS[attempt - 1]}ms`,
                );
              }
              attempt++;
              return op(cred);
            });
          },
          input.credentials,
          {
            what,
            allowMachineFallback: credFallback,
            onFallback: (reason) => {
              onFallback?.(reason);
              this.logger.workspace(
                `git ${what} auth failed (per-step token), retrying with machine credentials: ${reason}`,
              );
            },
          },
        );
        if (source === 'machine') credentialSource = 'machine';
        return source;
      };
      if (!existsSync(join(baseRepoDir, '.git')) && !isBareish(baseRepoDir)) {
        let fromLocal = false;
        if (seed && existsSync(seed)) {
          await gitPrim.clone(seed, baseRepoDir, null);
          await gitPrim.setRemoteUrl(baseRepoDir, cloneUrl);
          await runNet('fetch', (cred) => gitPrim.fetch(baseRepoDir, cred));
          await gitPrim.remoteSetHeadAuto(baseRepoDir, input.credentials);
          this.logger.workspace('Repo source: orb seed');
          fromLocal = true;
        }
        if (!fromLocal && !this.seedRoot && input.localPath != null && input.localPath !== '') {
          const verdict = await localSourceUsable(input.localPath, cloneUrl);
          if (verdict.ok) {
            try {
              await gitPrim.clone(input.localPath, baseRepoDir, null);
              await gitPrim.setRemoteUrl(baseRepoDir, cloneUrl);
              const fetchSource = await runNet('fetch', (cred) => gitPrim.fetch(baseRepoDir, cred));
              const setHeadCred = fetchSource === 'machine' ? null : input.credentials;
              await gitPrim.remoteSetHeadAuto(baseRepoDir, setHeadCred);
              this.logger.workspace(`Repo source: local-path ${input.localPath}`);
              fromLocal = true;
            } catch (err) {
              rmSync(baseRepoDir, { recursive: true, force: true });
              this.logger.workspace(
                `Repo source: github-clone (local-path ${input.localPath} clone failed: ${
                  err instanceof Error ? err.message : String(err)
                })`,
              );
            }
          } else {
            this.logger.workspace(
              `Repo source: github-clone (local-path ${input.localPath} ${verdict.reason})`,
            );
          }
        }
        if (!fromLocal) {
          const label = repoLabel(cloneUrl);
          const defaultBranchGuess = 'main';
          this.logger.workspace(`Cloning ${label} (branch: ${defaultBranchGuess})`);
          await runNet(
            'clone',
            (cred) => gitPrim.clone(cloneUrl, baseRepoDir, cred),
            () => rmSync(baseRepoDir, { recursive: true, force: true }),
          );
          await runNet('fetch', (cred) => gitPrim.fetch(baseRepoDir, cred));
        }
      } else {
        const origin = await gitPrim.originConfigUrl(baseRepoDir);
        if (origin !== null && origin !== cloneUrl) {
          await gitPrim.setRemoteUrl(baseRepoDir, cloneUrl);
          this.logger.workspace('Repo origin re-pointed to the project clone URL');
        }
        await runNet('fetch', (cred) => gitPrim.fetch(baseRepoDir, cred));
      }
      const defaultBranch = input.baseBranch ?? (await gitPrim.remoteDefaultBranch(baseRepoDir));
      if (input.readonly === true) {
        const reused = await this.materializeReadonlyExport(
          baseRepoDir,
          convDir,
          branch,
          defaultBranch,
        );
        return {
          cwd: convDir,
          baseRepoDir,
          branch,
          defaultBranch,
          reused,
          readonly: true,
          hooks: [],
          credentialSource,
        };
      }

      if (isWorktreeDir(convDir) && !isReadonlyExportDir(convDir)) {
        if (await gitPrim.hasRemoteBranch(baseRepoDir, branch)) {
          const current = await gitPrim.currentBranch(convDir);
          const remoteAhead = await gitPrim.countRemoteAhead(baseRepoDir, branch);
          if (remoteAhead > 0 && current !== branch) throw new RemoteBranchDivergedError(branch);
        }
        this.logger.workspace('Worktree reused');
        const hooks = await this.runHookStage(convDir, 'resume', input.credentials);
        return {
          cwd: convDir,
          baseRepoDir,
          branch,
          defaultBranch,
          reused: true,
          hooks,
          credentialSource,
        };
      }

      if (
        input.baseBranch != null &&
        !(await gitPrim.hasRemoteBranch(baseRepoDir, defaultBranch))
      ) {
        throw new Error(`remote has no base branch (origin/${defaultBranch} missing)`);
      }
      if (existsSync(convDir)) rmSync(convDir, { recursive: true, force: true });
      await gitPrim.worktreePrune(baseRepoDir);
      const remoteHas = await gitPrim.hasRemoteBranch(baseRepoDir, branch);
      const localHas = await gitPrim.hasLocalBranch(baseRepoDir, branch);
      if (localHas) await gitPrim.branchDelete(baseRepoDir, branch);
      const base = remoteHas ? `origin/${branch}` : `origin/${defaultBranch}`;
      if (!(await gitPrim.hasRemoteBranch(baseRepoDir, defaultBranch)) && !remoteHas) {
        throw new Error(`remote has no base branch (origin/${defaultBranch} missing)`);
      }
      await gitPrim.worktreeAdd(baseRepoDir, branch, convDir, base);
      this.logger.workspace(`Worktree added (${branch} from ${base})`);
      const hooks = await this.runHookStage(convDir, 'setup', input.credentials);
      return {
        cwd: convDir,
        baseRepoDir,
        branch,
        defaultBranch,
        reused: false,
        hooks,
        credentialSource,
      };
    });
  }

  private async materializeReadonlyExport(
    baseRepoDir: string,
    convDir: string,
    branch: string,
    defaultBranch: string,
  ): Promise<boolean> {
    const marker = join(convDir, READONLY_EXPORT_MARKER);
    if (isReadonlyExportDir(convDir)) {
      const now = new Date();
      utimesSync(marker, now, now);
      this.logger.workspace('Readonly export reused');
      return true;
    }
    if (isWorktreeDir(convDir) && !isReadonlyExportDir(convDir)) await this.removeStale(convDir);
    if (existsSync(convDir)) rmSync(convDir, { recursive: true, force: true });
    await gitPrim.worktreePrune(baseRepoDir);
    if (await gitPrim.hasLocalBranch(baseRepoDir, branch)) {
      await gitPrim.branchDelete(baseRepoDir, branch);
    }
    if (!(await gitPrim.hasRemoteBranch(baseRepoDir, defaultBranch))) {
      throw new Error(`remote has no base branch (origin/${defaultBranch} missing)`);
    }
    mkdirSync(convDir, { recursive: true });
    await gitPrim.exportTree(baseRepoDir, `origin/${defaultBranch}`, convDir);
    writeFileSync(marker, `readonly export of origin/${defaultBranch}\n`);
    this.logger.workspace(`Readonly export (origin/${defaultBranch}, no git metadata)`);
    return false;
  }

  private async runHookStage(
    cwd: string,
    name: 'setup' | 'resume',
    credentials: BoundGitCredentials | null,
  ): Promise<WorkspaceHookNoteData[]> {
    try {
      const note = await this.recordingSetupDrift(cwd, () =>
        runWorkspaceHook({
          cwd,
          name,
          credentials,
          timeoutMs: this.hookTimeoutMs,
          log: (line) => this.logger.workspace(line),
        }),
      );
      return note === null ? [] : [note];
    } catch (err) {
      if (err instanceof WorkspaceHookError) {
        if (name === 'resume') {
          this.logger.workspace(`resume hook failed (non-fatal, continuing): ${err.message}`);
          return [err.note];
        }
        try {
          await this.removeStale(cwd);
        } catch {}
        throw new Error(workspaceHookErrorMessage(err.note), { cause: err });
      }
      throw err;
    }
  }

  private async recordingSetupDrift<T>(cwd: string, run: () => Promise<T>): Promise<T> {
    const before = await fingerprintsOf(cwd, await gitPrim.dirtyPaths(cwd));
    try {
      return await run();
    } finally {
      if (existsSync(cwd)) {
        const after = await fingerprintsOf(cwd, await gitPrim.dirtyPaths(cwd));
        const file = await gitPrim.gitPath(cwd, SETUP_DRIFT_FILE);
        const drift = readSetupDrift(file);
        for (const path of new Set([...Object.keys(before), ...Object.keys(after)])) {
          if (before[path] === after[path]) continue;
          const agentOwned = before[path] !== undefined && drift[path] !== before[path];
          const now = after[path];
          if (now === undefined || agentOwned) delete drift[path];
          else drift[path] = now;
        }
        writeFileSync(file, JSON.stringify(drift));
      }
    }
  }

  async commitAll(
    cwd: string,
    message: string,
    identity: CommitIdentity,
  ): Promise<{ committed: boolean; head: string | null; setupDrift: string[] }> {
    if (isReadonlyExportDir(cwd)) throw new ReadOnlyWorkspaceError(cwd);
    const driftFile = await gitPrim.gitPath(cwd, SETUP_DRIFT_FILE);
    const drift = readSetupDrift(driftFile);
    const dirty = await gitPrim.dirtyPaths(cwd);
    const current = await fingerprintsOf(cwd, dirty);
    const setupDrift = dirty.filter(
      (path) => drift[path] !== undefined && drift[path] === current[path],
    );
    const driftSet = new Set(setupDrift);
    await gitPrim.addPaths(
      cwd,
      dirty.filter((path) => !driftSet.has(path)),
    );
    await gitPrim.unstagePaths(cwd, setupDrift);
    writeFileSync(driftFile, JSON.stringify(await fingerprintsOf(cwd, setupDrift)));
    for (const path of setupDrift) {
      this.logger.workspace(`workspace setup drift left out of the commit: ${path}`);
    }
    const leaked = await gitPrim.stagedPathsContaining(cwd, BRIEF_MARKER_BEGIN, [
      ...BRIEF_RECONCILE_FILENAMES,
    ]);
    for (const path of leaked) {
      await gitPrim.unstagePath(cwd, path);
      this.logger.workspace(`brief marker dropped from commit: ${path}`);
    }
    const committed = await gitPrim.commit(cwd, message, identity, this.hookTimeoutMs);
    const head = await gitPrim.head(cwd);
    return { committed, head, setupDrift };
  }

  async briefMarkerInRef(cwd: string, ref: string): Promise<string[]> {
    return gitPrim.pathsContainingInRef(cwd, ref, BRIEF_MARKER_BEGIN, [
      ...BRIEF_RECONCILE_FILENAMES,
    ]);
  }

  async push(
    cwd: string,
    branch: string,
    credentials: BoundGitCredentials | null,
    publication: PushPublication,
  ): Promise<void> {
    if (isReadonlyExportDir(cwd)) throw new ReadOnlyWorkspaceError(cwd);
    await attributeStepCommits({ ...publication, dir: cwd, branch, credential: credentials });
    await withGitNetRetries(() =>
      gitPrim.push(cwd, branch, credentials, (local, remote) =>
        this.logger.workspace(
          `push of ${branch} already contained in origin/${branch} (local ${local.slice(0, 7)}, remote ${remote.slice(0, 7)}); nothing to push`,
        ),
      ),
    );
  }

  async mergeDefaultBranch(
    cwd: string,
    defaultBranch: string,
    credentials: BoundGitCredentials | null,
  ): Promise<{ output: string }> {
    const driftFile = await gitPrim.gitPath(cwd, SETUP_DRIFT_FILE);
    const drift = readSetupDrift(driftFile);
    const recorded = Object.keys(drift);
    const current = await fingerprintsOf(cwd, recorded);
    const setupDrift = recorded.filter((path) => drift[path] === current[path]);
    if (setupDrift.length === 0) {
      return { output: await gitPrim.mergeNoEdit(cwd, `origin/${defaultBranch}`) };
    }
    await gitPrim.resetPathsToHead(cwd, setupDrift);
    writeFileSync(driftFile, JSON.stringify({}));
    this.logger.workspace(`setup drift reset before merge: ${setupDrift.join(', ')}`);
    const output = await gitPrim.mergeNoEdit(cwd, `origin/${defaultBranch}`);
    try {
      await this.recordingSetupDrift(cwd, () =>
        runWorkspaceHook({
          cwd,
          name: 'setup',
          credentials,
          timeoutMs: this.hookTimeoutMs,
          log: (line) => this.logger.workspace(line),
        }),
      );
    } catch (err) {
      if (err instanceof WorkspaceHookError) {
        throw new Error(workspaceHookErrorMessage(err.note), { cause: err });
      }
      throw err;
    }
    return { output };
  }

  async headCommit(cwd: string): Promise<string | null> {
    return gitPrim.head(cwd);
  }

  async countAhead(cwd: string, defaultBranch: string): Promise<number> {
    return gitPrim.countAhead(cwd, defaultBranch);
  }

  async commitsAhead(cwd: string, defaultBranch: string): Promise<string[]> {
    return gitPrim.commitsAhead(cwd, defaultBranch);
  }

  async currentBranch(cwd: string): Promise<string | null> {
    return gitPrim.currentBranch(cwd);
  }

  async branchesWithNewCommits(
    cwd: string,
    baseCommit: string,
    sinceMs: number,
  ): Promise<string[]> {
    return gitPrim.branchesWithNewCommits(cwd, baseCommit, sinceMs);
  }

  async diffAgainstDefault(cwd: string, defaultBranch: string): Promise<string> {
    return gitPrim.diffAgainstRemoteDefault(cwd, defaultBranch);
  }

  async restoreCheckpoint(cwd: string, commit: string): Promise<void> {
    await gitPrim.resetHard(cwd, commit);
    await gitPrim.cleanFd(cwd);
    this.logger.workspace('Worktree restored');
  }

  async cleanupOrphans(input: OrphanCleanupInput): Promise<string[]> {
    const ttlMs = input.ttlMs > 0 ? input.ttlMs : this.orphanTtlMs;
    const active = new Set(input.activeConversationIds);
    const removed: string[] = [];
    let entries: string[] = [];
    try {
      entries = readdirSync(input.workspacesRoot);
    } catch {
      return removed;
    }
    for (const name of entries) {
      if (!CONV_DIR_PATTERN.test(name) || active.has(name)) continue;
      const dir = join(input.workspacesRoot, name);
      if (isReadonlyExportDir(dir)) {
        const activity = Math.max(
          statSync(dir).mtimeMs,
          statSync(join(dir, READONLY_EXPORT_MARKER)).mtimeMs,
        );
        if (input.now - activity < ttlMs) continue;
        rmSync(dir, { recursive: true, force: true });
        removed.push(name);
        continue;
      }
      if (!isWorktreeDir(dir)) continue;
      const age = input.now - (await this.lastActivity(dir));
      if (age < ttlMs) continue;
      try {
        await this.removeStale(dir);
        removed.push(name);
      } catch (err) {
        this.logger.workspace(
          `orphan cleanup failed for ${name}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    return removed;
  }

  async removeStale(convDir: string): Promise<void> {
    const branch = await gitPrim.currentBranch(convDir);
    const commonDir = await gitPrim.commonGitDir(convDir);
    if (commonDir !== null) {
      const baseRepoDir = dirname(commonDir);
      await gitPrim.worktreeRemoveForce(baseRepoDir, convDir);
      await gitPrim.worktreePrune(baseRepoDir);
      if (branch !== null) {
        await gitPrim.branchDelete(baseRepoDir, branch).catch(() => {});
      }
      return;
    }
    rmSync(convDir, { recursive: true, force: true });
  }

  private async lastActivity(dir: string): Promise<number> {
    let latest = statSync(dir).mtimeMs;
    const head = await gitPrim.head(dir);
    if (head !== null) {
      const r = await gitPrim.commitTime(dir, head);
      if (r !== null) latest = Math.max(latest, r);
    }
    return latest;
  }
}

function isWorktreeDir(dir: string): boolean {
  return existsSync(join(dir, '.git'));
}

function isReadonlyExportDir(dir: string): boolean {
  return existsSync(join(dir, READONLY_EXPORT_MARKER));
}

function isBareish(dir: string): boolean {
  return existsSync(join(dir, 'HEAD'));
}

export function localRepoUnreachableMessage(
  machineName: string,
  err: LocalRepoUnreachableError,
): string {
  return [
    `local 形态项目无法在 Runner「${machineName}」上执行步骤：仓库路径 ${err.repoPath} 在本机不可达（${LOCAL_ERROR_REASON_COPY[err.reason]}）。`,
    'local 形态的仓库真值在登记机的文件系统上（ADR 0016），其它 Runner 看不到该路径——本项目只能在仓库所在 Runner 上运行。',
    '补法（任选其一）：① 把任务的钉选 Runner 改回仓库所在 Runner（或取消钉选，由该 Runner 认领）；',
    '② 跨机开发请用 GitHub 形态建项目（githubRepo 为真值，同机可加挂 localPath 加速位，ADR 0017）。',
  ].join('');
}

export function repoLabel(cloneUrl: string): string {
  try {
    const path = new URL(cloneUrl).pathname.replace(/^\/+|\/+$/g, '');
    const segments = path.split('/').filter(Boolean);
    if (segments[0] === 'git') segments.shift();
    return segments
      .slice(-2)
      .join('/')
      .replace(/\.git$/, '');
  } catch {
    return cloneUrl;
  }
}

export { CONV_DIR_PATTERN };
