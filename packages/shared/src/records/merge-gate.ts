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

/** 补丁摘要版本前缀；算法一改就换前缀，旧判定不会与新摘要撞上。 */
export const PATCH_DIGEST_VERSION = 'pd1';

/** 证据目录（仓根锚定）。其下的改动不进摘要、不计行数与文件数。 */
export const EVIDENCE_PREFIX = 'docs/verify/';

/** 证据目录里会被当成可执行代码的扩展名（不分大小写）。 */
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

/** D4 保护类别 ①–③：任意层级、不分大小写。与 pr-gate.js 的 PROTECTED 同口径。 */
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
 * null；实测删除条目带旧 blob 的 sha（docs/verify/1404/compare-sample.json）。 */
export const compareFileSchema = z.object({
  status: z.enum(COMPARE_FILE_STATUSES),
  filename: z.string().min(1),
  previousFilename: z.string().min(1).nullable(),
  sha: z.string().nullable(),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
});
export type CompareFile = z.infer<typeof compareFileSchema>;
