// project record——02 §6.1（projects?teamId= / projects/{id}/* 端点族）+
// 01 §6 表注「repo 形态字段：托管 bare / GitHub 接入（02 §3/A4）」。
// wire 形状未实测（r2 §1.5 projects 缓存为空数组样本），以下为最小投影：
// id/name/teamId 有据（schedules 内嵌 todo.projectName、?teamId= 查询、
// branches/tags/todos 子资源），repo 形态字段按 02 §3 双形态逆推 [推断]，
// M2 实现期展开。

import { z } from 'zod';
import { recordId } from './common.js';
import { diffFileSchema } from './document-diff.js';
import { mergePolicySchema } from './merge-gate.js';

/** repo 形态（02 §3/A4 双形态 + spec 12 local 三形态）：托管 = server 自带
 * 本地 bare repo（git http-backend）；接入 = GitHub（PR/CI 面）；local =
 * 用户本机既有 git 工作树仓（#352/spec 12，daemon 镜像 clone 执行）。
 * hosted/github wire 值 [推断] 可改判。 */
export const PROJECT_REPO_KINDS = ['hosted', 'github', 'local'] as const;
export const projectRepoKindSchema = z.enum(PROJECT_REPO_KINDS);
export type ProjectRepoKind = z.infer<typeof projectRepoKindSchema>;

export const projectRecordSchema = z.object({
  id: recordId,
  name: z.string(),
  teamId: recordId,
  /** 项目描述（#1242 设置页可编辑面）：可空，null/缺键 = 无描述（行值
   * null 时 toProjectRecord 不带键——与 repoKind 等可空列同口径）。 */
  description: z.string().optional(),
  /** repo 形态（02 §3）；字段名/值 [推断]。GitHub 接入侧连号授权、
   * executor push conv 分支、建 PR、读 PR/issues/CI workflow runs。 */
  repoKind: projectRepoKindSchema.optional(),
  // —— M2b repo 形态展开（本 schema 头注「M2 实现期展开」的落地；皆 [推断]，
  // wire 补采后收紧，04 附录 A）——
  /** 托管 repo 名段：远端 URL `<host>/<teamId>/<repoName>`（r3 §1.4 daemon.log
   * `Cloning <teamId>/r3-lifecycle` 实测形状；值 = 项目名 slug [设计]）。 */
  repoName: z.string().optional(),
  /** GitHub 接入 `owner/repo`（02 §3 接入形态；字段名 [推断]）。 */
  githubRepo: z.string().optional(),
  /** local 形态：用户本机 git 工作树仓绝对路径（spec 12 / #359；server 端
   * `~` 展开后的规范化值，daemon 镜像 clone 同源消费）。github 形态（ADR
   * 0017 / #1213）：可选同机执行加速位——server 只做形态校验（绝对路径），
   * 存在性与 git 仓判定在 daemon 侧（路径可能活在执行机上，server 看不见），
   * 失格静默回落 GitHub clone。 */
  localPath: z.string().optional(),
  mergePolicy: mergePolicySchema.optional(),
  localChecks: z.array(z.string().min(1)).optional(),
  /** clone URL（「Git 复制检出命令」卡数据源，02 §9.3）。托管 = 本地主机代位
   * （02 §5.8 gitHostDomain 槽）；github = github.com 派生 [设计]；local 形态
   * 无远端 URL 面（daemon 直接 clone localPath，spec 12）。 */
  cloneUrl: z.string().optional(),
});
export type ProjectRecord = z.infer<typeof projectRecordSchema>;

export const projectMergeConfigSchema = z.object({
  mergePolicy: mergePolicySchema.default('human'),
  localChecks: z.array(z.string().min(1)).default([]),
});
export type ProjectMergeConfig = z.infer<typeof projectMergeConfigSchema>;
export const patchProjectMergeConfigSchema = projectMergeConfigSchema.partial().strict();
export type PatchProjectMergeConfig = z.infer<typeof patchProjectMergeConfigSchema>;

/** GitHub 仓库引用对象面（spec 12 数据契约：picker 单选回填 {owner,repo}；
 * 手动兜底入口仍出 `owner/repo` 字符串面——server 归一为同一列值）。 */
