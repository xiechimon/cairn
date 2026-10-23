// repo 形态服务面（02 §3/A4 双形态 + spec 12 local 三形态）：
// - 托管 = server 本地 bare repo（`<reposDir>/<teamId>/<repoName>.git`），对
//   executor 呈现 http-backend 远端 URL（形状对应 r3 §1.4
//   `https://git.todos.dev/<teamId>/<repoName>`，域名段 = 本地主机名代位，
//   02 §5.8 gitHostDomain 槽；同源 `/git` 前缀为 [设计] 代位段）。
// - 接入 = GitHub（`owner/repo` 记录面；executor 直连远端 clone/push conv 分支，
//   PR/issues/CI 读面依赖 GitHub API，server 侧无本地存储）。
// - local = 用户本机既有 git 工作树仓（spec 12 / #359：server 端只做路径
//   规范化 + 三态校验（validateLocalRepoPath），镜像 clone 执行面归 daemon）。
// 文件浏览面（tree?ref=/file?path=&ref=，r3 §8.2）：读 repo 目录（hosted =
// 裸库、#1030 起 local = 用户工作树仓），无检出要求；响应形状 [推断]
// （端点存在实测、载荷未采，04 附录 A 补采后收紧）。

import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import {
  conversationBranch,
  type DiffFileContent,
  type DocumentDiffFile,
  type GithubRepoRef,
  gitHostedRepoPath,
  type ProjectBranchesResponse,
  type ProjectCommitDetailResponse,
  type ProjectCommitsResponse,
  type ProjectFileResponse,
  type ProjectFilesResponse,
  type ProjectRecord,
  type ProjectTreeResponse,
  parseGithubRepoRef,
} from '@cairn/shared';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { build as buildTable, project, todo as todoTable } from '../db/schema.js';
import { HttpError, notFound } from '../lib/errors.js';
import { isSafeRepoPath, lsFilesRecursive, runGit, systemGitOps } from '../lib/git.js';

export type ProjectRow = typeof project.$inferSelect;

/** 文件浏览面所需的最小上下文（AppContext 的结构子集；chief `docs` relay 与
 * REST tree/file/branches 共用——避免把整个 AppContext 拖进 relay 执行面）。 */
export interface RepoCtx {
  db: Db;
  reposDir: string;
}

/** 项目名 → repo 名 slug（[设计]：小写、路径安全字符集；r3 样本
 * `r3-lifecycle` 即原名同形）。 */
export function slugifyRepoName(name: string): string {
  const slug = name
    .toLowerCase()
    .replaceAll(/[^a-z0-9._-]+/g, '-')
    .replaceAll(/-{2,}/g, '-')
    .replaceAll(/^[-.]+|[-.]+$/g, '');
  return slug === '' ? 'repo' : slug;
}

/** 团队内 repoName 唯一化（冲突加 `-2`/`-3`…后缀 [设计]）。 */
export async function uniqueRepoName(ctx: RepoCtx, teamId: string, base: string): Promise<string> {
  const existing = new Set(
    ctx.db
      .select({ repoName: project.repoName })
      .from(project)
      .where(eq(project.teamId, teamId))
      .all()
      .map((r) => r.repoName)
      .filter((v): v is string => v !== null),
  );
  let candidate = base;
  for (let i = 2; existing.has(candidate); i++) {
    candidate = `${base}-${i}`;
  }
  return candidate;
}

/** bare repo 目录（托管形态唯一存储位；数据根 = 01 §4.2 单一数据根）。 */
export function repoDirFor(reposDir: string, teamId: string, repoName: string): string {
  return join(reposDir, teamId, `${repoName}.git`);
}

/** 托管形态落地：init 本地 bare repo（02 §3 锁定；HEAD 指默认分支）+ 种子
 * 提交立 main（M3b [设计]：空库无 ref 不能 worktree add——02 §5.5 base=
 * `origin/<defaultBranch>` 前提；merge 步 fast-forward 亦需 main 在位）。 */
export async function provisionHostedRepo(
  ctx: RepoCtx,
  teamId: string,
  repoName: string,
): Promise<string> {
  const dir = repoDirFor(ctx.reposDir, teamId, repoName);
  mkdirSync(join(ctx.reposDir, teamId), { recursive: true });
  await systemGitOps.initBareRepo(dir);
  await systemGitOps.seedInitialCommit(dir, `init ${repoName}`);
  return dir;
}

