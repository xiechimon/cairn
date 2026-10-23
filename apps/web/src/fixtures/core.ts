// Fixture data — content copied verbatim from the r7 capture session
// (docs/research/r7-rebaseline.md §5): probe #9, r3 legacy #1/#2, project
// and team identifiers, branch strings, 13:21/13:35 timestamps. The #1/#2
// titles were extracted from captures 01/01b by glyph template matching
// (glyph template matching) in #54; all other strings come from the research
// records.
//
// Shared canon: identifiers, timestamp helpers and the base todo/project
// records every other fixture module builds on.

import {
  conversationBranch,
  derivePlaceholderTitle,
  PLACEHOLDER_TITLE_FALLBACK,
} from '@cairn/shared';
import type {
  BranchInfoContent,
  ProjectContent,
  RunHistoryRow,
  TodoRecord,
  TokenUsageContent,
} from './records.js';

export const TEAM_ID = 'BoZYfvqKSGanlxsXVbXSa';
export const TEAM_NAME = "Xmon Dai's team";
export const PROJECT_ID = 'ZAQczKCu0MOAzC1ZqcFlX';
export const PROJECT_NAME = 'r3-lifecycle';
/** Sidebar/card project avatar initial (r2 §1.1 首字母头像). */
export const PROJECT_INITIAL = 'r';
export const USER_NAME = 'Xmon Dai';
export const MACHINE_NAME = 'xmonsMac-3574.local';
export const MACHINE_ID = 'TlZ2sSD4EJCxjNJqVhdo_';
/** #1259 归属机级联的第二台 fixture 机（remote，双 runtime 开）：claude-code
 *  模型段挂它——canon 本机保持 pi-only（machines-local 的亮度分态 canon
 *  不动）。 */
export const MACHINE_REMOTE_ID = 'Kd8fG2hJ4mN9pQ1rStUvWx3';
export const MACHINE_REMOTE_NAME = 'mea-wsl';
export const R7_BUILD_ID = '01a0c26e-23ea-734f-9847-cf9cdbce7802';
export const R7_BUILD_BRANCH = conversationBranch(R7_BUILD_ID);
/** Target commit of the probe's build branch (r7 31 分支与PR overlay). */
export const R7_TARGET_COMMIT = '2cceb9dbf7a8';

/** Agent model suffix on the chip popover's 执行对话 row (r7 19 verbatim:
 *  `r3-builder · claude-sonnet-5 · 默认`). */
export const AGENT_MODEL_LINE = 'claude-sonnet-5 · 默认';

/** Token 用量 overlay of probe #9 (r7 30): cumulative-run calibre per r7
 *  §4.1.6 — the dialog totals the whole conversation, the 运行历史 row
 *  counts single runs (38.3k there vs 82.9k here). */
export const PROBE_TOKEN_USAGE: TokenUsageContent = {
  total: '82.9k',
  model: 'r3-gw/claude-sonnet-5',
  modelTotal: '82.9k',
  input: '12',
  output: '854',
  cacheRead: '54.2k',
  cacheWrite: '27.8k',
  cacheHitRate: '100%',
};

/** 分支与 PR overlay of probe #9 (r7 31), sync tab as captured. */
export const PROBE_BRANCH_INFO: BranchInfoContent = {
  branch: R7_BUILD_BRANCH,
  commit: R7_TARGET_COMMIT,
  machine: MACHINE_NAME,
  directory: '~/preview/project',
};

/** 运行历史 overlay of probe #9 (r7 32): single-row state, `重跑` is a
 *  hover-only control and absent from the capture (r7 §4.1.5). */
export const PROBE_RUN_HISTORY: RunHistoryRow[] = [
  { label: '第 1 次运行', meta: '12 分钟前 · 38.3k tokens', status: 'current' },
];

/** Timestamp helper: absolute date at +08:00, whole minutes. */
export const at = (date: string, h: number, m: number) =>
  Date.parse(`${date}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00+08:00`);

/** r7 capture day. */
export const R7_DAY = '2026-09-21';
/** r3 session day (legacy #1/#2 live dates). */
export const R3_DAY = '2026-09-19';