export const githubRepoRefSchema = z.object({
  owner: z.string(),
  repo: z.string(),
});
export type GithubRepoRef = z.infer<typeof githubRepoRefSchema>;

/** `owner/repo` 形状校验 + 拆段单源（[推断] 最小护栏）：字符集 = GitHub 仓名
 * 规则（ASCII 字母数字与 `.`、`-`、`_`，docs.github.com「Creating a new
 * repository」）。owner 或 repo 为 `.` / `..` 一律拒（#1466）：两者是 GitHub
 * 保留名（github.com/dead-claudia/github-limits 实测），也是 URL 的 dot
 * segment——`repos/${owner}/${repo}/...` 拼出的请求经 fetch 归一会被改写
 * （`../user` → `/user/...`），团队 token 随之读到 api.github.com 的其它路径。
 * `...` 等多点名不是 dot segment（WHATWG URL 标准只认 `.` / `..` 及 `%2e`
 * 变体，`%` 不在字符集内），照过。
 * 消费面：server 写入闸（POST/PATCH projects、chief connect_repo）与读路径
 * （存量行再过一遍，不合法 = 按非 GitHub 项目处理，不出站）、web 表单提交闸、
 * daemon PR 探测。 */
export function parseGithubRepoRef(value: string): GithubRepoRef | null {
  const m = /^([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)$/.exec(value);
  const owner = m?.[1];
  const repo = m?.[2];
  if (owner === undefined || repo === undefined) return null;
  if (owner === '.' || owner === '..' || repo === '.' || repo === '..') return null;
  return { owner, repo };
}

/** 布尔面（server 路由 400 门与 web 表单提交闸同吃本单源——#305 前该函数
 * 住在 apps/server/src/services/git.ts，web 侧需要同一校验时迁到 shared）。 */
export function isGithubRepoRef(value: string): boolean {
  return parseGithubRepoRef(value) !== null;
}

/** `POST /api/projects` body 单源（spec 12 数据契约面 + 既有 wire 兼容面；
 * server 路由与 web 表单 mutation 同吃）。repo 形态双名同义：`kind` = spec 12
 * 契约名，`repoKind` = 既有 wire 名（r2 §9 项目创建流），并存时 kind 优先；
 * 两者皆缺 = 无 repo 普通项目。githubRepo 双面（字符串 / {owner,repo} 对象）
 * 归一后同过 isGithubRepoRef 闸；localPath 双形态消费（ADR 0017 / #1213）：
 * kind=local 必填（`~` 展开与 git 工作树校验在 server 端，失败 400）；
 * kind=github 可选加速位（server 只验绝对路径形态，存在性判定归 daemon，
 * 失格静默回落 GitHub clone）。 */
export const createProjectBodySchema = z.object({
  name: z.string(),
  teamId: z.string().optional(),
  kind: projectRepoKindSchema.optional(),
  repoKind: projectRepoKindSchema.optional(),
  localPath: z.string().nullish(),
  githubRepo: z.union([z.string(), githubRepoRefSchema]).optional(),
});
export type CreateProjectBody = z.infer<typeof createProjectBodySchema>;

/** `PATCH /api/projects/{id}` body 单源（#1242 五字段写面，#1213 单字段
 * localPath 时代的超集）：缺键 = 不动（键态语义与 createProjectBodySchema
 * 的双名并存族分开——本面不收 `kind`，转换目标恒写 `repoKind`）。字段语义：
 * - `name`：改名（server trim，空白 = 400——名称不是可清空字段）。
 * - `description`：null / 空串 = 显式清空（显式 null 是 wire 契约，不是
 *   「不带键」，#1169 序列化坑族）；字符串 = 落值。
 * - `repoKind`：**唯一合法值 'github'**（local→github 转换目标；反向禁、
 *   hosted 禁、普通项目禁——枚举仍收全词表，非目标值由 service 层 400
 *   明示，schema 只锁形状）。
 * - `githubRepo`：'owner/repo' 字符串，**只在转换面消费**（与 repoKind
 *   同体携带；不带 repoKind 的独立 githubRepo 键 = 400，githubRepo 不经
 *   本面改写已接好的仓）。
 * - `localPath`：#1213 语义（github 形态加速位：缺键不动 / null 清空 /
 *   字符串落值只验绝对路径形态）；local→github 转换时缺键 = 保留原值
 *   （local 创建闸绑定的仓路径就地转为加速位）。
 * strict：未知键 400（未支持字段明示拒绝，禁静默原样返回——#1242 判死
 * #1213 时代的缺键早退族；五键全缺同样 400，见 service 层）。 */
export const patchProjectBodySchema = z
  .object({
    name: z.string().optional(),
    description: z.string().nullish(),
    repoKind: projectRepoKindSchema.optional(),
    githubRepo: z.string().optional(),
    localPath: z.string().nullish(),
  })
  .strict();
export type PatchProjectBody = z.infer<typeof patchProjectBodySchema>;

// —— localPath 400 reason code（#386：错误分类从消息子串契约升级为结构化
// code；server 校验抛 code，web 按 code 分译，词汇三端同源）———————————————

/** `POST /api/projects kind=local` 校验 400 的 reason 值域（services/git.ts
 * validateLocalRepoPath 抛出；required 态 = body 形状缺失，不分类）。
 * #1030 起读面同词表复用：local 项目文件读端点族（tree/file/…）对
 * localPath 失格抛 404 + 同名 reason（not_found/not_git；not_absolute
 * 只属创建面），web 两面共用一套分译。 */
export const PROJECT_LOCAL_ERROR_REASONS = ['not_found', 'not_git', 'not_absolute'] as const;
export type LocalErrorReason = (typeof PROJECT_LOCAL_ERROR_REASONS)[number];

/** reason → zh 分译键（web t() 的 zh-CN 权威键，en 词典以同键收编；#386
 *  前这些键散落在 project-new-page 的子串匹配分支里，收编为映射单源——
 *  键集恒等于词表，词表扩族漏译 = 编译期红）。消费方：创建面内联错误行
 *  （project-new-page）+ local 读面不可达降级行（project-page，#1030）。 */
export const LOCAL_ERROR_REASON_COPY: LocalErrorReasonMap<string> = {
  not_found: '路径不存在',
  not_git: '不是 git 仓库',
  not_absolute: '需要绝对路径',
};

/** 分类错误的 wire 封套：错误形状仍是 `{error}` 单形状（r5 §1），可分类的
 * 错误面额外携带 `reason`（#1030 起不限 400——local 读面 404 同形携带）——
 * 消费方以 `reason in map` 判别，缺键 = 未分类，降级为 error 原文直透。 */
export type LocalErrorBody = { error: string; reason?: LocalErrorReason };

/** reason → 分译键的映射形状：键集恒等于词表（Record 全集约束——server 词表
 *  扩族时 web 侧同键漏译 = 编译期红，而非静默英文直透）。 */
export type LocalErrorReasonMap<T> = Record<LocalErrorReason, T>;

/** 项目页分段开关 `Tasks | Files`（r1 §461 changelog/02 §3 文件浏览面：
 * tree?ref= / file?path=&ref= 读裸库，无检出要求）。 */
export const PROJECT_TABS = ['Tasks', 'Files'] as const;

// —— 文件浏览面响应封套（r3 §8.2 端点存在实测、载荷未采；形状 [推断]，
// 04 附录 A 补采后收紧）————————————————————————————————————————————

/** `GET /api/projects/{id}/tree?ref=` 响应（02 §3 读裸库 ref 树）。 */
export const projectTreeResponseSchema = z.object({
  /** 请求 ref 回显（缺省 `HEAD`）。 */
  ref: z.string(),
  /** 解析后的 commit sha（ref 不存在 = 404 {error}）。 */
  commit: z.string(),
  path: z.string(),
  entries: z.array(
    z.object({
      name: z.string(),
      path: z.string(),
      type: z.enum(['blob', 'tree']),
      /** blob 字节数；tree 为 null（ls-tree -l 语义）。 */
      size: z.number().int().nullable(),
    }),
  ),
});
export type ProjectTreeResponse = z.infer<typeof projectTreeResponseSchema>;

/** `GET /api/projects/{id}/files?ref=&limit=` 响应（#760：composer `@` 文件
 * 补全候选源——既有 tree 面单层，全递归候选另开此面，上界见 FILES 上限）。
 * 形状复用 tree 条目投影 + 截断位；子模块（commit 型）服务端已滤掉。 */
export const projectFilesResponseSchema = z.object({
  /** 请求 ref 回显（缺省 `HEAD`）。 */
  ref: z.string(),
  /** 解析后的 commit sha（ref 不存在 = 404 {error}，与 tree/file 同口径）。 */
  commit: z.string(),
  /** 行数超 limit 即截断（git 序取前 N）；截断只影响召回，不影响交互帧率
   * （客户端全量本地 fuzzy）。 */
  truncated: z.boolean(),
  files: z.array(
    z.object({
      path: z.string(),
      type: z.enum(['blob', 'tree']),
      /** blob 字节数；tree 为 null（ls-tree -l 语义，与 tree 面同形）。 */
      size: z.number().int().nullable(),
    }),
  ),
});
export type ProjectFilesResponse = z.infer<typeof projectFilesResponseSchema>;

/** `GET /api/projects/{id}/file?path=&ref=` 响应（02 §3 读单文件）。 */
export const projectFileResponseSchema = z.object({
  ref: z.string(),
  commit: z.string(),
  path: z.string(),
  size: z.number().int(),
  /** 二进制判定（首 8KB 含 NUL，git 同款启发式 [设计]）→ base64。 */
  encoding: z.enum(['utf-8', 'base64']),
  content: z.string(),
});
export type ProjectFileResponse = z.infer<typeof projectFileResponseSchema>;

/** `GET /api/projects/{id}/branches` 响应（「分支与 PR」区数据面，02 §9.3；
 * PR 卡语义仅 GitHub-backed（r3 §3.9 [推断]），PR 读面依赖 GitHub API 归 M3+）。 */
export const projectBranchesResponseSchema = z.object({
  defaultBranch: recordId.nullable(),
  branches: z.array(
    z.object({
      name: z.string(),
      isDefault: z.boolean(),
    }),
  ),
});
export type ProjectBranchesResponse = z.infer<typeof projectBranchesResponseSchema>;

/** `GET /api/projects/{id}/commits` 响应（#149 项目页 文件|历史 分段的
 * 「历史」数据源；wire 未采，[推断] 读面——路径 = projects/{id}/… REST
 * 同族规则（tree/branches 先例），行形 = git log 最小投影，新→旧序）。 */
export const projectCommitsResponseSchema = z.object({
  /** 解析的 ref 回显（缺省 = 默认分支）。 */
  ref: z.string(),
  commits: z.array(
    z.object({
      sha: z.string(),
      shortSha: z.string(),
      /** 提交标题行（git log %s 同义）。 */
      message: z.string(),
      authorName: z.string(),
      /** 作者时间 epoch ms（git log %aI 解析）。 */
      at: z.number(),
    }),
  ),
});
export type ProjectCommitsResponse = z.infer<typeof projectCommitsResponseSchema>;

/** `GET /api/projects/{id}/commits/{sha}` 响应（#1102 历史行点击 → 提交详情
 * 面：元信息与列表行同款五字段 + 该提交相对**第一父**的文件级 unified
 * diff）。wire 未采，[推断] 读面——路径 = projects/{id}/… REST 同族规则
 * （commits 列表先例），files 段复用 diffFileSchema（document-diff 单源，
 * build changes 面同族）。边界口径（server readCommitDetail 实现钉死）：
 * 根提交（无父）= 相对空树全文件新增；merge 提交 = 相对第一父（combined
 * diff 对干净 merge 恒空集，会把「有改动」演成「无改动」，弃用）；空改动
 * / 纯二进制提交 = files:[] 定义态（parseUnifiedDiff 滤无 hunks 行，changes
 * 面同款）。 */
export const projectCommitDetailResponseSchema = z.object({
  sha: z.string(),
  shortSha: z.string(),
  /** 提交标题行（%s，与列表行 message 同源同值——详情头「与列表行一致」
   * 验收的数据面）。 */
  message: z.string(),
  authorName: z.string(),
  /** 作者时间 epoch ms（git %aI 解析，列表行同源）。 */
  at: z.number(),
  files: z.array(diffFileSchema),
});
export type ProjectCommitDetailResponse = z.infer<typeof projectCommitDetailResponseSchema>;
