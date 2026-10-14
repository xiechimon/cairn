// daemon 侧 git 原语（GitOps 缝的 daemon 半，01 §4.3「与 server 共缝，shared
// 定义 daemon 实现」；词表 = 02 §5.5 worktree 契约全表，r3 §1.4 实测）。
// 缝纪律（01 §7.3）：本模块 = daemon 内唯一 git spawn 点（workspace.ts 经本
// 模块消费；isomorphic-git/simple-git 不引入，01 §4.2）。
// 注入安全：全程 argv 数组（无 shell）。
// 凭证纪律（02 §5.4/§8 per-step 下发不落盘 + relay 工具名对照 push_credential
// r5 §3.1）：git 凭证只经 GIT_CONFIG_* env 注入 credential.helper（git ≥2.31）
// ——不进 argv（ps 面）、不进 .git/config、不进 ~/.git-credentials、不落任何盘。

import { spawn } from 'node:child_process';
import type { CommitIdentity, GitCredentialSource, GitCredentials } from '@pacman/shared';

export interface GitRunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export function runGit(
  args: string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number } = {},
): Promise<GitRunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env },
      windowsHide: true,
      ...(opts.timeoutMs !== undefined ? { timeout: opts.timeoutMs } : {}),
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on('data', (c: Buffer) => stdout.push(c));
    child.stderr.on('data', (c: Buffer) => stderr.push(c));
    child.on('error', reject);
    child.on('close', (code) =>
      resolve({
        code: code ?? 0,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      }),
    );
  });
}

/** 非零退 = 抛错（stderr 上浮；调用方按语义捕获）。 */
export async function runGitOk(
  args: string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number } = {},
): Promise<string> {
  const r = await runGit(args, opts);
  if (r.code !== 0) {
    throw new Error(`git ${args[0]} failed (${r.code}): ${r.stderr.trim() || r.stdout.trim()}`);
  }
  return r.stdout.trim();
}

/** per-step git 凭证 → env 注入（内存态；见头注凭证纪律）。密码含 shell 元
 * 字符亦安全（credential.helper 值不经 shell——git 直接以 `sh -c` 执行 fn
 * 体，echo 单引号位转义 `'` → `'\''`）。 */