/** 托管形态拆除（#189 删项目随行）：删本地 bare repo 目录。force 幂等——
 * 目录缺位不阻断库面删除。repoName 复用安全是本动作的动机：uniqueRepoName
 * 只查库行，目录残留会让同名新项目在旧库内容上 reinit/seed 冲突。 */
export function removeHostedRepoDir(reposDir: string, teamId: string, repoName: string): void {
  rmSync(repoDirFor(reposDir, teamId, repoName), { recursive: true, force: true });
}

/** 任务所属项目行，须与任务同队（#1497）：本队任务指向他队项目（#1466 前
 * create_todo 可造的存量行）按未绑项目处理——不读他队仓库、不发凭证、不拿
 * 他队的 GitHub 仓出站。按 todo 行解析项目的地方都走这里。 */
export function projectOfTodo(
  db: Db,
  todoRow: { projectId: string; teamId: string },
): ProjectRow | undefined {
  return db
    .select()
    .from(project)
    .where(and(eq(project.id, todoRow.projectId), eq(project.teamId, todoRow.teamId)))
    .get();
}

/** 托管 clone URL（本地主机代位；origin = 请求源 [设计]——单机自 host，
 * executor 经 serverUrl 同源取远端，02 §1.1）。 */
export function hostedCloneUrl(origin: string, teamId: string, repoName: string): string {
  return `${origin}/git${gitHostedRepoPath(teamId, repoName)}`;
}

/** 项目行的 repo 绑定判据（hosted/github/local 三形态任一在位）。单源：
 * claim 载荷 repo 位（machines.tryClaim）与「审核步有无只读检出」
 * （builds.applyBuildStepAction，#511）两处消费——两侧口径漂移会让审核者被
 * 告知一个不存在的检出（或反之，有检出却不说）。 */
export function hasRepoBinding(row: ProjectRow | undefined): boolean {
  // 派生自 projectRepoRef：判据与派生不许各写一条 repoKind 级联——第四种形态
  // 进来只改一处。origin 只参与 cloneUrl 派生、对判据无影响（传空串即弃）。
  return projectRepoRef(row, '') !== null;
}

/** 项目行 → 执行侧 repo 位（三形态 cloneUrl 派生；未绑 = null）。github
 * 形态行上 localPath 非空时随位携带（ADR 0017 / #1213 同机加速位——daemon
 * 侧双条件判定，失格回落 GitHub clone）；local 形态不携带（cloneUrl 即路径）。 */
export function projectRepoRef(
  row: ProjectRow | undefined,
  origin: string,
): { kind: 'hosted' | 'github' | 'local'; cloneUrl: string; localPath?: string } | null {
  if (row?.repoKind === 'hosted' && row.repoName !== null) {
    return { kind: 'hosted', cloneUrl: hostedCloneUrl(origin, row.teamId, row.repoName) };
  }
  // github 形态经 githubRepoOfProject 拆段（#1470）：存量值不合法 = 视同未绑，
  // 不拼 `https://github.com/../user.git` 这类指不到仓库的 URL。
  const githubRef = githubRepoOfProject(row);
  if (githubRef !== null) {
    return {
      kind: 'github',
      cloneUrl: githubCloneUrl(githubRef),
      ...(row?.localPath != null ? { localPath: row.localPath } : {}),
    };
  }
  if (row?.repoKind === 'local' && row.localPath !== null) {
    return { kind: 'local', cloneUrl: row.localPath };
  }
  return null;
}

/** github 形态项目行 → `{owner, repo}`：server 侧 GitHub API 出站的拆段单口
 * （issue 读面、#452 自建 issue、CI 轮询、PR 状态探测）。非 github 形态 /
 * 列空 / 存量值不合法（#1466：`.` / `..` 段会改写 `repos/{o}/{r}` 请求路径）
 * 一律 null，调用方按「项目不是合法 GitHub 仓」处理、不出站。 */