/** r7 capture-day timestamp. */
export const r7 = (h: number, m: number) => at(R7_DAY, h, m);

/** r8 capture day. */
export const R8_DAY = '2026-09-22';
/** r8 capture-day timestamp. */
export const r8 = (h: number, m: number) => at(R8_DAY, h, m);

export const R3_BUILDER = { id: 'r3-builder', displayName: 'r3-builder' };

/** r3 legacy #1: review phase, waiting on the user's reply — card renders in
 *  执行中 with a transparent 回复 button (r5b §3.15, r7 01). */
export const legacyReview: TodoRecord = {
  id: 'r3-legacy-1',
  teamId: TEAM_ID,
  projectId: PROJECT_ID,
  title: '在 README.md 末尾追加一行「r3 lifecycle probe」',
  spec: '在 README.md 末尾追加一行「r3 lifecycle probe」。',
  phase: 'review',
  phaseAt: at(R3_DAY, 14, 31),
  seqNum: 1,
  orderIndex: 0,
  tagIds: [],
  assignment: { agentId: R3_BUILDER.id },
  agent: R3_BUILDER,
  latestBuildId: 'r3-conv-legacy-1',
  lastRunAt: at(R3_DAY, 14, 30),
  // capture 01 shows no 方案/变更 metric icons on this card
  hasChanges: false,
  hasPlan: false,
  buildHistory: [{ buildId: 'r3-conv-legacy-1', createdAt: at(R3_DAY, 13, 5) }],
  sourceTodo: null,
  v: 3,
  awaitingReply: true,
};

/** r3 legacy #2: done (r7 01b last column, `2 天前`). */
export const legacyDone: TodoRecord = {
  id: 'r3-legacy-2',
  teamId: TEAM_ID,
  projectId: PROJECT_ID,
  title: '在 README.md 末尾追加一行「r3 lifecycle probe2」',
  spec: '在 README.md 末尾追加一行「r3 lifecycle probe2」。',
  phase: 'done',
  phaseAt: at(R3_DAY, 15, 5),
  seqNum: 2,
  orderIndex: 0,
  tagIds: [],
  assignment: { agentId: R3_BUILDER.id },
  agent: R3_BUILDER,
  latestBuildId: 'r3-conv-legacy-2',
  lastRunAt: at(R3_DAY, 14, 50),
  hasChanges: true,
  hasPlan: true,
  buildHistory: [{ buildId: 'r3-conv-legacy-2', createdAt: at(R3_DAY, 14, 43) }],
  sourceTodo: null,
  v: 4,
};

/** r7 probe #9 (id 7ve0iOkQ-JBpSL98zSiGc) — phase varies per scenario. */
export const PROBE_ID = '7ve0iOkQ-JBpSL98zSiGc';

export function probeTodo(phase: TodoRecord['phase'], phaseAt: number): TodoRecord {
  return {
    id: PROBE_ID,
    teamId: TEAM_ID,
    projectId: PROJECT_ID,
    title: '在 README.md 末尾追加一行「r7 rebaseline probe」',
    spec: '在 README.md 末尾追加一行「r7 rebaseline probe」',
    phase,
    phaseAt,
    seqNum: 9,
    orderIndex: 0,
    tagIds: [],
    assignment: { agentId: R3_BUILDER.id },
    agent: R3_BUILDER,
    latestBuildId: phase === 'todo' ? null : R7_BUILD_ID,
    lastRunAt: phase === 'todo' ? null : r7(13, 21),
    hasChanges: phase === 'review' || phase === 'done',
    // r7 02/21 (confirm) and 33 (review) show the 方案 icon; 35 (done) shows
    // the 变更 icon alone on #9's card — plan-icon presence is modelled per
    // phase, dropping at done. r3 #2 (01b, done) keeps both icons, so the
    // flag stays per-todo data, not a phase rule.
    hasPlan: phase === 'confirm' || phase === 'review',
    buildHistory: phase === 'todo' ? [] : [{ buildId: R7_BUILD_ID, createdAt: r7(13, 21) }],
    sourceTodo: null,
    v: 2,
  };
}

