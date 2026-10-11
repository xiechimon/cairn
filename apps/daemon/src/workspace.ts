// worktree 契约落地（02 §5.5 全表，r3 §1.4 实测；shared WorktreeOps 缝的
// daemon 实现，01 §4.3）：
// - 基座 clone `<workspacesRoot>/<projectId>/repo`；任务 worktree
//   `<workspacesRoot>/<conversationId>`；分支 `pacman/conv-<conversationId>`
//   （brand.ts conversationBranch()）。
// - `worktree add -b <branch> <dir> <base>`，base = origin/<convBranch>
//   （已 fetch 时）否则 origin/<defaultBranch>。
// - 复用 `Worktree reused`；checkpoint 恢复 `reset --hard` + `clean -fd` →
//   `Worktree restored`；陈旧 `worktree remove --force` + `prune` + `branch -D`；
//   孤儿回收 TTL 7×24h（ORPHAN_WORKTREE_TTL_MS）。
// - projectLock(projectId) 串行化同项目工作区操作。
// - 防分叉护栏 REMOTE_BRANCH_DIVERGED（shared RemoteBranchDivergedError）。
// git spawn 一律经 git.ts 原语（缝纪律，01 §7.3）。

import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  BRIEF_MARKER_BEGIN,
  BRIEF_RECONCILE_FILENAMES,
  conversationBranch,
  type GitCredentials,
  ORPHAN_WORKTREE_TTL_MS,
  type OrphanCleanupInput,
  type PreparedWorkspace,
  RemoteBranchDivergedError,
  WORKSPACE_HOOK_TIMEOUT_MS,
  type WorkspaceHookNoteData,
  type WorktreeOps,
  type WorktreePrepareInput,
} from '@pacman/shared';
import { gitPrim, withGitNetRetries } from './git.js';
import type { DaemonLogger } from './log.js';
import {
  runWorkspaceHook,
  WorkspaceHookError,
  workspaceHookErrorMessage,
} from './workspace-hooks.js';

/** conversationId 目录形状（UUIDv7，r3 §1.4 样本）——孤儿扫描的判别式。 */
const CONV_DIR_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface WorkspaceManagerOpts {
  logger: DaemonLogger;
  /** 测试注入（缺省 7×24h，02 §5.5）。 */
  orphanTtlMs?: number;
  /** #1149 环境钩子超时（缺省 20min，WORKSPACE_HOOK_TIMEOUT_MS；测试注入
   * 缩短时标）。 */
  hookTimeoutMs?: number;
}

export class WorkspaceManager implements WorktreeOps {
  /** projectLock(projectId)：同项目工作区操作串行化（02 §5.5 并发保护）。 */
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
    const run = prev.then(fn, fn); // 前锁失败不传染（各步独立收尾）。
    // 链尾 swallow：锁链本身不因业务错误断裂。
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

      // —— 基座 clone / fetch（r3 §1.5 日志行 `Cloning <teamId>/<repoName>
      // (branch: main)` 形状；teamId/repoName = cloneUrl 路径段）——
      if (!existsSync(join(baseRepoDir, '.git')) && !isBareish(baseRepoDir)) {
        const label = repoLabel(input.cloneUrl);
        const defaultBranchGuess = 'main';
        this.logger.workspace(`Cloning ${label} (branch: ${defaultBranchGuess})`);
        await withGitNetRetries(() =>
          gitPrim.clone(input.cloneUrl, baseRepoDir, input.credentials),
        );
      } else {
        await withGitNetRetries(() => gitPrim.fetch(baseRepoDir, input.credentials));
      }
      const defaultBranch = await gitPrim.remoteDefaultBranch(baseRepoDir);

