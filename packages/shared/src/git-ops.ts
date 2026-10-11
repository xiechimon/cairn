// GitOps 缝（01 §3 五缝之一）——server 托管面词表：02 §3/A4（本地 bare repo +
// `git http-backend` CGI + 读树/单文件）。实现 = apps/server（spawn 系统 git，
// 01 §4.2「isomorphic-git/simple-git 不引入」）；daemon 侧 worktree 词表
// （02 §5.5 全表）随 M3 并入本缝。缝纪律（01 §7.3）：实现模块之外不得直接
// spawn/import git 包装依赖。
// 字节面用 Uint8Array（shared 零 node 依赖）。

import type { WorkspaceHookNoteData } from './protocol/executor.js';

/** `ls-tree` 行投影（tree?ref= 端点源，02 §3 文件浏览面）。 */
export interface GitTreeEntry {
  name: string;
  /** 仓库根相对路径。 */
  path: string;
  type: 'blob' | 'tree';
  /** blob 字节数；tree 为 null（ls-tree -l 对目录出 `-`）。 */
  size: number | null;
}

/** 单文件读取结果（file?path=&ref= 端点源）。 */
export interface GitFileAtRef {
  size: number;
  content: Uint8Array;
}

export interface GitRefInfo {
  /** 短名（refs/heads/ 去前缀）。 */
  name: string;
  /** 默认分支位（bare HEAD symbolic-ref）。 */
  isDefault: boolean;
}

/** `git http-backend` CGI 调用形状（env + stdio 管道，01 §4.2）。 */
export interface GitCgiRequest {
  /** GIT_PROJECT_ROOT（bare repo 的父目录）。 */
  projectRoot: string;
  /** PATH_INFO（`/<repoName>.git/<rest>`）。 */
  pathInfo: string;
  queryString: string;
  method: 'GET' | 'POST';
  contentType?: string;
  /** 已认证远端用户（http-backend 据此放开 receive-pack）；匿名不设。 */
  remoteUser?: string;
  /** 请求体（POST upload-pack/receive-pack 载荷），原样进 stdin。 */
  body: Uint8Array;
}

export interface GitCgiResponse {
  status: number;
  headers: [string, string][];
  /** 响应体原样字节（git 协议 pkt-line 为二进制，不做文本化）。 */
  body: Uint8Array;
}

export interface GitOps {
  /** init 本地 bare repo（托管形态落地，02 §3；HEAD 指默认分支——main 正典
   * 值（r3 §3.6 `origin/main`），实现在 server 侧）。 */
  initBareRepo(dir: string): Promise<void>;
  /** 空库种子提交（M3b [设计]：托管 repo provision 即立 `refs/heads/main`
   * 首提交——空库无 ref 不能 worktree add（02 §5.5 base=origin/<default>），
   * 且 merge 步 fast-forward 需要 main 在位。空树提交，无文件内容）。 */
  seedInitialCommit(dir: string, message: string): Promise<string>;
  /** ref → commit sha 解析（`rev-parse --verify`）；解析失败 null。 */
  resolveCommit(dir: string, ref: string): Promise<string | null>;
  /** git 工作树仓判定（`rev-parse --is-inside-work-tree`）——spec 12 local
   * 项目路径校验缝（server 端 `POST /api/projects` kind=local 的 400 闸）。
   * 目录缺位 / 非仓 / bare 仓（无工作树）= false，不抛。 */
  isGitRepo(dir: string): Promise<boolean>;
  /** 读树（`ls-tree -l`）；subPath 空 = 仓库根。 */
  lsTree(dir: string, commit: string, subPath?: string): Promise<GitTreeEntry[]>;
  /** 读单文件（`cat-file blob`）；缺失 null。 */
  readFileAt(dir: string, commit: string, path: string): Promise<GitFileAtRef | null>;
  /** 分支面（`for-each-ref refs/heads` + HEAD symbolic-ref）。 */
  listBranches(dir: string): Promise<{ defaultBranch: string | null; branches: GitRefInfo[] }>;
  /** 祖先判定（`merge-base --is-ancestor`）——merge 步 fast-forward 护栏
   * （M3b [设计]：main 现 tip 必须是合并步 commit 的祖先才允许推进）。 */
  isAncestor(dir: string, ancestor: string, commit: string): Promise<boolean>;
  /** 分支 ref 直推（`update-ref refs/heads/<branch> <commit>`）——server 侧
   * merge 步落地：bare repo main fast-forward（M3b [设计]，02 §4.2 merge
   * 202 delegated 的 server 半）。 */
  updateBranchRef(dir: string, branch: string, commit: string): Promise<void>;
  /** `git http-backend` CGI 一次调用（spawn + env + stdin/stdout 管道）。 */
  httpBackend(req: GitCgiRequest): Promise<GitCgiResponse>;
}