/** r7 dark fresh probe #10 — created 13:55, captured immediately, deleted
 *  right after (r7 §5). id is synthetic: the record never survived the
 *  session ([推断] identifier, content verbatim from the 22d capture). */
export const darkFreshProbe: TodoRecord = {
  id: 'r7-dark-fresh-probe-10',
  teamId: TEAM_ID,
  projectId: PROJECT_ID,
  title: 'r7-dark-fresh 探针（拍完即删）',
  spec: 'r7-dark-fresh 探针（拍完即删）',
  phase: 'todo',
  phaseAt: r7(13, 55),
  seqNum: 10,
  orderIndex: 0,
  tagIds: [],
  assignment: null,
  agent: null,
  latestBuildId: null,
  lastRunAt: null,
  hasChanges: false,
  hasPlan: false,
  buildHistory: [],
  sourceTodo: null,
  v: 2,
};

/** Repo surface of the fixture project (r2 07e/24/24c read off the
 *  r3-lifecycle hosted repo): main branch, single README.md row. The
 *  历史 rows (#149, [设计] content — no capture) mirror the hosted repo
 *  lifecycle: the server seed commit (`init <repoName>`, services/git.ts)
 *  plus one merged work commit, newest first against the r7 clock. */
export const projectContent: ProjectContent = {
  name: PROJECT_NAME,
  branch: 'main',
  files: ['README.md'],
  repoName: PROJECT_NAME,
  hosted: true,
  defaultBranch: 'main',
  description: null,
  // #202 文件查看器 fixture 供肉:e2e 断言锚 = 「托管演示仓」行。
  fileContents: {
    'README.md': [
      `# ${PROJECT_NAME}`,
      '',
      '托管演示仓:任务全生命周期走查(待开始 → 规划中 → 待确认 → 执行中 → 待验收 → 已完成)。',
      '',
    ].join('\n'),
  },
  commits: [
    {
      id: 'f3d9c1b7a2e5480db6c1a9f0e2d7b4c8a1e5f903',
      shortSha: 'f3d9c1b',
      message: 'docs: README',
      authorName: 'r3-builder',
      at: r7(11, 2),
      // #1102 详情面 fixture 供肉：README.md 全文件新增（wire 形，行带 +
      // 前缀 = parseUnifiedDiff 输出契约；与 fileContents 的 README 同文）。
      files: [
        {
          path: 'README.md',
          additions: 3,
          deletions: 0,
          hunks: [
            {
              header: '@@ -0,0 +1,3 @@',
              lines: [
                `+# ${PROJECT_NAME}`,
                '+',
                `+托管演示仓:任务全生命周期走查(待开始 → 规划中 → 待确认 → 执行中 → 待验收 → 已完成)。`,
              ],
            },
          ],
        },
      ],
    },
    {
      id: '0a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d',
      shortSha: '0a1b2c3',
      message: `init ${PROJECT_NAME}`,
      authorName: 'Cairn',
      at: r7(9, 41),
      // 种子提交 = 空树（provisionHostedRepo seedInitialCommit 真值同形）：
      // files:[] 定义态——fixture 故事与服务端行为不漂移。
      files: [],
    },
  ],
}; /** Client-created todo of the fixture phase (#66 new-task dialog): lands
 *  in 待开始 with the 刚刚 label against the fixture clock (r2 §4.2/§5.2).
 *  Record shape lives here with every other TodoRecord factory.
 *  spec 15 #394：入参 = 正文（对话框单字段）；标题 = shared 占位派生规则，
 *  与 server createTodo 同形（fixture/live 行为不漂移）。 */
export function localTodo(seqNum: number, spec: string, now: number): TodoRecord {
  return {
    id: `local-${seqNum}`,
    teamId: TEAM_ID,
    projectId: PROJECT_ID,
    title: derivePlaceholderTitle(spec) || PLACEHOLDER_TITLE_FALLBACK,
    spec,
    phase: 'todo',
    phaseAt: now,
    seqNum,
    orderIndex: 0,
    tagIds: [],
    assignment: null,
    agent: null,
    latestBuildId: null,
    lastRunAt: null,
    hasChanges: false,
    hasPlan: false,
    buildHistory: [],
    sourceTodo: null,
    v: 2,
  };
}