export function githubRepoOfProject(
  row: Pick<ProjectRow, 'repoKind' | 'githubRepo'> | undefined,
): GithubRepoRef | null {
  if (row?.repoKind !== 'github' || row.githubRepo === null) return null;
  return parseGithubRepoRef(row.githubRepo);
}

/** GitHub 接入 clone URL（https 派生 [设计]；凭证 per-step 注入归 M3，02 §8）。 */
export function githubCloneUrl(ref: GithubRepoRef): string {
  return `https://github.com/${ref.owner}/${ref.repo}.git`;
}

/** `~` 展开（spec 12：local 路径表单支持 `~/…` 粘贴；浏览器无从知道 server
 * 端 HOME，展开必须在 server 侧）。`~user` 形态不展开（getpwnam 面不引，
 * 留给绝对路径闸拒绝）；homeDir 参数 = 测试注入位。 */
export function expandHomePath(rawPath: string, homeDir: string = homedir()): string {
  if (rawPath === '~') return homeDir;
  if (rawPath.startsWith('~/')) return join(homeDir, rawPath.slice(2));
  return rawPath;
}

/** local 形态路径校验（spec 12 / #359）：`~` 展开 → 绝对路径要求。
 * **只做形态校验**——存在性 / git 仓判定下沉到 daemon（workspace.ts
 * `LocalRepoUnreachableError` 预检），server 进程在多机部署下看不见执行机
 * fs（server 在 Mac、repo 在 mea 是常态），硬验会把合法路径 400 掉。这与
 * github 形态 localPath 加速位（validateGithubLocalSlotPath）同口径：server
 * 只验形态，可达性归 daemon。通过 = 返回规范化绝对路径（落库 localPath
 * 列值，daemon 镜像 clone 同源消费）。
 * 创建面不再抛 not_found / not_git reason code——daemon 侧 step 失败文案
 * 点名机器/路径/原因（runner.ts 的 LocalRepoUnreachableError 合成），
 * 读面（requireRepoReadDir F2/F3）仍按 server 端单机读抛同族 reason。 */
export async function validateLocalRepoPath(rawPath: string | null | undefined): Promise<string> {
  const raw = rawPath?.trim() ?? '';
  if (raw === '') {
    throw new HttpError(400, 'invalid body at localPath: required for kind "local"');
  }
  const expanded = expandHomePath(raw);
  if (!isAbsolute(expanded)) {
    // 三态 reason code（#386）：web 分译按 code 判别，消息子串不再是契约。
    throw new HttpError(
      400,
      `invalid body at localPath: expected absolute path, got "${raw}"`,
      'not_absolute',
    );
  }
  return expanded;
}

/** github 形态 localPath 加速位校验（ADR 0017 / #1213）：**只做形态校验**——
 * trim + 绝对路径（非绝对 = 400 + reason not_absolute，词表同 local 形态）。
 * 不做存在性 / git 仓校验：路径可能活在执行机上，server 进程看不见它
 * （多机部署 server 与 daemon 异机），硬验会把合法形态 400 掉；真实可达性
 * 判定在 daemon 侧（existsSync + origin 对账，失格静默回落 GitHub clone）。
 * `~` 不展开——那是 local 形态的 server 同机语义；加速位只收绝对路径。
 * 空串归一 null（空 ≡ 未设，与 PATCH 清空语义一致）。 */
export function validateGithubLocalSlotPath(rawPath: string | null | undefined): string | null {
  const raw = rawPath?.trim() ?? '';
  if (raw === '') return null;
  if (!isAbsolute(raw)) {
    throw new HttpError(
      400,
      `invalid body at localPath: expected absolute path, got "${raw}"`,
      'not_absolute',
    );
  }
  return raw;
}

export function toProjectRecord(row: ProjectRow, origin?: string): ProjectRecord {
  // github 形态 cloneUrl 经 githubRepoOfProject（#1470）；githubRepo 列原样回显，
  // 设置页才看得见并改掉不合法的存量值。
  const githubRef = githubRepoOfProject(row);
  return {
    id: row.id,
    name: row.name,
    teamId: row.teamId,
    // #1242 描述面：null = 键缺席（与 repoKind 等可空列同口径）。
    ...(row.description !== null ? { description: row.description } : {}),
    ...(row.repoKind !== null ? { repoKind: row.repoKind } : {}),
    ...(row.repoName !== null ? { repoName: row.repoName } : {}),
    ...(row.githubRepo !== null ? { githubRepo: row.githubRepo } : {}),
    ...(row.localPath !== null ? { localPath: row.localPath } : {}),
    ...(row.repoKind === 'hosted' && row.repoName !== null && origin !== undefined
      ? { cloneUrl: hostedCloneUrl(origin, row.teamId, row.repoName) }
      : {}),
    ...(githubRef !== null ? { cloneUrl: githubCloneUrl(githubRef) } : {}),
  };
}