export function gitCredentialEnv(cred: GitCredentials): NodeJS.ProcessEnv {
  const sq = (v: string) => v.replace(/'/g, `'\\''`);
  const helper = `!f() { echo username=${sq(cred.username)}; echo password=${sq(cred.password)}; }; f`;
  return {
    // 首条空值重置 credential.helper 列表（git 语义：空值清空此前累积的全部
    // helper）。缺此条则系统级/全局 osxkeychain 等 helper 叠加在前：同主机
    // 命中陈旧凭证（上一步已撤销的 token）致 auth 失败，且成功轮会回写钥匙串
    // （凭证落盘面，破 02 §8 不落盘纪律）。重置后本步内联 helper 是唯一来源。
    GIT_CONFIG_COUNT: '2',
    GIT_CONFIG_KEY_0: 'credential.helper',
    GIT_CONFIG_VALUE_0: '',
    GIT_CONFIG_KEY_1: 'credential.helper',
    GIT_CONFIG_VALUE_1: helper,
    // 交互提示关闭（无 tty 场景挂起护栏）。
    GIT_TERMINAL_PROMPT: '0',
  };
}

/** #1225 machine 路的 git env：执行机自己的 credential helper（osxkeychain /
 * store / gh）原样生效——**不**带 credential.helper 空值重置（那是 integration
 * 路的独有语义，见 gitCredentialEnv 注），也不碰代理变量（mea 的
 * HTTP_PROXY / NO_PROXY 语义只经进程环境传递，runGit 合并 process.env 原样
 * 透传）。只补 TTY 守卫：无凭据时 git 快速失败而不是挂等不存在的终端。
 * Multica 先例（repocache gitEnv）：完整环境 + GIT_TERMINAL_PROMPT=0，服务端
 * 零分发 git 凭据。 */
export function machineGitEnv(): NodeJS.ProcessEnv {
  return { GIT_TERMINAL_PROMPT: '0' };
}

/** git 失败文本 → 认证失败判定（#1225 降级触发器）。命中族：GitHub 无效
 * token（Invalid username or token / Authentication failed）、无凭据
 * （could not read Username / terminal prompts disabled）、http 401 族。故意
 * 不收 403/404（认证已过、权限/存在性面——降级重试同样救不了它们，还把
 * 确定性失败变成双倍流量）。 */
export function isGitAuthFailure(message: string): boolean {
  return (
    /authentication failed/i.test(message) ||
    /invalid username or token/i.test(message) ||
    /could not read username/i.test(message) ||
    /terminal prompts disabled/i.test(message) ||
    /http basic: access denied/i.test(message) ||
    /http 401\b/i.test(message) ||
    /returned error: 401\b/.test(message)
  );
}

/** 降级事件载荷（#1225 失败方式 2：只回传 git 原文——凭据对象/token 值
 * 永不进事件面，日志与 build 记录按此形状消费）。 */
export type GitFallbackReason = string;

export interface GitCredentialFallbackOpts {
  /** 操作名（错误文案点名用，如 'push' / 'clone' / 'fetch'）。 */
  what: string;
  /** machine 兜底闸：github 形态才开。hosted 走 server per-step key 恒关
   * （票失败方式 3），local 无凭据面恒关。 */
  allowMachineFallback: boolean;
  /** auth 失败降级事件（原文回传；调用方落日志/transcript，禁携带凭据值）。 */
  onFallback?: (reason: GitFallbackReason) => void;
}

/** #1225 凭据序执行器：① per-step integration token 先行（集成有效时行为
 * 不变——单次执行即返回 'integration'）；② auth 失败（isGitAuthFailure）且
 * 闸开 → 以 null cred（machine 路，machineGitEnv）二发，成功返回 'machine'；
 * ③ 两路都 auth 失败 → 合并错误点名两路（票失败方式 1：明确报错，不静默
 * 匿名撞 401）。非 auth 失败（网络/5xx/冲突）原错误直抛——降级只在凭据
 * 语义成立时发生。cred 为 null（server 未下发，如未连 GitHub）= machine 路
 * 单次执行，无降级事件。 */
export async function withGitCredentialFallback(
  op: (cred: GitCredentials | null) => Promise<void>,
  cred: GitCredentials | null,
  opts: GitCredentialFallbackOpts,
): Promise<GitCredentialSource> {
  if (cred === null) {
    await op(null);
    return 'machine';
  }
  try {
    await op(cred);
    return 'integration';
  } catch (err) {
    const first = err instanceof Error ? err.message : String(err);
    if (!opts.allowMachineFallback || !isGitAuthFailure(first)) throw err;
    opts.onFallback?.(first);
    try {
      await op(null);
      return 'machine';
    } catch (err2) {
      const second = err2 instanceof Error ? err2.message : String(err2);
      throw new Error(
        `git ${opts.what} authentication failed on both credential paths — ` +
          `per-step token: ${first}; machine credentials: ${second}`,
      );
    }
  }
}

export function commitEnv(identity: CommitIdentity): NodeJS.ProcessEnv {
  return {
    GIT_AUTHOR_NAME: identity.name,
    GIT_AUTHOR_EMAIL: identity.email,
    GIT_COMMITTER_NAME: identity.name,
    GIT_COMMITTER_EMAIL: identity.email,
  };
}

const META_TIMEOUT_MS = 30_000;
/** 网络面预算（02 §5.5 重试预算行：push 覆盖 git-host 5xx 窗口；冷 worktree
 * ls-remote+fetch「~2 min typical, ~8 min worst on /done's path」r3 原文）。 */
const NET_TIMEOUT_MS = 480_000;

/** #1195 分支扫描预算：tip 时刻边距（提交时刻秒粒度截断 + 同源时钟微漂）
 * 与 rev-list 调用上限（基座仓分支巨多时收尾不被扫描烧穿）。 */
const BRANCH_SCAN_SKEW_MS = 2_000;
const BRANCH_SCAN_MAX_REVS = 20;

// —— 原语面（workspace.ts 组装 02 §5.5 契约行为）——————————————————————————

export const gitPrim = {
  async clone(url: string, dir: string, cred: GitCredentials | null): Promise<void> {
    await runGitOk(['clone', '--end-of-options', url, dir], {
      env: cred ? gitCredentialEnv(cred) : machineGitEnv(),
      timeoutMs: NET_TIMEOUT_MS,
    });
  },

  async fetch(repoDir: string, cred: GitCredentials | null): Promise<void> {
    await runGitOk(['fetch', '--prune', 'origin'], {
      cwd: repoDir,
      env: cred ? gitCredentialEnv(cred) : machineGitEnv(),
      timeoutMs: NET_TIMEOUT_MS,
    });
  },

  /** 默认分支（origin/HEAD symbolic-ref；缺省回退 main——r3 §3.6 origin/main
   * 正典值 [推断回退]）。 */
  async remoteDefaultBranch(repoDir: string): Promise<string> {
    const r = await runGit(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], {
      cwd: repoDir,
      timeoutMs: META_TIMEOUT_MS,
    });
    if (r.code === 0) {
      const name = r.stdout.trim().replace(/^origin\//, '');
      if (name !== '') return name;
    }
    return 'main';
  },

  async hasRemoteBranch(repoDir: string, branch: string): Promise<boolean> {
    const r = await runGit(['rev-parse', '--verify', `refs/remotes/origin/${branch}`], {
      cwd: repoDir,
      timeoutMs: META_TIMEOUT_MS,
    });
    return r.code === 0;
  },

  /** origin remote URL（#1213/ADR 0017 选源对账用）；无 origin / git 失败 =
   * null（调用方按失格回落处理，不抛）。只读 config，不触网络。 */
  async remoteUrl(dir: string): Promise<string | null> {
    const r = await runGit(['remote', 'get-url', 'origin'], {
      cwd: dir,
      timeoutMs: META_TIMEOUT_MS,
    });
    if (r.code !== 0) return null;
    const url = r.stdout.trim();
    return url === '' ? null : url;
  },

  /** git 仓判定（`rev-parse --git-dir` code 0；工作树仓与裸库同形——#1210
   * 执行面 fail-loud 预检只问「能否作为 clone 源」，worktree-only 的收紧
   * 属 server 创建闸 validateLocalRepoPath，不在执行面重判）。 */
  async isGitDir(dir: string): Promise<boolean> {
    const r = await runGit(['rev-parse', '--git-dir'], {
      cwd: dir,
      timeoutMs: META_TIMEOUT_MS,
    });
    return r.code === 0;
  },

  /** origin remote URL 重指（#1213/ADR 0017：本地源 clone 后把 origin 指回
   * GitHub 真值，后续 fetch/push 照常走真值远端）。 */
  async setRemoteUrl(repoDir: string, url: string): Promise<void> {
    await runGitOk(['remote', 'set-url', 'origin', '--', url], {
      cwd: repoDir,
      timeoutMs: META_TIMEOUT_MS,
    });
  },

  /** `git remote set-head origin -a`（#1213/ADR 0017）：向真值远端查询其 HEAD
   * 并重钉 origin/HEAD——clone 自本地源的 origin/HEAD 是**用户检出分支**，
   * 默认分支判定会漂；本原语把 defaultBranch 真值源拉回远端。 */
  async remoteSetHeadAuto(repoDir: string, cred: GitCredentials | null): Promise<void> {
    await runGitOk(['remote', 'set-head', 'origin', '--auto'], {
      cwd: repoDir,
      env: cred ? gitCredentialEnv(cred) : machineGitEnv(),
      timeoutMs: NET_TIMEOUT_MS,
    });
  },

  async hasLocalBranch(repoDir: string, branch: string): Promise<boolean> {
    const r = await runGit(['rev-parse', '--verify', `refs/heads/${branch}`], {
      cwd: repoDir,
      timeoutMs: META_TIMEOUT_MS,
    });
    return r.code === 0;
  },

  /** 远端领先本地的提交数（防分叉护栏数据面，02 §5.5）。 */
  async countRemoteAhead(repoDir: string, branch: string): Promise<number> {
    const local = await gitPrim.hasLocalBranch(repoDir, branch);
    const range = local ? `refs/heads/${branch}..refs/remotes/origin/${branch}` : '';
    const args = local
      ? ['rev-list', '--count', range]
      : ['rev-list', '--count', `refs/remotes/origin/${branch}`];
    const r = await runGit(args, { cwd: repoDir, timeoutMs: META_TIMEOUT_MS });
    if (r.code !== 0) return 0;
    const n = Number.parseInt(r.stdout.trim(), 10);
    return Number.isNaN(n) ? 0 : n;
  },

  async worktreeAdd(
    repoDir: string,
    branch: string,
    dir: string,
    base: string | null,
  ): Promise<void> {
    // base null = 挂既有本地分支（陈旧清理后的重建路径）。
    const args =
      base !== null
        ? ['worktree', 'add', '-b', branch, dir, base]
        : ['worktree', 'add', dir, branch];
    await runGitOk(args, { cwd: repoDir, timeoutMs: META_TIMEOUT_MS });
  },

  async worktreeRemoveForce(repoDir: string, dir: string): Promise<void> {
    await runGitOk(['worktree', 'remove', '--force', dir], {
      cwd: repoDir,
      timeoutMs: META_TIMEOUT_MS,
    });
  },

  async worktreePrune(repoDir: string): Promise<void> {
    await runGitOk(['worktree', 'prune'], { cwd: repoDir, timeoutMs: META_TIMEOUT_MS });
  },

  async branchDelete(repoDir: string, branch: string): Promise<void> {
    await runGitOk(['branch', '-D', branch], { cwd: repoDir, timeoutMs: META_TIMEOUT_MS });
  },

  async currentBranch(dir: string): Promise<string | null> {
    const r = await runGit(['branch', '--show-current'], { cwd: dir, timeoutMs: META_TIMEOUT_MS });
    return r.code === 0 && r.stdout.trim() !== '' ? r.stdout.trim() : null;
  },

  /** checkpoint 恢复（02 §5.5：`reset --hard`）。git 2.43 的 reset 开了
   * PARSE_OPT_KEEP_DASHDASH，`--end-of-options` 留在 argv 里，verify_filename
   * 见到 `-` 开头就退出 128（#1316）。rev-parse 认这个旗标，先把 commit 解成
   * 对象 id，再 `reset --hard <oid>`。oid 只有十六进制，不会被 reset 当成选项。 */
  async resetHard(dir: string, commit: string): Promise<void> {
    const oid = await runGitOk(
      ['rev-parse', '--verify', '--end-of-options', `${commit}^{commit}`],
      { cwd: dir, timeoutMs: META_TIMEOUT_MS },
    );
    if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(oid)) {
      throw new Error(`git reset failed: resolved revision is not an object id (${oid})`);
    }
    await runGitOk(['reset', '--hard', oid], { cwd: dir, timeoutMs: META_TIMEOUT_MS });
  },

  async cleanFd(dir: string): Promise<void> {
    await runGitOk(['clean', '-fd'], { cwd: dir, timeoutMs: META_TIMEOUT_MS });
  },

  async addAll(dir: string): Promise<void> {
    await runGitOk(['add', '-A'], { cwd: dir, timeoutMs: META_TIMEOUT_MS });
  },

  /** 暂存区里含指定**固定串**的文件，只在这些路径里找（#958 闸 5 的认标记扫描）。
   * 限定路径集是有意的：全仓 grep 会拖慢每次提交，而候选名只有五个。无命中 =
   * 空数组（`git grep` 的退出码 1 是「没匹配」，不是错）。 */
  async stagedPathsContaining(
    dir: string,
    needle: string,
    paths: readonly string[],
  ): Promise<string[]> {
    if (paths.length === 0) return [];
    const r = await runGit(['grep', '--cached', '-l', '-F', '-e', needle, '--', ...paths], {
      cwd: dir,
      timeoutMs: META_TIMEOUT_MS,
    });
    if (r.code !== 0) return [];
    return r.stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '');
  },

  /** 把某个路径移出暂存区（#958 闸 5：认标记剔除时用）。`reset --` 会把索引项
   * 还原到 HEAD——跟踪文件 = 本轮对它的改动不随本次提交走（既定取舍，见
   * docs/spec/24 闸 4）；未跟踪文件 = 从索引里摘掉。 */
  async unstagePath(dir: string, path: string): Promise<void> {
    await runGitOk(['reset', '-q', '--', path], { cwd: dir, timeoutMs: META_TIMEOUT_MS });
  },

  /** ref 里含指定**固定串**的文件，只在这些路径里找（#958 闸 4 的推送后检测）。
   * 与 `stagedPathsContaining` 同一套限定理由：候选名只有五个，全仓 grep 不值。
   * 输出形为 `<ref>:<path>`，此处剥掉 ref 前缀。无命中 = 空数组（`git grep`
   * 的退出码 1 是「没匹配」，不是错）。 */
  async pathsContainingInRef(
    dir: string,
    ref: string,
    needle: string,
    paths: readonly string[],
  ): Promise<string[]> {
    if (paths.length === 0) return [];
    const r = await runGit(['grep', '-l', '-F', '-e', needle, ref, '--', ...paths], {
      cwd: dir,
      timeoutMs: META_TIMEOUT_MS,
    });
    if (r.code !== 0) return [];
    return r.stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '')
      .map((line) => {
        const sep = line.indexOf(':');
        return sep === -1 ? line : line.slice(sep + 1);
      });
  },

  /** commit；干净树（nothing to commit）= false 不抛。 */
  async commit(dir: string, message: string, identity: CommitIdentity): Promise<boolean> {
    const r = await runGit(['commit', '-m', message], {
      cwd: dir,
      env: commitEnv(identity),
      timeoutMs: META_TIMEOUT_MS,
    });
    if (r.code === 0) return true;
    if (/nothing to commit/i.test(r.stdout) || /nothing to commit/i.test(r.stderr)) return false;
    throw new Error(`git commit failed (${r.code}): ${r.stderr.trim() || r.stdout.trim()}`);
  },

  async head(dir: string): Promise<string | null> {
    const r = await runGit(['rev-parse', '--verify', 'HEAD'], {
      cwd: dir,
      timeoutMs: META_TIMEOUT_MS,
    });
    if (r.code !== 0) return null;
    const sha = r.stdout.trim();
    return /^[0-9a-f]{40,64}$/.test(sha) ? sha : null;
  },

  async push(dir: string, branch: string, cred: GitCredentials | null): Promise<void> {
    await runGitOk(['push', '--end-of-options', 'origin', `refs/heads/${branch}`], {
      cwd: dir,
      env: cred ? gitCredentialEnv(cred) : machineGitEnv(),
      timeoutMs: NET_TIMEOUT_MS,
    });
  },

  /** annotated tag 创建（XMON-111 T1）：`git tag -a -m <msg> <tag> [commit]`；
   * commit null = HEAD。tag 已存在 / 名字非法 = git 自拒 → 抛错携带拒绝原文
   * （create_tag 工具原样返回 agent）。--end-of-options 挡 tag 名 `-` 开头
   * 的选项注入面（push/reset 同律）。身份必传（同 commit 原语）：annotated
   * tag 的 tagger ident 没有 git 兜底——无全局 user.name/user.email 的机器
   * 上 `git tag -a` 直接挂 128（empty ident name）。 */
  async tagCreate(
    dir: string,
    tag: string,
    message: string,
    commit: string | null,
    identity: CommitIdentity,
  ): Promise<void> {
    await runGitOk(
      ['tag', '-a', '-m', message, '--end-of-options', tag, ...(commit ? [commit] : [])],
      { cwd: dir, env: commitEnv(identity), timeoutMs: META_TIMEOUT_MS },
    );
  },

  /** `git push origin refs/tags/<tag>`（XMON-111 T1）：凭证注入同 push 原语
   * （per-step token 只经 env credential.helper，不进 argv/磁盘）。远端已有
   * 同名异值 tag = git 拒绝（永不 force）→ 抛错携带拒绝原文。 */
  async tagPush(dir: string, tag: string, cred: GitCredentials | null): Promise<void> {
    await runGitOk(['push', '--end-of-options', 'origin', `refs/tags/${tag}`], {
      cwd: dir,
      env: cred ? gitCredentialEnv(cred) : machineGitEnv(),
      timeoutMs: NET_TIMEOUT_MS,
    });
  },

  /** `git merge --no-edit origin/<defaultBranch>`（02 §5.5/r3 §3.6）；冲突 =
   * 自动 `merge --abort` 后抛错（失败仅人工重跑，02/A6）。 */
  async mergeNoEdit(dir: string, ref: string): Promise<string> {
    const r = await runGit(['merge', '--no-edit', '--end-of-options', ref], {
      cwd: dir,
      timeoutMs: META_TIMEOUT_MS,
    });
    if (r.code === 0) return r.stdout.trim();
    if (/conflict/i.test(r.stdout + r.stderr)) {
      await runGit(['merge', '--abort'], { cwd: dir, timeoutMs: META_TIMEOUT_MS });
      throw new Error(`merge conflict against ${ref} (aborted; manual rerun required)`);
    }
    throw new Error(`git merge failed (${r.code}): ${r.stderr.trim() || r.stdout.trim()}`);
  },

  /** conv 分支领先 origin/<default> 的提交数（hasChanges 判定面）。 */
  async countAhead(dir: string, defaultBranch: string): Promise<number> {
    const r = await runGit(['rev-list', '--count', `refs/remotes/origin/${defaultBranch}..HEAD`], {
      cwd: dir,
      timeoutMs: META_TIMEOUT_MS,
    });
    if (r.code !== 0) return 0;
    const n = Number.parseInt(r.stdout.trim(), 10);
    return Number.isNaN(n) ? 0 : n;
  },

  /** 步窗口内有新提交的本地分支短名集（#1195 产物并集面：agent 自建分支
   * 交付后 HEAD 切回会话分支时，收尾按 HEAD 计数恒 0——本原语把「base 之
   * 外、tip 落在窗口内」的分支捞回来）。for-each-ref 按 tip 提交时刻降序，
   * 出窗即断（其后全更早）；rev-list 调用数有上限（基座仓分支巨多时不烧
   * 收尾预算）。提交时刻是秒粒度、与步起点墙钟同源同机——留 2s 边距吸收
   * 秒内截断。base 不可解析 = rev-list 恒非零退 = 空集（fail-open，探测
   * 是收尾附加面不阻断）。归属裁决（邻座 conv 分支排除）在调用方。 */
  async branchesWithNewCommits(
    dir: string,
    baseCommit: string,
    sinceMs: number,
  ): Promise<string[]> {
    const r = await runGit(
      [
        'for-each-ref',
        'refs/heads',
        '--sort=-committerdate',
        '--format=%(refname:short)\t%(committerdate:unix)\t%(objectname)',
      ],
      { cwd: dir, timeoutMs: META_TIMEOUT_MS },
    );
    if (r.code !== 0) return [];
    const found: string[] = [];
    let revCalls = 0;
    for (const line of r.stdout.split('\n')) {
      if (revCalls >= BRANCH_SCAN_MAX_REVS) break;
      const [name, unix, sha] = line.split('\t');
      if (name === undefined || unix === undefined || sha === undefined) continue;
      const tipMs = Number.parseInt(unix, 10) * 1_000;
      if (Number.isNaN(tipMs)) continue;
      if (tipMs < sinceMs - BRANCH_SCAN_SKEW_MS) break; // 降序：其后全出窗
      revCalls++;
      const c = await runGit(['rev-list', '--count', `${baseCommit}..${sha}`], {
        cwd: dir,
        timeoutMs: META_TIMEOUT_MS,
      });
      if (c.code !== 0) continue;
      const n = Number.parseInt(c.stdout.trim(), 10);
      if (!Number.isNaN(n) && n > 0) found.push(name);
    }
    return found;
  },

  /** conv 分支相对 origin/<default> 的 unified diff 原文（#704 非 hosted 形态
   * 投影上报数据源；三-dot = merge-base 起算，server readBuildChanges 同语义）。
   * 基座引用缺位（空仓/未 fetch）= 空串——投影按上报零改动处理，不抛错
   * （探测是收尾附加面，不阻断步收尾）。 */
  async diffAgainstRemoteDefault(dir: string, defaultBranch: string): Promise<string> {
    const r = await runGit(['diff', `origin/${defaultBranch}...HEAD`], {
      cwd: dir,
      timeoutMs: META_TIMEOUT_MS,
    });
    if (r.code !== 0) return '';
    return r.stdout;
  },

  /** 提交时刻（epoch ms；孤儿回收龄判定用 [设计]）。 */
  async commitTime(dir: string, commit: string): Promise<number | null> {
    const r = await runGit(['log', '-1', '--format=%ct', '--end-of-options', commit], {
      cwd: dir,
      timeoutMs: META_TIMEOUT_MS,
    });
    if (r.code !== 0) return null;
    const secs = Number.parseInt(r.stdout.trim(), 10);
    return Number.isNaN(secs) ? null : secs * 1000;
  },

  async commonGitDir(dir: string): Promise<string | null> {
    const r = await runGit(['rev-parse', '--path-format=absolute', '--git-common-dir'], {
      cwd: dir,
      timeoutMs: META_TIMEOUT_MS,
    });
    return r.code === 0 && r.stdout.trim() !== '' ? r.stdout.trim() : null;
  },
};

/** 网络重试预算 [设计]（02 §5.5「push 重试覆盖 git-host 5xx 窗口」的最小
 * 等价物：两档退避；冷 worktree 长预算由 NET_TIMEOUT_MS 兜）。auth 失败是
 * 确定性失败（#1225：401 重试不翻红），直接抛——不烧退避预算，也让凭据
 * 降级序（withGitCredentialFallback）立刻接手。 */
export const GIT_NET_RETRY_DELAYS_MS = [1_000, 5_000] as const;

export async function withGitNetRetries<T>(fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i <= GIT_NET_RETRY_DELAYS_MS.length; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (isGitAuthFailure(err instanceof Error ? err.message : String(err))) break;
      // 退避下标 = 已失败次数（i=0 失败 → DELAYS[0]）：旧实现取 DELAYS[i-1]，
      // 首次失败即 undefined → break——重试预算从未生效（死代码）。#1225 修正。
      const delay = GIT_NET_RETRY_DELAYS_MS[i];
      if (delay === undefined) break;
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
