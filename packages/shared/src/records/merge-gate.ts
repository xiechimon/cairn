import { z } from 'zod';

export const MERGE_POLICIES = ['human', 'shadow', 'autonomous'] as const;
export const mergePolicySchema = z.enum(MERGE_POLICIES);
export type MergePolicy = z.infer<typeof mergePolicySchema>;

export const MERGE_GATE_STATUS_CONTEXT = 'cairn/merge-gate';

export const GATE_LIMITS = {
  maxLines: 800,
  maxFiles: 40,
  compareFileCap: 300,
  fixRoundsMax: 2,
  roundsMax: 4,
  perspectiveDeadlineMs: 3_600_000,
  perspectiveRetries: 1,
} as const;

export const PATCH_DIGEST_VERSION = 'pd2';

export const EVIDENCE_PREFIX = 'docs/verify/';

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

export const AUTO_MERGE_PATH_GLOBS = [
  'apps/*/src/**',
  'apps/*/test/**',
  'apps/*/e2e/**',
  'packages/*/src/**',
  'packages/*/test/**',
  'integration/test/**',
  'docs/verify/**',
  'docs/**/*.md',
] as const;

export const PROTECTED_PATH_GLOBS = [
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
  'docs/lessons.md',
  'docs/agent-dispatch-prompts.md',
  'docs/adr/**',
  'docs/spec/**',
  '**/scripts/**',
  '**/*.config.*',
  '**/biome.json',
  '**/biome.jsonc',
  '**/tsconfig*.json',
  '**/.gitignore',
  '**/.gitattributes',
  '**/drizzle/**',
  '**/package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  '**/.npmrc',
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
  'integration/eval/**',
  '.claude/hillclimb/**',
  'apps/server/src/trajectory-export.ts',
  'apps/server/src/trajectory-export-cli.ts',
  'apps/server/src/trajectory-outcome.ts',
  'packages/shared/src/trajectory-pack.ts',
] as const;

export const MERGE_GATE_SOURCE_GLOBS = [
  'apps/server/src/services/merge-gate/**',
  'packages/shared/src/records/merge-gate.ts',
  'apps/daemon/src/merge-decision.ts',
] as const;

const CHIEF_DISPATCH_DIR = 'integration/eval/chief-dispatch';

export const CHIEF_DISPATCH_HARNESS_PATHS = [
  `${CHIEF_DISPATCH_DIR}/stack.mts`,
  'apps/daemon/src/backend/pi.ts',
  'apps/server/src/services/chief-tools.ts',
  'packages/shared/src/protocol/chief-tools.ts',
  `${CHIEF_DISPATCH_DIR}/grade.mts`,
  '.claude/hillclimb/chief-dispatch/cases.json',
  'apps/server/src/services/chief.ts',
  `${CHIEF_DISPATCH_DIR}/repo-seed/.github/workflows/ci.yml`,
  `${CHIEF_DISPATCH_DIR}/repo-seed/CHANGELOG.md`,
  `${CHIEF_DISPATCH_DIR}/repo-seed/Dockerfile`,
  `${CHIEF_DISPATCH_DIR}/repo-seed/README.md`,
  `${CHIEF_DISPATCH_DIR}/repo-seed/apps/daemon/package.json`,
  `${CHIEF_DISPATCH_DIR}/repo-seed/apps/server/README.md`,
  `${CHIEF_DISPATCH_DIR}/repo-seed/apps/server/package.json`,
  `${CHIEF_DISPATCH_DIR}/repo-seed/apps/server/src/auth.ts`,
  `${CHIEF_DISPATCH_DIR}/repo-seed/apps/server/src/export.ts`,
  `${CHIEF_DISPATCH_DIR}/repo-seed/apps/server/src/routes.ts`,
  `${CHIEF_DISPATCH_DIR}/repo-seed/apps/server/src/search.ts`,
  `${CHIEF_DISPATCH_DIR}/repo-seed/apps/server/src/tasks.ts`,
  `${CHIEF_DISPATCH_DIR}/repo-seed/apps/server/src/todos.ts`,
  `${CHIEF_DISPATCH_DIR}/repo-seed/apps/web/README.md`,
  `${CHIEF_DISPATCH_DIR}/repo-seed/apps/web/package.json`,
  `${CHIEF_DISPATCH_DIR}/repo-seed/apps/web/src/board.tsx`,
  `${CHIEF_DISPATCH_DIR}/repo-seed/apps/web/src/export-button.tsx`,
  `${CHIEF_DISPATCH_DIR}/repo-seed/apps/web/src/login.tsx`,
  `${CHIEF_DISPATCH_DIR}/repo-seed/apps/web/src/theme.ts`,
  `${CHIEF_DISPATCH_DIR}/repo-seed/docs/api.md`,
  `${CHIEF_DISPATCH_DIR}/repo-seed/docs/deploy.md`,
  `${CHIEF_DISPATCH_DIR}/repo-seed/docs/index.md`,
  `${CHIEF_DISPATCH_DIR}/repo-seed/docs/usage.md`,
  `${CHIEF_DISPATCH_DIR}/repo-seed/package.json`,
  `${CHIEF_DISPATCH_DIR}/repo-seed/packages/shared/README.md`,
  `${CHIEF_DISPATCH_DIR}/repo-seed/packages/shared/package.json`,
  `${CHIEF_DISPATCH_DIR}/repo-seed/packages/shared/src/protocol.ts`,
];