/** GitHub 接入 `owner/repo` 形状校验——单源已迁 @cairn/shared（web 表单
 * 同吃，#305）；此处 re-export 维持 routes/skills/chief-tools 三个既有
 * import 面不动。 */
export { isGithubRepoRef } from '@cairn/shared';

/** 文件浏览面的 repo 目录解析（#1030 起 hosted + local 双形态放行；GitHub
 * 形态无本地存储面仍 404）。hosted = server 侧 bare 目录（自 provisioning
 * 起恒在位）；local = 行上 localPath（创建时已过 validateLocalRepoPath——
 * 此刻再失格 = 目录被删/被替换，或多机部署下 server 与仓库不同机）。
 * local 失格走**分类降级**而非 500/空树：404 + reason code（复用
 * PROJECT_LOCAL_ERROR_REASONS 词表，web 按 code 分译人话提示）。git 读原语
 * （resolveCommit/lsTree/…）对工作树仓与裸库同形，无需分叉。 */
export async function requireRepoReadDir(ctx: RepoCtx, projectId: string): Promise<string> {
  const row = ctx.db.select().from(project).where(eq(project.id, projectId)).get();
  if (!row) throw notFound(`project ${projectId}`);
  if (row.repoKind === 'hosted' && row.repoName !== null) {
    return repoDirFor(ctx.reposDir, row.teamId, row.repoName);
  }
  if (row.repoKind === 'local') {
    if (row.localPath === null) {
      // 行完整性破（创建闸保证 local 必带 localPath）——显式红，不静默空。
      throw notFound(`local repo for project ${projectId}`);
    }
    if (!existsSync(row.localPath)) {
      throw new HttpError(404, `local repo path not found: ${row.localPath}`, 'not_found');
    }
    if (!(await systemGitOps.isGitRepo(row.localPath))) {
      throw new HttpError(
        404,
        `local repo path is not a git repository: ${row.localPath}`,
        'not_git',
      );
    }
    return row.localPath;
  }
  throw notFound(`hosted repo for project ${projectId}`);
}

// —— tree/file/branches/commits/files 面（响应封套单源 = shared
// projectTree/File/Branches/Commits/Files ResponseSchema，[推断] 注记在
// shared 侧；目录解析 = requireRepoReadDir 单源）———————————————————————

/** ref → commit sha；解析失败 = 404（tree/file 共用）。 */
async function resolveCommitOr404(dir: string, ref: string): Promise<string> {
  const commit = await systemGitOps.resolveCommit(dir, ref);
  if (commit === null) throw notFound(`ref ${ref}`);
  return commit;
}

export async function readTree(
  ctx: RepoCtx,
  projectId: string,
  refParam?: string,
  pathParam?: string,
): Promise<ProjectTreeResponse> {
  const dir = await requireRepoReadDir(ctx, projectId);
  const ref = refParam ?? 'HEAD';
  const commit = await resolveCommitOr404(dir, ref);
  const subPath = pathParam !== undefined && pathParam !== '' ? pathParam : undefined;
  const entries = await systemGitOps.lsTree(dir, commit, subPath);
  return { ref, commit, path: subPath ?? '', entries };
}

/** 全递归候选上界（#760 files 面）：缺省 2000，最大 5000。截断按 git 序取
 * 前 N + truncated 置位——召回降级但交互帧率不降（客户端全量本地 fuzzy）。 */
export const PROJECT_FILES_DEFAULT_LIMIT = 2000;
export const PROJECT_FILES_MAX_LIMIT = 5000;

