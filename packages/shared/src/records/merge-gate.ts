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

/** blocker 的类别：policy = 策略或急停挡着；transient = 闸能自己等到或修到
 * （检查在跑、判定未齐、修复轮可处理）；human = 只能由人处理。 */
export const BLOCKER_CLASSES = ['policy', 'transient', 'human'] as const;
export type BlockerClass = (typeof BLOCKER_CLASSES)[number];

/** 全部 blocker，按固定顺序（readiness 按此排序，首个即 status 描述）。
 * 加码先在这里加，再给它写真假两腿测试（merge-gate-readiness.test.ts 的完整性
 * 断言会在缺腿时变红）。 */
export const MERGE_BLOCKERS = [
  // 策略
  { code: 'policy-human', class: 'policy', label: '项目策略为人工合并' },
  { code: 'autonomy-paused', class: 'policy', label: '自治合并已暂停' },
  { code: 'not-applicable', class: 'policy', label: '不是 GitHub PR 形态的构建' },
  // 车道状态
  { code: 'not-current-build', class: 'transient', label: '不是任务的当前构建' },
  { code: 'phase-not-review', class: 'transient', label: '任务不在审核关口' },
  { code: 'work-in-flight', class: 'transient', label: '还有步骤在跑' },
  // PR
  { code: 'pr-unreadable', class: 'transient', label: '读不到 PR 或仓库默认分支' },
  { code: 'pr-not-open', class: 'human', label: 'PR 已合并或已关闭' },
  { code: 'pr-draft', class: 'transient', label: 'PR 是草稿' },
  { code: 'pr-from-fork', class: 'human', label: 'PR 来自 fork' },
  { code: 'base-not-default', class: 'human', label: 'PR 的目标分支不是默认分支' },
  { code: 'mergeable-state', class: 'transient', label: 'GitHub 判定暂不可合并' },
  // 检查
  { code: 'self-required', class: 'human', label: 'pacman/merge-gate 被设成了必需检查' },
  { code: 'required-checks-unreadable', class: 'transient', label: '读不到必需检查清单' },
  { code: 'required-checks-none', class: 'human', label: '默认分支没有必需检查' },
  { code: 'required-check-missing', class: 'transient', label: '必需检查在当前 head 上缺席' },
  { code: 'required-check-pending', class: 'transient', label: '必需检查还在跑' },
  { code: 'required-check-failed', class: 'transient', label: '必需检查未通过' },
  { code: 'pr-evidence-not-green', class: 'transient', label: 'pr-evidence 未通过' },
  // 补丁
  // 摘要不可得分两类：compare 读不到可等（下一次巡检再读）；读到了却算不出
  // （截断、只有证据、缺 blob sha）等不来，留人。
  { code: 'patch-unavailable', class: 'transient', label: '读不到 compare，补丁摘要暂不可得' },
  { code: 'compare-truncated', class: 'human', label: 'compare 文件列表被截断' },
  {
    code: 'patch-unbindable',
    class: 'human',
    label: '补丁无法取摘要（证据之外没有文件，或有文件缺 blob sha）',
  },
  { code: 'size-cap', class: 'human', label: '补丁超过 800 行或 40 个文件' },
  { code: 'protected-path', class: 'human', label: '改动命中 D4 保护路径' },
  { code: 'outside-auto-merge', class: 'human', label: '改动在可自动合并集之外' },
  { code: 'test-deleted', class: 'human', label: '删除了测试' },
  // 没有 patch 就没有可读的 diff、也没有可信的行数；证据目录里的截图不算。
  {
    code: 'opaque-file',
    class: 'human',
    label: '证据目录外有看不到 diff 的文件（二进制、diff 过大或纯改名）',
  },
  { code: 'evidence-outside-ticket', class: 'human', label: '改动了别的票的证据目录' },
  { code: 'evidence-executable', class: 'human', label: '证据目录里新增或改动了可执行文件' },
  // 来源与证据
  { code: 'issue-ref-missing', class: 'human', label: '任务来源解不出 issue 号' },
  {
    code: 'evidence-link-missing',
    class: 'transient',
    label: 'PR body 缺指向本票证据的 raw 永久链',
  },
  // verify（当前摘要）
  { code: 'verify-missing', class: 'transient', label: '当前补丁没有验证判定' },
  { code: 'verify-failed', class: 'transient', label: '验证未通过' },
  { code: 'verify-extraction-failed', class: 'transient', label: '验证判定提取失败' },
  { code: 'verify-evidence-invalid', class: 'transient', label: '验证证据不在本票目录' },
  { code: 'verify-tampered', class: 'human', label: '验证者改了代码' },
  // 审核（当前摘要）
  { code: 'review-missing', class: 'transient', label: '有视角还没有审核判定' },
  { code: 'review-blocking', class: 'transient', label: '审核有 blocking 发现' },
  { code: 'review-extraction-failed', class: 'transient', label: '审核判定提取失败' },
  { code: 'perspective-timed-out', class: 'human', label: '审核视角超时' },
  // chief 小合并步（当前摘要）
  { code: 'decision-missing', class: 'transient', label: 'chief 还没有出 go/no-go' },
  { code: 'decision-no-go', class: 'transient', label: 'chief 判 no-go' },
  { code: 'decision-extraction-failed', class: 'transient', label: 'chief 判定提取失败' },
  // 轮次与人手
  { code: 'fix-rounds-exhausted', class: 'human', label: '修复轮用完' },
  { code: 'fix-no-change', class: 'human', label: '修复轮没有改动补丁' },
  { code: 'gate-rounds-exhausted', class: 'human', label: '闸轮次用完' },
  { code: 'no-reviewers', class: 'human', label: '团队没有可派的审核视角' },
  { code: 'no-verifier', class: 'human', label: '团队没有可派的验证者' },
  { code: 'no-decider', class: 'human', label: 'chief 没有可用的 agent' },
] as const satisfies readonly { code: string; class: BlockerClass; label: string }[];

export type MergeBlockerCode = (typeof MERGE_BLOCKERS)[number]['code'];
export const MERGE_BLOCKER_CODES = MERGE_BLOCKERS.map((b) => b.code) as MergeBlockerCode[];

export const mergeBlockerSchema = z.object({
  code: z.enum(MERGE_BLOCKER_CODES as [MergeBlockerCode, ...MergeBlockerCode[]]),
  class: z.enum(BLOCKER_CLASSES),
  label: z.string(),
  detail: z.array(z.string()),
});
export type MergeBlocker = z.infer<typeof mergeBlockerSchema>;

/** readiness 结果（快照、chief 工具、详情页同源）。ready ⇔ blockers 为空。 */
export const mergeReadinessSchema = z.object({
  ready: z.boolean(),
  headSha: z.string().nullable(),
  patchDigest: z.string().nullable(),
  policy: mergePolicySchema,
  blockers: z.array(mergeBlockerSchema),
});
export type MergeReadiness = z.infer<typeof mergeReadinessSchema>;
