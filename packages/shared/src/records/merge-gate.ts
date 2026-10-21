// 合并就绪闸词表（#1404，ADR 0021 D1–D4，spec 28 P3）。server 现算补丁摘要、
// 判 D4 路径与证据链，readiness 与 chief 工具、任务详情页同源展示；本文件只放
// 三端共用的常量与形状，不含判定逻辑。
// 本文件属 D4 ④「合并就绪闸自身的源码」：改它留用户合并。

import { z } from 'zod';

/** 项目级合并策略（ADR 0021 D1）；缺省 human，P3 生产恒为 human，P4 加列。 */
export const MERGE_POLICIES = ['human', 'shadow', 'autonomous'] as const;
export const mergePolicySchema = z.enum(MERGE_POLICIES);
export type MergePolicy = z.infer<typeof mergePolicySchema>;

/** head SHA 上的 commit status context。不加进分支保护的必需检查。 */
export const MERGE_GATE_STATUS_CONTEXT = 'pacman/merge-gate';

/** 数值上限。compareFileCap = compare 接口单次最多返回的文件数：拿到这么多
 * 就当作被截断（恰好 300 与截断后的 300 分不出来）。 */
export const GATE_LIMITS = {
  maxLines: 800,
  maxFiles: 40,
  compareFileCap: 300,
  fixRoundsMax: 2,
  roundsMax: 4,
  perspectiveDeadlineMs: 3_600_000,
  perspectiveRetries: 1,
} as const;

/** 补丁摘要版本前缀；算法一改就换前缀，旧判定不会与新摘要撞上。pd1 是四元组
 * （不含 patchSha），没有落过库；pd2 起按 ADR 0021 D3 修订后的五元组。 */
export const PATCH_DIGEST_VERSION = 'pd2';

/** 证据目录（仓根锚定）。其下的改动不进摘要；行数与文件数照算（D4 的上限按
 * 整张补丁），其中的二进制文件不留人。 */
export const EVIDENCE_PREFIX = 'docs/verify/';

/** 证据目录里会被当成可执行代码的扩展名（不分大小写）。HTML 在浏览器里打开就会跑
 * 其中的脚本，一并算。
 * 没有扩展名、靠 shebang 运行的文件按名判不到：要看 patch 文本，而这里只留它的哈希。 */
export const EVIDENCE_EXECUTABLE_EXTENSIONS = [
  '.mjs',
  '.cjs',
  '.js',
  '.mts',
  '.cts',
  '.ts',
  '.jsx',
  '.tsx',
  '.sh',
  '.py',
  '.bash',
  '.zsh',
  '.fish',
  '.ps1',
  '.psm1',
  '.bat',
  '.cmd',
  '.html',
  '.htm',
] as const;

/** 可以不经人合并的路径（ADR 0021 D4 默认拒绝）：产品源码、测试与证据。
 * 与 .claude/workflows/pr-gate.js 的 AUTO_MERGE 同一份口径。 */
export const AUTO_MERGE_PATH_GLOBS = [
  'apps/*/src/**',
  'apps/*/test/**',
  'apps/*/e2e/**',
  'packages/*/src/**',
  'packages/*/test/**',
  'integration/test/**',
  'docs/verify/**',
] as const;

/** D4 保护类别 ①–③ 与 ⑤：不分大小写；①–③ 多为任意层级，⑤ 锚定在原路径。与
 * pr-gate.js 的 PROTECTED 同口径（④ 在 MERGE_GATE_SOURCE_GLOBS）。 */
export const PROTECTED_PATH_GLOBS = [
  // ① CI、钩子与左右 agent 的文件
  '.github/**',
  '**/.husky/**',
  '**/.claude/**',
  '**/.pi/**',
  '**/.cursor/**',
  '**/.mcp.json',
  '**/.ckignore',
  '**/CLAUDE*.md',
  '**/AGENTS*.md',
  'docs/pr-review.md',
  'docs/adr/**',
  // ② 闸脚本与决定检查口径的配置
  '**/scripts/**',
  '**/*.config.*',
  '**/biome.json',
  '**/biome.jsonc',
  '**/tsconfig*.json',
  '**/.gitignore',
  '**/.gitattributes',
  // ③ 单向门：迁移与供应链
  '**/drizzle/**',
  '**/package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  '**/.npmrc',
  // 5 security-sensitive surfaces (the AGENTS.md /security-review list; change both together) and the DB bootstrap that runs migrations
  'apps/server/src/lib/secret-box.ts',
  'apps/server/src/lib/keys.ts',
  'apps/server/src/lib/token-auth.ts',
  'apps/server/src/lib/attachments-token.ts',
  'apps/server/src/services/secrets.ts',
  'apps/server/src/services/credentials.ts',
  'apps/server/src/services/api-keys.ts',
  'apps/server/src/services/webhook-tokens.ts',
  'apps/server/src/services/oauth.ts',
  'apps/server/src/routes-machine.ts',
  'apps/server/src/services/machine*.ts',
  'apps/daemon/src/credentials.ts',
  'apps/daemon/src/secret-channel.ts',
  'apps/daemon/src/shell-channel.ts',
  'apps/daemon/src/machine-client.ts',
  'apps/daemon/src/backend/command-gate.ts',
  'apps/server/src/services/mcp-face.ts',
  'apps/server/src/services/mcp-servers.ts',
  'apps/server/src/routes-webhook.ts',
  'apps/server/src/db/client.ts',
] as const;

/** D4 ④：合并就绪闸自身的源码（含本文件）。 */
export const MERGE_GATE_SOURCE_GLOBS = [
  'apps/server/src/services/merge-gate/**',
  'packages/shared/src/records/merge-gate.ts',
  'apps/daemon/src/merge-decision.ts',
] as const;

/** compare 接口 files[].status 的取值（GitHub REST「Compare two commits」）。 */
export const COMPARE_FILE_STATUSES = [
  'added',
  'removed',
  'modified',
  'renamed',
  'copied',
  'changed',
  'unchanged',
] as const;

/** compare 文件条目，取摘要与路径判定要用的字段。sha 在文档里是 string 或
 * null；实测删除条目带旧 blob 的 sha（docs/verify/1404/compare-sample.json）。
 * patchSha：响应里非空 patch 文本的 sha256（hex），没有 patch 时为 null（ADR 0021
 * D3 元组的第五位）。REST 文档：带二进制数据的 diff 没有 patch（实测 PNG 条目没有，
 * apps/server/test/fixtures/merge-gate-compare-sample.json）；diff 过大、纯改名也
 * 不带。没有 patch 就没有可读的 diff。 */
export const compareFileSchema = z.object({
  status: z.enum(COMPARE_FILE_STATUSES),
  filename: z.string().min(1),
  previousFilename: z.string().min(1).nullable(),
  sha: z.string().nullable(),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  patchSha: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .nullable(),
});
export type CompareFile = z.infer<typeof compareFileSchema>;