/** 全递归文件列举（#760 composer `@` 候选源）：读 repo ref 全树路径表。
 * 口径与 tree/file 同族——github 形态/坏 ref = 404（web 侧静默退回
 * agents-only，不弹错）。limit 非数字/越界即钳制，不 400（补全候选是
 * 渐进增强面，参数宽容）。 */
export async function readFiles(
  ctx: RepoCtx,
  projectId: string,
  refParam?: string,
  limitParam?: string,
): Promise<ProjectFilesResponse> {
  const dir = await requireRepoReadDir(ctx, projectId);
  const ref = refParam ?? 'HEAD';
  const commit = await resolveCommitOr404(dir, ref);
  const parsed = limitParam === undefined || limitParam === '' ? NaN : Number(limitParam);
  const limit = Number.isInteger(parsed)
    ? Math.min(Math.max(parsed, 1), PROJECT_FILES_MAX_LIMIT)
    : PROJECT_FILES_DEFAULT_LIMIT;
  const all = await lsFilesRecursive(dir, commit);
  const files = all.slice(0, limit).map((e) => ({ path: e.path, type: e.type, size: e.size }));
  return { ref, commit, truncated: all.length > files.length, files };
}

/** 二进制判定：首 8KB 含 NUL（git 同款启发式 [设计]）。 */
function looksBinary(buf: Uint8Array): boolean {
  const window = buf.subarray(0, 8000);
  return window.includes(0);
}

export async function readFile(
  ctx: RepoCtx,
  projectId: string,
  path: string,
  refParam?: string,
): Promise<ProjectFileResponse> {
  // 400 前置校验（lib 层同名校验 = 缝契约兜底，双保险 [设计]）。
  if (!isSafeRepoPath(path)) throw new HttpError(400, `invalid query path: ${path}`);
  const dir = await requireRepoReadDir(ctx, projectId);
  const ref = refParam ?? 'HEAD';
  const commit = await resolveCommitOr404(dir, ref);
  const file = await systemGitOps.readFileAt(dir, commit, path);
  if (file === null) throw notFound(`file ${path} at ref ${ref}`);
  const binary = looksBinary(file.content);
  return {
    ref,
    commit,
    path,
    size: file.size,
    encoding: binary ? 'base64' : 'utf-8',
    content: binary
      ? Buffer.from(file.content).toString('base64')
      : new TextDecoder().decode(file.content),
  };
}

export async function readBranches(
  ctx: RepoCtx,
  projectId: string,
): Promise<ProjectBranchesResponse> {
  const dir = await requireRepoReadDir(ctx, projectId);
  return systemGitOps.listBranches(dir);
}

// —— commits 读面（#149 项目页 文件|历史 分段「历史」数据源）：[推断] 端点
// GET /api/projects/{id}/commits，wire 未采——行形 = git log 最小投影（封套
// 单源 shared projectCommitsResponseSchema），登记 wire.test INFERRED_ROUTES。
// runGit 直调先例 = readBuildChanges（diff 面同款：缝词表外的只读 git 查询
// 留在 server lib/git.ts spawn 家族内）。github 形态无本地读面 = 404
// （tree/file/branches 同族口径；local = #1030 起放行）。

/** 提交行上限（历史 pane 首屏 [设计]；分页归后票）。 */
const COMMITS_LIMIT = 50;

export async function readCommitHistory(
  ctx: RepoCtx,
  projectId: string,
  refParam?: string,
): Promise<ProjectCommitsResponse> {
  const dir = await requireRepoReadDir(ctx, projectId);
  const { defaultBranch } = await systemGitOps.listBranches(dir);
  const ref = refParam ?? defaultBranch ?? 'HEAD';
  const commit = await systemGitOps.resolveCommit(dir, ref);
  if (commit === null) return { ref, commits: [] }; // 空库（无 ref）= 空集
  // %x00 分隔 + %s 标题行：单行原子字段，无换行歧义（解析 [设计]）
  const r = await runGit(
    ['log', `--max-count=${COMMITS_LIMIT}`, '--format=%H%x00%h%x00%aI%x00%an%x00%s', commit],
    { cwd: dir, timeoutMs: 30_000 },
  );
  if (r.code !== 0) return { ref, commits: [] };
  const commits = r.stdout
    .toString('utf8')
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => {
      const [sha, shortSha, at, authorName, message] = line.split('\0');
      return {
        sha: sha ?? '',
        shortSha: shortSha ?? '',
        message: message ?? '',
        authorName: authorName ?? '',
        at: Date.parse(at ?? '') || 0,
      };
    });
  return { ref, commits };
}