// —— daemon 侧 worktree 词表（02 §5.5 全表，r3 §1.4 实测；01 §4.3「与 server
// 共缝，shared 定义 daemon 实现」）。缝纪律同 GitOps：daemon 内实现模块之外
// 不得直接 spawn git。———————————————————————————————————————————————

/** per-step git 凭证（02 §5.4/§8：token/{stepId} 下发，daemon 内存持有，
 * 不落盘常驻；注入形 = GIT_CONFIG_* env credential.helper [设计]——不进
 * argv、不进 .git/config、不进 ~/.git-credentials）。 */
export interface GitCredentials {
  username: string;
  password: string;
}

/** GitHub 执行凭证用户名（spec 12 G2-T2）：OAuth token 经 basic auth 消费时
 * 用户名固定 `x-access-token`（GitHub 约定）；server stepToken 组装
 * GitCredentials 与 daemon 消费两侧同吃本单源。 */
export const GITHUB_ACCESS_TOKEN_USERNAME = 'x-access-token';

/** 提交身份 [设计]（r3 未采 committer 词表；daemon 侧步提交用）。 */
export interface CommitIdentity {
  name: string;
  email: string;
}

export interface WorktreePrepareInput {
  /** 基座 clone 位 `<workspacesRoot>/<projectId>/repo`（02 §5.5）。 */
  projectId: string;
  /** 任务目录位 `<workspacesRoot>/<conversationId>`；分支 `conv-` 后缀同值。 */
  conversationId: string;
  cloneUrl: string;
  workspacesRoot: string;
  /** per-step 凭证（托管 http 远端必需；GitHub 形态凭证面归后票）。 */
  credentials: GitCredentials | null;
}

export interface PreparedWorkspace {
  /** 任务 worktree 目录（pi 会话 cwd，02 §5.5）。 */
  cwd: string;
  /** 基座 clone 目录（worktree add/prune 的操作位）。 */
  baseRepoDir: string;
  /** `pacman/conv-<conversationId>`（brand.ts conversationBranch()）。 */
  branch: string;
  defaultBranch: string;
  /** `Worktree reused` 行语义（r3 §1.4）。 */
  reused: boolean;
  /** #1149 环境钩子注记：本次 prepare 实际跑过的钩子（跑过才记；缺失/跳过
   * = 缺省 []——「无钩子的仓行为与现状一致」面）。setup 失败不落此槽
   * （prepare 抛错，步失败）；resume 失败也不落（warning 行已落日志）。
   * runner 把 ok/timeout note 投影成 transcript system 行。 */
  hooks?: WorkspaceHookNoteData[];
}

/** 孤儿回收输入（r3 §1.4 `cleanupOrphanWorktrees(ttlMs = 7*24h)`）。 */
export interface OrphanCleanupInput {
  workspacesRoot: string;
  /** ORPHAN_WORKTREE_TTL_MS（7×24h，02 §5.5）。 */
  ttlMs: number;
  now: number;
  /** 在跑步的 conversationId 集（journal pending 面）——活步工作区不回收。 */
  activeConversationIds: Iterable<string>;
}