export const CHIEF_DISPATCH_BASELINE_DECISION_OK_CI_LOWER = 0.924;

export const HARNESS_REGRESSION_RESULT_NAME = 'harness-regression.json';

export const harnessRegressionResultSchema = z.object({
  patchDigest: z.string().min(1),
  harness_sha: z.string().regex(/^[0-9a-f]{64}$/),
  decision_ok: z.number().finite().min(0).max(1),
  trace_digest: z.string().regex(/^[0-9a-f]{64}$/),
});
export type HarnessRegressionResult = z.infer<typeof harnessRegressionResultSchema>;

export const COMPARE_FILE_STATUSES = [
  'added',
  'removed',
  'modified',
  'renamed',
  'copied',
  'changed',
  'unchanged',
] as const;

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

export const BLOCKER_CLASSES = ['policy', 'transient', 'human'] as const;
export type BlockerClass = (typeof BLOCKER_CLASSES)[number];

export const MERGE_BLOCKERS = [
  { code: 'policy-human', class: 'policy', label: '项目策略为人工合并' },
  { code: 'autonomy-paused', class: 'policy', label: '自治合并已暂停' },
  { code: 'daily-cap', class: 'policy', label: '当日自治合并数已达上限' },
  { code: 'not-applicable', class: 'policy', label: '不是 GitHub PR 形态的构建' },
  { code: 'not-current-build', class: 'transient', label: '不是任务的当前构建' },
  { code: 'phase-not-review', class: 'transient', label: '任务不在审核关口' },
  { code: 'work-in-flight', class: 'transient', label: '还有步骤在跑' },
  {
    code: 'pr-unreadable',
    class: 'transient',
    label: '读不到 PR 或仓库默认分支，或 PR 的 head 不是可用的 SHA',
  },
  { code: 'pr-not-open', class: 'human', label: 'PR 已合并或已关闭' },
  { code: 'pr-draft', class: 'transient', label: 'PR 是草稿' },
  { code: 'pr-behind-base', class: 'transient', label: 'PR 落后于目标分支或落后数未知' },
  { code: 'pr-from-fork', class: 'human', label: 'PR 来自 fork' },
  { code: 'base-not-default', class: 'human', label: 'PR 的目标分支不是默认分支' },
  { code: 'mergeable-state', class: 'transient', label: 'GitHub 判定暂不可合并' },
  { code: 'self-required', class: 'human', label: 'cairn/merge-gate 被设成了必需检查' },
  {
    code: 'required-checks-unreadable',
    class: 'transient',
    label: '读不到当前 head 的检查或必需检查清单',
  },
  { code: 'required-checks-none', class: 'human', label: '默认分支没有必需检查' },
  { code: 'required-check-missing', class: 'transient', label: '必需检查在当前 head 上缺席' },
  { code: 'required-check-pending', class: 'transient', label: '必需检查还在跑' },
  { code: 'required-check-failed', class: 'transient', label: '必需检查未通过' },
  { code: 'pr-evidence-not-green', class: 'transient', label: 'pr-evidence 未通过' },
  {
    code: 'patch-unavailable',
    class: 'transient',
    label: '读不到当前 head 的 compare，补丁摘要暂不可得',
  },
  {
    code: 'compare-malformed',
    class: 'human',
    label: 'compare 的响应形状不对，或它的 SHA（请求的 head、提交、父提交）写错',
  },
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
  {
    code: 'opaque-file',
    class: 'human',
    label: '证据目录外有看不到 diff 的文件（二进制、diff 过大或纯改名）',
  },
  { code: 'evidence-outside-ticket', class: 'human', label: '改动了别的票的证据目录' },
  { code: 'evidence-executable', class: 'human', label: '证据目录里新增或改动了可执行文件' },
  {
    code: 'harness-regression-missing',
    class: 'human',
    label: '改了 harness 但缺少绑定当前补丁的回归评测结果',
  },
  {
    code: 'harness-regression-stale',
    class: 'human',
    label: '回归评测结果绑定的补丁摘要不是当前补丁',
  },
  {
    code: 'harness-regression-below-threshold',
    class: 'human',
    label: '回归评测 decision_ok 低于基线置信区间下限',
  },
  { code: 'issue-ref-missing', class: 'human', label: '任务来源解不出 issue 号' },
  {
    code: 'evidence-link-missing',
    class: 'transient',
    label: 'PR body 缺钉在本 PR 提交上、指向本 PR 证据的 raw 永久链',
  },
  { code: 'verify-missing', class: 'transient', label: '当前补丁没有验证判定' },
  { code: 'verify-failed', class: 'transient', label: '验证未通过' },
  { code: 'verify-extraction-failed', class: 'transient', label: '验证判定提取失败' },
  { code: 'verify-evidence-invalid', class: 'transient', label: '验证证据不在本票目录' },
  { code: 'verify-tampered', class: 'human', label: '验证者改了代码' },
  { code: 'review-missing', class: 'transient', label: '有视角还没有审核判定' },
  { code: 'review-blocking', class: 'transient', label: '审核有 blocking 发现' },
  { code: 'review-extraction-failed', class: 'transient', label: '审核判定提取失败' },
  { code: 'perspective-timed-out', class: 'human', label: '审核视角超时' },
  { code: 'decision-missing', class: 'transient', label: 'chief 还没有出 go/no-go' },
  { code: 'decision-no-go', class: 'transient', label: 'chief 判 no-go' },
  { code: 'decision-extraction-failed', class: 'transient', label: 'chief 判定提取失败' },
  { code: 'fix-rounds-exhausted', class: 'human', label: '修复轮用完' },
  { code: 'fix-no-change', class: 'human', label: '修复轮没有改动补丁' },
  { code: 'gate-rounds-exhausted', class: 'human', label: '闸轮次用完' },
  { code: 'no-reviewers', class: 'human', label: '团队没有可派的审核视角' },
  { code: 'no-verifier', class: 'human', label: '团队没有可派的验证者' },
  { code: 'no-decider', class: 'human', label: 'chief 没有可用的 agent' },
] as const satisfies readonly { code: string; class: BlockerClass; label: string }[];