// —— 提交详情读面（#1102 历史行点击 → 该提交 diff）：[推断] 端点
// GET /api/projects/{id}/commits/{sha}，wire 未采——wire.test INFERRED_ROUTES
// 登记（commits 列表端点先例）。失败方式先列（仓测试纪律；hosted 面钉在
// git-hosting.test.ts、local 面钉在 project-local.test.ts）：
//   S1 未知项目 / github 形态 → 404（requireProject / requireRepoReadDir
//      单源，commits 列表同族口径，不新增分叉）
//   S2 local 目录消失 / 非 git → 404 + reason not_found/not_git（同闸同形，
//      #1030 分类降级——不 500、不空树）
//   S3 sha 不可达 / 注入形（`HEAD; …`、`--flag` 样串）→ 404 不 500：
//      resolveCommitOr404 走 rev-parse --verify --end-of-options（lib/git.ts
//      缝，注入安全），git show 只吃解析后的 40-64 位 hex，用户原文不进 argv
//   S4 根提交（无父）→ 相对空树全文件新增（git show 对根提交的既定语义，
//      2026-10-10 实测），不是崩溃也不是空集
//   S5 merge 提交 → 相对第一父的 diff（--first-parent；默认 combined diff
//      对干净 merge 恒空集，会把「有改动」演成「无改动」——2026-10-10 实测）
//   S6 空提交 / 纯二进制提交 → files=[] 定义态（parseUnifiedDiff 滤掉无
//      hunks 的文件行，build changes 面同款口径）
//   S7 元信息与列表行漂移 → 同一 %x00 格式串（%H/%h/%aI/%an/%s，
//      readCommitHistory 同源），详情头与行面渲染同源字段
//   S8 巨大 diff → runGit 30s 超时（readCommitHistory/readBuildChanges 同
//      口径）；无字节闸——changes 面同暴露，收紧归两面共同的后票

/** 单提交元信息 + 相对第一父的文件级 diff（#1102 详情面数据源）。git show
 * 单次调用：--format 首行 = 元信息（%x00 分隔），--patch 段直接喂
 * parseUnifiedDiff（解析器天然跳过首个 `diff --git` 之前的一切行，元信息行
 * 以 hex sha 开头不会误命中文件头前缀）。runGit 直调先例 =
 * readCommitHistory / readBuildChanges（缝词表外的只读 git 查询留在 server
 * lib/git.ts spawn 家族内）。 */
export async function readCommitDetail(
  ctx: RepoCtx,
  projectId: string,
  sha: string,
): Promise<ProjectCommitDetailResponse> {
  const dir = await requireRepoReadDir(ctx, projectId);
  const commit = await resolveCommitOr404(dir, sha);
  const r = await runGit(
    ['show', '--format=%H%x00%h%x00%aI%x00%an%x00%s', '--patch', '--first-parent', commit],
    { cwd: dir, timeoutMs: 30_000 },
  );
  if (r.code !== 0) throw notFound(`commit ${sha}`);
  const text = r.stdout.toString('utf8');
  const [fullSha, shortSha, at, authorName, message] = (text.split('\n')[0] ?? '').split('\0');
  // resolveCommitOr404 已保证 commit 可达——show 输出空首行 = repo 状态在两次
  // git 调用之间被抽走（并发 gc/prune），显式 404 不静默空。
  if (fullSha === undefined || fullSha === '') throw notFound(`commit ${sha}`);
  return {
    sha: fullSha,
    shortSha: shortSha ?? '',
    message: message ?? '',
    authorName: authorName ?? '',
    at: Date.parse(at ?? '') || 0,
    files: parseUnifiedDiff(text),
  };
}

// —— build 变更面（M5 [推断] 读端点 GET /api/builds/{id}/changes 数据源）：
// 变更 pane（r7 27/27b/36）= conv 分支相对默认分支的文件级 unified diff。
// 端点/封套 wire 未采——形状复用 documentDiffSchema 的 files 段（diffFileSchema
// 单源，r5 §4 触点同族），登记 wire.test INFERRED_ROUTES（04 §3 不判负口径）。
// GitHub-backed 项目（02 §3）：本地无存储，投影真值 = daemon 步收尾上报
// （#704 build.changes 列——PR 面亦随同票落地，见 machines.ts finishStep）。