export interface WorktreeOps {
  /** clone/fetch 基座 + worktree add/reuse（02 §5.5 行 1–3；`Worktree reused`
   * /diverged 护栏/陈旧清理语义在实现内，日志行由调用方宿主给）。 */
  prepare(input: WorktreePrepareInput): Promise<PreparedWorkspace>;
  /** 每步收尾：`add -A` + commit（干净树 = null）；返回 HEAD sha。 */
  commitAll(
    cwd: string,
    message: string,
    identity: CommitIdentity,
  ): Promise<{ committed: boolean; head: string | null }>;
  /** push 本 conversation 工作分支（02 §5.5「每步结束自动 push」；凭证 env
   * 注入）。成功 = `pushed <convBranch>` 日志行由调用方落。 */
  push(cwd: string, branch: string, credentials: GitCredentials | null): Promise<void>;
  /** 合并步：`git merge --no-edit origin/<defaultBranch>`（02 §5.5/r3 §3.6
   * 「git merge origin/main 结果为 "Already up to date"」样本）；冲突 =
   * merge 自动中止并抛错（失败仅人工重跑，02/A6）。 */
  mergeDefaultBranch(cwd: string, defaultBranch: string): Promise<{ output: string }>;
  /** local 形态合并落地（spec 12 G2-T2；server applyMergeLanding 保持
   * hosted-only，本地落地面在 daemon 侧）：merge 步 conv 分支 push 回用户仓库
   * 后，在用户仓库目录 `git merge --ff-only <branch>` 推进其当前分支。
   * 脏工作区 / 非 ff → git 自拒 → 抛错（消息含 git 拒绝原文）；永不 force、
   * 永不绕开 git 自身护栏动用户工作树。 */
  landLocalFastForward(userRepoDir: string, branch: string): Promise<void>;
  /** HEAD sha（done 回传 commit 字段 = checkpoint 数据源，02 §4.2「恢复到
   * 此处」的后端）。 */
  headCommit(cwd: string): Promise<string | null>;
  /** conv 分支领先 origin/<defaultBranch> 的提交数（hasChanges 判定，
   * 02 §4.1/r5 §8 列位双键）。 */
  countAhead(cwd: string, defaultBranch: string): Promise<number>;
  /** conv 分支相对 origin/<defaultBranch> 的 unified diff 原文
   * （`git diff origin/<default>...HEAD`，#704 变更投影 daemon 上报数据源）。
   * 可选方法：非 hosted 形态投影走 daemon 步收尾上报，hosted 形态真值源
   * 仍是 server bare repo——实现缺位时 runner 跳过上报（投影回落空集），
   * 测试桩与旧实现零破坏。 */
  diffAgainstDefault?(cwd: string, defaultBranch: string): Promise<string>;
  /** checkpoint 恢复：`git reset --hard <commit>` + `git clean -fd`
   * （`Worktree restored`，r3 §1.4；「恢复到此处」r3 §3.5）。 */
  restoreCheckpoint(cwd: string, commit: string): Promise<void>;
  /** 陈旧 worktree 清理：`worktree remove --force` + `worktree prune` +
   * `branch -D`（r3 §1.4）；返回被回收的 conversationId 集。 */
  cleanupOrphans(input: OrphanCleanupInput): Promise<string[]>;
  /** ref 里含简报标记的候选文件（#958 闸 4 的推送后检测）。
   *
   * 检测而非预防：agent 在 bash 里自己 `git add && git commit` 时，标记块在
   * daemon 的任何闸生效之前就已经进了提交——提交闸（commitAll 的认标记剔除）
   * 只管得住 daemon 自己那一次提交。这一层只能事后点名，让「分支历史里带着我们
   * 的标记」可见。
   *
   * 可选实现：缺省 = 不检测（测试桩与旧实现零破坏）。 */
  briefMarkerInRef?(cwd: string, ref: string): Promise<string[]>;
}

/** 防分叉护栏错误词（02 §5.5/r3 §1.4：`REMOTE_BRANCH_DIVERGED = "remote
 * branch diverged"`——origin/<branch> 有本机没有的提交且 worktree 不在该
 * 分支时抛错）。 */
export const REMOTE_BRANCH_DIVERGED = 'remote branch diverged';

export class RemoteBranchDivergedError extends Error {
  constructor(branch: string) {
    super(`${REMOTE_BRANCH_DIVERGED}: ${branch}`);
    this.name = 'RemoteBranchDivergedError';
  }
}
