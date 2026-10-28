import {
  existsSync,
  mkdirSync,
  readdirSync,
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
  conversationBranch,
  type GitCredentialSource,
  LOCAL_ERROR_REASON_COPY,
  LocalRepoUnreachableError,
  ORPHAN_WORKTREE_TTL_MS,
  type OrphanCleanupInput,
  type PreparedWorkspace,
  READONLY_EXPORT_MARKER,
  ReadOnlyWorkspaceError,
  RemoteBranchDivergedError,
  WORKSPACE_HOOK_TIMEOUT_MS,
  type WorkspaceHookNoteData,
  type WorktreeOps,
  type WorktreePrepareInput,
} from '@cairn/shared';
import { gitPrim, withGitCredentialFallback, withGitNetRetries } from './git.js';
import type { DaemonLogger } from './log.js';
import {
  runWorkspaceHook,
  WorkspaceHookError,
  workspaceHookErrorMessage,
} from './workspace-hooks.js';

const CONV_DIR_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function normalizedRepoRef(url: string): string {
  let ref = url.trim();
  if (ref.endsWith('/')) ref = ref.slice(0, -1);
  if (ref.endsWith('.git')) ref = ref.slice(0, -4);
  const scp = /^([^@/]+)@([^:/]+):(.+)$/.exec(ref);
  if (scp) return `${scp[2]}/${scp[3]}`;
  const scheme = /^[a-z][a-z0-9+.-]*:\/\/(?:([^@/]+)@)?([^/]+)\/(.+)$/i.exec(ref);
  if (scheme) return `${scheme[2]}/${scheme[3]}`;
  return ref;
}

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
}

export class WorkspaceManager implements WorktreeOps {
  private readonly locks = new Map<string, Promise<unknown>>();
  private readonly logger: DaemonLogger;
  private readonly orphanTtlMs: number;
  private readonly hookTimeoutMs: number;

  constructor(opts: WorkspaceManagerOpts) {
    this.logger = opts.logger;
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
      const branch = conversationBranch(input.conversationId);
      const baseRepoDir = join(input.workspacesRoot, input.projectId, 'repo');
      const convDir = join(input.workspacesRoot, input.conversationId);

      if (input.repoKind === 'local') {
        if (!existsSync(input.cloneUrl)) {
          throw new LocalRepoUnreachableError(input.cloneUrl, 'not_found');
        }
        if (!(await gitPrim.isGitDir(input.cloneUrl))) {
          throw new LocalRepoUnreachableError(input.cloneUrl, 'not_git');
        }
      }

      const credFallback = input.machineCredentialFallback === true;
      let credentialSource: GitCredentialSource = 'integration';
      const runNet = async (
        what: string,
        op: (cred: BoundGitCredentials | null) => Promise<void>,
        onFallback?: (reason: string) => void,
      ): Promise<GitCredentialSource> => {
        const source = await withGitCredentialFallback(op, input.credentials, {
          what,
          allowMachineFallback: credFallback,
          onFallback: (reason) => {
            onFallback?.(reason);
            this.logger.workspace(
              `git ${what} auth failed (per-step token), retrying with machine credentials: ${reason}`,
            );
          },
        });
        if (source === 'machine') credentialSource = 'machine';
        return source;
      };
      if (!existsSync(join(baseRepoDir, '.git')) && !isBareish(baseRepoDir)) {
        let fromLocal = false;
        if (input.localPath != null && input.localPath !== '') {
          const verdict = await localSourceUsable(input.localPath, input.cloneUrl);
          if (verdict.ok) {
            try {
              await gitPrim.clone(input.localPath, baseRepoDir, null);
              await gitPrim.setRemoteUrl(baseRepoDir, input.cloneUrl);
              const fetchSource = await runNet('fetch', (cred) =>
                withGitNetRetries(() => gitPrim.fetch(baseRepoDir, cred)),
              );
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
          const label = repoLabel(input.cloneUrl);
          const defaultBranchGuess = 'main';
          this.logger.workspace(`Cloning ${label} (branch: ${defaultBranchGuess})`);
          await runNet(
            'clone',
            (cred) => withGitNetRetries(() => gitPrim.clone(input.cloneUrl, baseRepoDir, cred)),
            () => rmSync(baseRepoDir, { recursive: true, force: true }),
          );
        }
      } else {
        const origin = await gitPrim.originConfigUrl(baseRepoDir);
        if (origin !== null && origin !== input.cloneUrl) {
          await gitPrim.setRemoteUrl(baseRepoDir, input.cloneUrl);
          this.logger.workspace('Repo origin re-pointed to the project clone URL');
        }
        await runNet('fetch', (cred) => withGitNetRetries(() => gitPrim.fetch(baseRepoDir, cred)));
      }
      const defaultBranch = await gitPrim.remoteDefaultBranch(baseRepoDir);

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
      const note = await runWorkspaceHook({
        cwd,
        name,
        credentials,
        timeoutMs: this.hookTimeoutMs,
        log: (line) => this.logger.workspace(line),
      });
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

  async commitAll(cwd: string, message: string, identity: { name: string; email: string }) {
    if (isReadonlyExportDir(cwd)) throw new ReadOnlyWorkspaceError(cwd);
    await gitPrim.addAll(cwd);
    const leaked = await gitPrim.stagedPathsContaining(cwd, BRIEF_MARKER_BEGIN, [
      ...BRIEF_RECONCILE_FILENAMES,
    ]);
    for (const path of leaked) {
      await gitPrim.unstagePath(cwd, path);
      this.logger.workspace(`brief marker dropped from commit: ${path}`);
    }
    const committed = await gitPrim.commit(cwd, message, identity);
    const head = await gitPrim.head(cwd);
    return { committed, head };
  }

  async briefMarkerInRef(cwd: string, ref: string): Promise<string[]> {
    return gitPrim.pathsContainingInRef(cwd, ref, BRIEF_MARKER_BEGIN, [
      ...BRIEF_RECONCILE_FILENAMES,
    ]);
  }

  async push(cwd: string, branch: string, credentials: BoundGitCredentials | null): Promise<void> {
    if (isReadonlyExportDir(cwd)) throw new ReadOnlyWorkspaceError(cwd);
    await withGitNetRetries(() =>
      gitPrim.push(cwd, branch, credentials, (local, remote) =>
        this.logger.workspace(
          `push of ${branch} already contained in origin/${branch} (local ${local.slice(0, 7)}, remote ${remote.slice(0, 7)}); nothing to push`,
        ),
      ),
    );
  }

  async mergeDefaultBranch(cwd: string, defaultBranch: string): Promise<{ output: string }> {
    const output = await gitPrim.mergeNoEdit(cwd, `origin/${defaultBranch}`);
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
    `local 形态项目无法在机器「${machineName}」上执行步骤：仓库路径 ${err.repoPath} 在本机不可达（${LOCAL_ERROR_REASON_COPY[err.reason]}）。`,
    'local 形态的仓库真值在登记机的文件系统上（ADR 0016），其它执行机看不到该路径——本项目只能在仓库所在机器上运行。',
    '补法（任选其一）：① 把任务的钉选机器改回仓库所在机器（或取消钉选，由该机器认领）；',
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