      // —— 任务 worktree：存在→reused；不在→add -b（base 二择，02 §5.5）——
      if (isWorktreeDir(convDir)) {
        // 防分叉护栏（02 §5.5）：origin/<branch> 有本机没有的提交且 worktree
        // 不在该分支 → 抛错。
        if (await gitPrim.hasRemoteBranch(baseRepoDir, branch)) {
          const current = await gitPrim.currentBranch(convDir);
          const remoteAhead = await gitPrim.countRemoteAhead(baseRepoDir, branch);
          if (remoteAhead > 0 && current !== branch) throw new RemoteBranchDivergedError(branch);
        }
        this.logger.workspace('Worktree reused');
        // #1149：reused = 唤醒面 → .agents/resume（失败/超时非致命 warn，
        // 不挡步）。钩子消费步级下发凭据（同 gitPrim 注入面，不新开口子）。
        const hooks = await this.runHookStage(convDir, 'resume', input.credentials);
        return { cwd: convDir, baseRepoDir, branch, defaultBranch, reused: true, hooks };
      }

      // 陈旧残留（目录在但非 worktree / 分支在但 worktree 不在）→ 清理三步
      // （remove --force + prune + branch -D，r3 §1.4）。
      if (existsSync(convDir)) rmSync(convDir, { recursive: true, force: true });
      await gitPrim.worktreePrune(baseRepoDir);
      const remoteHas = await gitPrim.hasRemoteBranch(baseRepoDir, branch);
      const localHas = await gitPrim.hasLocalBranch(baseRepoDir, branch);
      if (localHas) await gitPrim.branchDelete(baseRepoDir, branch); // 陈旧分支重建
      const base = remoteHas ? `origin/${branch}` : `origin/${defaultBranch}`;
      if (!(await gitPrim.hasRemoteBranch(baseRepoDir, defaultBranch)) && !remoteHas) {
        throw new Error(`remote has no base branch (origin/${defaultBranch} missing)`);
      }
      await gitPrim.worktreeAdd(baseRepoDir, branch, convDir, base);
      this.logger.workspace(`Worktree added (${branch} from ${base})`);
      // #1149：fresh = 装机面 → .agents/setup（失败=步失败：抛 WorkspaceHookError
      // → runner 的 prepare catch → done failed；失败即回滚 worktree，使重试
      // 认领重新走 fresh → setup 重跑，而不是 reused→resume 掩盖装机缺口）。
      const hooks = await this.runHookStage(convDir, 'setup', input.credentials);
      return { cwd: convDir, baseRepoDir, branch, defaultBranch, reused: false, hooks };
    });
  }

  /** #1149 环境钩子挂点（prepare 两出口各一次）：
   * - setup（fresh 检出后）：失败/超时 = 步失败——WorkspaceHookError 直接
   *   抛出（runner prepare catch → done failed），且**回滚 worktree**（刚
   *   检出的树上没有 agent 工作，可安全清），使重试认领重新走 fresh→setup
   *   而非 reused→resume 掩盖装机缺口。
   * - resume（reused 复用时）：失败/超时非致命——warning 落 workspace 日志，
   *   步继续；note（ok/timeout）仍随 PreparedWorkspace 投影进步日志。
   * 钩子文件缺失 = 静默跳过（零日志零进程，无钩子仓行为与现状一致）。
   * 同项目串行化由 projectLock 免费提供（两 conv 并发 setup 不互踩）。 */
  private async runHookStage(
    cwd: string,
    name: 'setup' | 'resume',
    credentials: GitCredentials | null,
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
        // setup：回滚刚检出的 worktree 再抛（装机失败不留半成品树）。
        try {
          await this.removeStale(cwd);
        } catch {
          // 回滚失败不掩盖钩子错误（钩子错误是第一因）。
        }
        throw new Error(workspaceHookErrorMessage(err.note), { cause: err });
      }
      throw err;
    }
  }

  async commitAll(cwd: string, message: string, identity: { name: string; email: string }) {
    await gitPrim.addAll(cwd);
    // —— #958 闸 5：认标记剔除（纵深防御，主机制是 runner 的步收尾擦除）——
    // 为什么认**内容**而不是认文件名：按名排除（.git/info/exclude 那条路）会把
    // agent 合法产出的 CLAUDE.md（「给这仓库加个 CLAUDE.md」是完全合理的任务）
    // 从 `git add -A` 里静默吞掉——隐形丢活。标记是我们自己的串，误伤面为零。
    // 这一层抓的是擦除漏网与 agent 自己 `git add` 的残留，作用域就是本次提交。
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

  /** #958 闸 4 的检测半：ref 里是否带着简报标记。见 WorktreeOps 的接口注释——
   *  这是检测不是预防，agent 自己提交的那条路径 daemon 拦不住。 */
  async briefMarkerInRef(cwd: string, ref: string): Promise<string[]> {
    return gitPrim.pathsContainingInRef(cwd, ref, BRIEF_MARKER_BEGIN, [
      ...BRIEF_RECONCILE_FILENAMES,
    ]);
  }

  async push(cwd: string, branch: string, credentials: GitCredentials | null): Promise<void> {
    // 重试预算覆盖 git-host 5xx 窗口（02 §5.5/r3 bundle 注原话语义）。
    await withGitNetRetries(() => gitPrim.push(cwd, branch, credentials));
  }

  async mergeDefaultBranch(cwd: string, defaultBranch: string): Promise<{ output: string }> {
    const output = await gitPrim.mergeNoEdit(cwd, `origin/${defaultBranch}`);
    return { output };
  }

  /** local 形态合并落地（spec 12 G2-T2）：merge 步 conv 分支 push 回用户仓库
   * 后，在用户仓库目录 ff-only 推进其当前分支。脏工作区 / 非 ff → gitPrim
   * 抛错携带 git 拒绝原文（调用方按 failed 收尾）；永不 force、永不动用户
   * 工作树。 */
  async landLocalFastForward(userRepoDir: string, branch: string): Promise<void> {
    await gitPrim.mergeFfOnly(userRepoDir, branch);
    this.logger.workspace(`Local merge landed (${branch} fast-forwarded in user repo)`);
  }

  async headCommit(cwd: string): Promise<string | null> {
    return gitPrim.head(cwd);
  }

  async countAhead(cwd: string, defaultBranch: string): Promise<number> {
    return gitPrim.countAhead(cwd, defaultBranch);
  }

  /** conv 分支 unified diff（#704 非 hosted 形态投影上报数据源）：
   * `git diff origin/<default>...HEAD`——merge-base 到工作头的变更，与 server
   * readBuildChanges 的 `${baseSha}...${headSha}` 同语义。 */
  async diffAgainstDefault(cwd: string, defaultBranch: string): Promise<string> {
    return gitPrim.diffAgainstRemoteDefault(cwd, defaultBranch);
  }

  async restoreCheckpoint(cwd: string, commit: string): Promise<void> {
    await gitPrim.resetHard(cwd, commit);
    await gitPrim.cleanFd(cwd);
    this.logger.workspace('Worktree restored');
  }

  /** 孤儿回收（r3 §1.4 cleanupOrphanWorktrees(ttlMs = 7*24h)）：conv 形状
   * 目录、非活步（journal pending 面）、龄超 TTL → 陈旧清理三步。龄 =
   * 目录 mtime 与最后提交时刻取新 [设计]（未采观测值）。 */
  async cleanupOrphans(input: OrphanCleanupInput): Promise<string[]> {
    const ttlMs = input.ttlMs > 0 ? input.ttlMs : this.orphanTtlMs;
    const active = new Set(input.activeConversationIds);
    const removed: string[] = [];
    let entries: string[] = [];
    try {
      entries = readdirSync(input.workspacesRoot);
    } catch {
      return removed; // 根目录不存在 = 无孤儿
    }
    for (const name of entries) {
      if (!CONV_DIR_PATTERN.test(name) || active.has(name)) continue;
      const dir = join(input.workspacesRoot, name);
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

  /** 单工作区陈旧清理（remove --force + prune + branch -D，02 §5.5）。 */
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
    // 基座已失联：目录直删（无 worktree 元数据可清）。
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

function isBareish(dir: string): boolean {
  return existsSync(join(dir, 'HEAD'));
}

/** `Cloning <teamId>/<repoName>` 标签（r3 §1.5 行形；托管 = /git/ 后两段，
 * github = owner/repo）。 */
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