/** unified diff 文本 → diffFileSchema[]（git diff 输出解析 [设计]；行保留
 * `+`/`-`/` ` 前缀 = documents.ts structuredPatch 行形同款约定）。 */
export function parseUnifiedDiff(text: string): DocumentDiffFile[] {
  const files: DocumentDiffFile[] = [];
  let current: DocumentDiffFile | null = null;
  let hunk: { header: string; lines: string[] } | null = null;
  const lines = text.replace(/\n$/, '').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (line.startsWith('diff --git ')) {
      current = { path: '', additions: 0, deletions: 0, hunks: [] };
      files.push(current);
      hunk = null;
      continue;
    }
    if (current === null) continue;
    if (line.startsWith('+++ ')) {
      const p = line.slice(4).trim();
      if (p !== '/dev/null') current.path = p.replace(/^b\//, '');
      continue;
    }
    if (line.startsWith('--- ')) {
      const p = line.slice(4).trim();
      if (current.path === '' && p !== '/dev/null') current.path = p.replace(/^a\//, '');
      continue;
    }
    if (line.startsWith('@@')) {
      hunk = { header: `${line.split(' @@')[0] ?? ''} @@`, lines: [] };
      current.hunks.push(hunk);
      continue;
    }
    if (hunk === null) continue; // index/mode 头等文件级元数据行
    if (line.startsWith('\\')) continue; // `\ No newline at end of file`
    if (line === '') continue; // 防御：hunk 内空串（git 输出上下文行恒带前缀空格）
    hunk.lines.push(line);
    if (line.startsWith('+')) current.additions += 1;
    else if (line.startsWith('-')) current.deletions += 1;
  }
  return files.filter((f) => f.path !== '' && f.hunks.length > 0);
}

/** 原始 unified diff 是否点名了文件。二进制、100% 重命名、mode-only、
 * 新建空文件都有 `diff --git` 头，但没有 @@ hunk，parseUnifiedDiff 会丢掉。
 * 完成弹层用这个头判断「git 有没有改动」，不用解析后的文件数。 */
export function diffTextNamesAFile(text: string): boolean {
  for (const line of text.split('\n')) {
    if (line.startsWith('diff --git ')) return true;
  }
  return false;
}

/** conv 分支相对默认分支的变更文件集（变更 pane 数据源）；无 repo / 分支缺位 /
 * 空 diff = 空集（占位文案面归 web，r7 38）。
 * 真值源按形态分叉（#704）：hosted = server bare repo（git 单源，本函数既有
 * 计算）；非 hosted（github/local）= daemon 步收尾上报的 build.changes 列
 * （done.changesDiff 解析落库——B-C1 归因「产物核验只能去 GitHub 侧看」的
 * 补口）。列 null = 未上报（旧 build / 上报失败）= 空集不造假；
 * 空数组 = 已上报且零改动（与 null 语义分离）。
 * #1313：`reported` 把这两种空集交给完成弹层。`changed` 看原始 diff 的
 * `diff --git` 头，不看解析后的文件数。files 仍是给变更 pane 的解析结果，
 * 调用方只读 files 的路径不变。hosted 读到 git diff（含空 diff）= 已上报；
 * 分支缺位或 git 失败 = 未上报，不把读失败当成零改动。 */
export async function readBuildChanges(
  ctx: RepoCtx,
  buildId: string,
): Promise<{ files: DocumentDiffFile[]; reported: boolean; changed?: boolean }> {
  const buildRow = ctx.db.select().from(buildTable).where(eq(buildTable.id, buildId)).get();
  if (!buildRow) throw notFound(`build ${buildId}`);
  const todoRow = ctx.db.select().from(todoTable).where(eq(todoTable.id, buildRow.todoId)).get();
  if (!todoRow) throw notFound(`todo ${buildRow.todoId}`);
  const projRow = projectOfTodo(ctx.db, todoRow);
  if (projRow?.repoKind !== 'hosted' || projRow.repoName === null) {
    const stored = buildRow.changes;
    if (stored == null) return { files: [], reported: false };
    if (Array.isArray(stored)) {
      return { files: stored, reported: true, changed: stored.length > 0 };
    }
    return { files: stored.files, reported: true, changed: true };
  }
  const dir = repoDirFor(ctx.reposDir, projRow.teamId, projRow.repoName);
  const { defaultBranch } = await systemGitOps.listBranches(dir);
  const base = defaultBranch ?? 'main';
  const baseSha = await systemGitOps.resolveCommit(dir, `refs/heads/${base}`);
  const headSha = await systemGitOps.resolveCommit(
    dir,
    `refs/heads/${conversationBranch(buildId)}`,
  );
  if (baseSha === null || headSha === null) return { files: [], reported: false };
  const r = await runGit(['diff', `${baseSha}...${headSha}`], { cwd: dir, timeoutMs: 30_000 });
  if (r.code !== 0) return { files: [], reported: false };
  const text = r.stdout.toString('utf8');
  return { files: parseUnifiedDiff(text), reported: true, changed: diffTextNamesAFile(text) };
}

// —— diff 全文读面（#224）：conv 分支头单文件全文按需取（#219 裁决 A——独立于
// changes 列表面，列表不被全文撑爆；docpane「显示完整文件」数据源，web 接线
// #225）。封套单源 = shared diffFileContentSchema（形状镜像
// projectFileResponseSchema）。大小闸门前置 `cat-file -s`（只取 size，超限
// blob 不载内存）；`cat-file -s` 直调 = readBuildChanges 同款先例（缝词表外的
// 只读 git 查询留在 server lib/git.ts spawn 家族内）。

/** 全文闸门（docpane 内联展示上限 [设计]；超限 = 413，提示面归 web #225）。 */
const DIFF_FILE_MAX_BYTES = 1024 * 1024;

export async function readBuildChangeFile(
  ctx: RepoCtx,
  buildId: string,
  path: string,
): Promise<DiffFileContent> {
  // 400 前置校验（lib 层同名校验 = 缝契约兜底，双保险 [设计]，readFile 同款）。
  if (!isSafeRepoPath(path)) throw new HttpError(400, `invalid query path: ${path}`);
  const buildRow = ctx.db.select().from(buildTable).where(eq(buildTable.id, buildId)).get();
  if (!buildRow) throw notFound(`build ${buildId}`);
  const todoRow = ctx.db.select().from(todoTable).where(eq(todoTable.id, buildRow.todoId)).get();
  if (!todoRow) throw notFound(`todo ${buildRow.todoId}`);
  const projRow = projectOfTodo(ctx.db, todoRow);
  if (projRow?.repoKind !== 'hosted' || projRow.repoName === null) {
    throw notFound(`hosted repo for build ${buildId}`);
  }
  const dir = repoDirFor(ctx.reposDir, projRow.teamId, projRow.repoName);
  const ref = conversationBranch(buildId);
  const commit = await systemGitOps.resolveCommit(dir, `refs/heads/${ref}`);
  if (commit === null) throw notFound(`ref ${ref}`);
  // 闸门前置：size 先行（path 不存在 / 命中目录树时 cat-file blob 判负 = 404）。
  const sizeRes = await runGit(['cat-file', '-s', `${commit}:${path}`], {
    cwd: dir,
    timeoutMs: 15_000,
  });
  if (sizeRes.code !== 0) throw notFound(`file ${path} at ref ${ref}`);
  const size = Number.parseInt(sizeRes.stdout.toString('utf8').trim(), 10);
  if (size > DIFF_FILE_MAX_BYTES) {
    throw new HttpError(413, `file ${path} too large: ${size} > ${DIFF_FILE_MAX_BYTES} bytes`);
  }
  const file = await systemGitOps.readFileAt(dir, commit, path);
  if (file === null) throw notFound(`file ${path} at ref ${ref}`);
  const binary = looksBinary(file.content);
  return {
    ref,
    commit,
    path,
    size: file.size,
    encoding: binary ? 'base64' : 'utf-8',
    content: binary
      ? Buffer.from(file.content).toString('base64')
      : new TextDecoder().decode(file.content),
  };
}