export type MergeBlockerCode = (typeof MERGE_BLOCKERS)[number]['code'];
export const MERGE_BLOCKER_CODES = MERGE_BLOCKERS.map((b) => b.code) as readonly MergeBlockerCode[];

export const mergeBlockerSchema = z.object({
  code: z.enum(MERGE_BLOCKER_CODES as readonly [MergeBlockerCode, ...MergeBlockerCode[]]),
  class: z.enum(BLOCKER_CLASSES),
  label: z.string(),
  detail: z.array(z.string()),
});
export type MergeBlocker = z.infer<typeof mergeBlockerSchema>;

export const mergeReadinessSchema = z.object({
  ready: z.boolean(),
  headSha: z.string().nullable(),
  patchDigest: z.string().nullable(),
  policy: mergePolicySchema,
  blockers: z.array(mergeBlockerSchema),
});
export type MergeReadiness = z.infer<typeof mergeReadinessSchema>;

for (const value of [
  MERGE_POLICIES,
  GATE_LIMITS,
  EVIDENCE_EXECUTABLE_EXTENSIONS,
  AUTO_MERGE_PATH_GLOBS,
  PROTECTED_PATH_GLOBS,
  MERGE_GATE_SOURCE_GLOBS,
  CHIEF_DISPATCH_HARNESS_PATHS,
  COMPARE_FILE_STATUSES,
  BLOCKER_CLASSES,
  ...MERGE_BLOCKERS,
  MERGE_BLOCKERS,
  MERGE_BLOCKER_CODES,
]) {
  Object.freeze(value);
}
