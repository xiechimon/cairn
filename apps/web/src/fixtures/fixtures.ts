// Fixture data — content copied verbatim from the r7 capture session
// (docs/research/r7-rebaseline.md §5): probe #9, r3 legacy #1/#2, project
// and team identifiers, branch strings, 13:21/13:35 timestamps. The #1/#2
// titles were extracted from captures 01/01b by glyph template matching
// (glyph template matching) in #54; all other strings come from the research
// records.

import {
  type AgentRecord,
  type AgentTask,
  BRAND,
  conversationBranch,
  derivePlaceholderTitle,
  FIXED_TAGS,
  type MemoryRecord,
  type ModelSource,
  maskApiKey,
  PLACEHOLDER_TITLE_FALLBACK,
  type SecretRecord,
} from '@pacman/shared';
import { diffLines } from 'diff';
import type {
  ApiKeyRecord,
  BranchInfoContent,
  BuildOverlayContent,
  ChangesContent,
  ChiefContent,
  ChiefExample,
  ChiefSettingsTab,
  ChiefThreadRef,
  DiffHunk,
  DiffLine,
  DocBlock,
  FixtureSet,
  PlanDiffContent,
  ProjectContent,
  ResourcesContent,
  RunHistoryRow,
  ScheduleRecord,
  TeamContent,
  TodoRecord,
  TokenUsageContent,
  TranscriptItem,
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
export const R7_BUILD_ID = '01a0c26e-23ea-734f-9847-cf9cdbce7802';
export const R7_BUILD_BRANCH = conversationBranch(R7_BUILD_ID);
/** Target commit of the probe's build branch (r7 31 分支与PR overlay). */
export const R7_TARGET_COMMIT = '2cceb9dbf7a8';

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

const R3_BUILDER = { id: 'r3-builder', displayName: 'r3-builder' };

/** r3 legacy #1: review phase, waiting on the user's reply — card renders in
 *  执行中 with a transparent 回复 button (r5b §3.15, r7 01). */
const legacyReview: TodoRecord = {
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
const legacyDone: TodoRecord = {
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

function probeTodo(phase: TodoRecord['phase'], phaseAt: number): TodoRecord {
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
const darkFreshProbe: TodoRecord = {
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
      authorName: 'Pacman',
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
/** Board default: only the r3 legacy pair (r7 01/35). Captured before the
 *  probe existed, ~13:10–13:21. Carries the project repo surface and an
 *  empty schedule list so the #71 routes also render in scenario-blind
 *  production builds (resolveScenario falls back here). */
export const boardDefault: FixtureSet = {
  todos: [legacyReview, legacyDone],
  now: r7(13, 14),
  schedules: [],
  project: projectContent,
};

/** #176 项目选择器面(new-task dialog 项目 chip 下拉):boardDefault 面加
 *  projectNames 双项目——r3-lifecycle + r2-inventory(24b 注记的 r2 会话第
 *  二项目),给选择器多行数据位(records.ts projectNames = 卡面/搜索/新建
 *  dialog 的项目名位)。命名场景无 capture:e2e 钉选择器行为,fixture 侧
 *  开态行(#229 dlg-newtask-project-*)无官方基线,走 smoke + expectText。 */
export const boardProjectPicker: FixtureSet = {
  ...boardDefault,
  projectNames: {
    [PROJECT_ID]: PROJECT_NAME,
    'r2-inventory': 'r2-inventory',
  },
};

/** #758 机器 chip 选择记忆命名场景（无 capture，newtask-projects 先例）：
 *  boardDefault 面 + resources 两台机器——在线本机（canon 同源）+ 离线远端，
 *  记忆面 e2e 的行源（选→刷新→回上次那台 / 悬空记忆落回自动 / 离线机器
 *  保留记忆如实显示）。只服务对话框的机器 chip，不动 resourcesDefault 的
 *  r7 06–10 capture 行集。 */
export const boardMachinePicker: FixtureSet = {
  ...boardDefault,
  resources: {
    skills: [],
    mcpServers: [],
    machines: [
      { id: MACHINE_ID, kind: 'local', name: MACHINE_NAME, online: true },
      { id: 'mea-wsl-offline', kind: 'remote', name: 'mea-wsl', online: false },
    ],
    providerSources: [],
  },
};

/** #361 GitHub repo picker 命名场景（无 capture，newtask-projects 先例）：
 *  boardDefault 面 + 已连接 github fixture——picker 行 = shared
 *  GithubRepoSummary 封套同形（spec 12 数据契约），搜索/单选/断开的面数据源。 */
export const boardGithubPicker: FixtureSet = {
  ...boardDefault,
  github: {
    connected: true,
    login: 'octocat',
    scope: 'read:user,repo',
    repos: [
      {
        id: 901,
        owner: 'octocat',
        name: 'hello-world',
        full_name: 'octocat/hello-world',
        private: false,
      },
      {
        id: 902,
        owner: 'octocat',
        name: 'spoon-knife',
        full_name: 'octocat/spoon-knife',
        private: true,
      },
      {
        id: 903,
        owner: 'xiechimon',
        name: 'pacman',
        full_name: 'xiechimon/pacman',
        private: true,
      },
    ],
  },
};

/** #403 看板标签筛选命名场景（无 capture，newtask-projects 先例）。tag 行
 *  = 固定词表六行的 fixture 投影（id 合成 `tag-<name>`，name/color 从
 *  FIXED_TAGS 单源派生——词表改动两侧同步，不手抄色值）。 */
const tagFilterRows = FIXED_TAGS.map((t) => ({
  id: `tag-${t.name}`,
  name: t.name,
  color: t.color,
}));

/** 筛选探针卡工厂：probeTodo 全形底 + 合成 id/seq/标题/tagIds（命名场景
 *  合成内容，无 capture 基线）。phaseAt 走 r7 时刻序，now 钉 13:55。 */
function tagFilterProbe(
  id: string,
  seqNum: number,
  title: string,
  phase: TodoRecord['phase'],
  tagIds: string[],
): TodoRecord {
  return { ...probeTodo(phase, r7(13, 40)), id, seqNum, title, spec: title, tagIds };
}

/** #753 拖动矩阵探针卡工厂：probeTodo 全形底 + 合成 id/seq/标题 + 数据位
 *  覆写（hasChanges 等——矩阵的合法边吃卡面数据，不只吃相位）。命名场景
 *  合成内容，无 capture 基线（board-tags 先例）。 */
function dragMatrixProbe(
  id: string,
  seqNum: number,
  title: string,
  phase: TodoRecord['phase'],
  over?: Partial<TodoRecord>,
): TodoRecord {
  return { ...probeTodo(phase, r7(13, 40)), id, seqNum, title, spec: title, tagIds: [], ...over };
}

/** board-drag-matrix（#753）：四列满员 + 待处理三相（failed 钉顶 / review+
 *  awaitingReply 钉顶 / confirm）+ 已完成两态（有变更 = 待处理合法源，无变更
 *  = 待处理非法源）——e2e 钉 per-source 合法目标矩阵、非法对零提交与
 *  done→pending 重开落位（写 review，落非钉顶组尾部）。 */
export const boardDragMatrix: FixtureSet = {
  ...boardDefault,
  todos: [
    dragMatrixProbe('dm-todo', 51, 'dragmatrix 探针（待开始）', 'todo'),
    dragMatrixProbe('dm-building', 52, 'dragmatrix 探针（执行中）', 'building'),
    dragMatrixProbe('dm-failed', 53, 'dragmatrix 探针（失败）', 'failed', { hasChanges: true }),
    dragMatrixProbe('dm-review', 54, 'dragmatrix 探针（待验收）', 'review', {
      awaitingReply: true,
    }),
    dragMatrixProbe('dm-confirm', 55, 'dragmatrix 探针（待确认）', 'confirm'),
    dragMatrixProbe('dm-done-changes', 56, 'dragmatrix 探针（已完成·有变更）', 'done'),
    dragMatrixProbe('dm-done-plain', 57, 'dragmatrix 探针（已完成·无变更）', 'done', {
      hasChanges: false,
    }),
  ],
  now: r7(13, 55),
};

/** board-reset-gate（#755）：拖回待开始的确认闸面——started 卡（执行中 /
 *  已完成有变更，探针底自带构建历史）落待开始开 dialog；零历史卡（待确认 /
 *  已完成无历史四位全清）走静默改相。合成内容，无 capture 基线（board-tags
 *  先例）。 */
const resetGateProbe = (
  id: string,
  seqNum: number,
  title: string,
  phase: TodoRecord['phase'],
  over?: Partial<TodoRecord>,
): TodoRecord => ({
  ...dragMatrixProbe(id, seqNum, title, phase),
  latestBuildId: null,
  lastRunAt: null,
  hasChanges: false,
  hasPlan: false,
  buildHistory: [],
  ...over,
});

export const boardResetGate: FixtureSet = {
  ...boardDefault,
  todos: [
    dragMatrixProbe('rg-todo', 61, 'resetgate 探针（待开始）', 'todo'),
    dragMatrixProbe('rg-building', 62, 'resetgate 探针（执行中·有历史）', 'building'),
    dragMatrixProbe('rg-done-history', 63, 'resetgate 探针（已完成·有变更）', 'done'),
    resetGateProbe('rg-confirm-fresh', 64, 'resetgate 探针（待确认·零历史）', 'confirm'),
    resetGateProbe('rg-done-fresh', 65, 'resetgate 探针（已完成·零历史）', 'done'),
  ],
  now: r7(13, 55),
};

/** board-tags：跨列三卡——bug 待开始 / docs 执行中 / 无标签 待处理。
 *  e2e 钉筛选开/关/切换/URL 携带与「无标签恒可见」裁决面。 */
export const boardTagFilter: FixtureSet = {
  ...boardDefault,
  todos: [
    tagFilterProbe('tagfilter-bug', 41, 'tagfilter 探针（bug）', 'todo', ['tag-bug']),
    tagFilterProbe('tagfilter-docs', 42, 'tagfilter 探针（docs）', 'building', ['tag-docs']),
    tagFilterProbe('tagfilter-plain', 43, 'tagfilter 探针（无标签）', 'review', []),
  ],
  now: r7(13, 55),
  tags: tagFilterRows,
};

/** board-tags-empty：两卡全 tagged（bug/docs）——选中两词之外任一（如
 *  chore）即触发板级空结果态（无标签卡不在场，收窄才能见底）。 */
export const boardTagFilterEmpty: FixtureSet = {
  ...boardDefault,
  todos: [
    tagFilterProbe('tagfilter-e-bug', 44, 'tagfilter 空态探针（bug）', 'todo', ['tag-bug']),
    tagFilterProbe('tagfilter-e-docs', 45, 'tagfilter 空态探针（docs）', 'building', ['tag-docs']),
  ],
  now: r7(13, 55),
  tags: tagFilterRows,
};

/** #445 仓库筛选探针卡工厂：tagFilterProbe 同式，多带 projectId 位。 */
function repoFilterProbe(
  id: string,
  seqNum: number,
  title: string,
  phase: TodoRecord['phase'],
  projectId: string,
  tagIds: string[],
): TodoRecord {
  return { ...probeTodo(phase, r7(13, 40)), id, seqNum, title, spec: title, projectId, tagIds };
}

/** #445 看板仓库筛选命名场景（无 capture，board-tags 先例）：三项目——
 *  canon r3-lifecycle 两卡（bug tagged 待开始 / 无标签 待处理）+
 *  r2-inventory 一卡（docs tagged 执行中）+ r4-quiet 零卡（选中即触发
 *  板级空结果态）。projectNames 在场 = fixture 面仓库筛选渲染门；tags
 *  同场 = 类型轴/卡片标签 chip 与仓库轴的组合收窄可钉。 */
export const boardRepoFilter: FixtureSet = {
  ...boardDefault,
  projectNames: {
    [PROJECT_ID]: PROJECT_NAME,
    'r2-inventory': 'r2-inventory',
    'r4-quiet': 'r4-quiet',
  },
  todos: [
    repoFilterProbe('repofilter-a', 46, 'repofilter 探针 A（r3·bug）', 'todo', PROJECT_ID, [
      'tag-bug',
    ]),
    repoFilterProbe(
      'repofilter-b',
      47,
      'repofilter 探针 B（r2·docs）',
      'building',
      'r2-inventory',
      ['tag-docs'],
    ),
    repoFilterProbe('repofilter-c', 48, 'repofilter 探针 C（r3·无标签）', 'review', PROJECT_ID, []),
  ],
  now: r7(13, 55),
  tags: tagFilterRows,
};

/** #504 溢出探针卡工厂：tagFilterProbe 同式（无标签、单项目，滚动面不
 *  引入筛选变量）。同列 orderIndex 递增 = sortColumnTodos 序位即数组序。 */
function overflowProbe(id: string, seqNum: number, title: string): TodoRecord {
  return { ...probeTodo('todo', r7(13, 40)), id, seqNum, title, spec: title };
}

/** #504 看板列滚动命名场景（无 capture，board-tags 先例）：待开始 12 卡
 *  ——732 高视口下列高约 660、卡高约 112 + gap 8，五张即触底，12 张保证
 *  溢出约一屏。e2e 钉行高不破视口、列头固定、列表自持滚动。 */
export const boardOverflow: FixtureSet = {
  ...boardDefault,
  todos: Array.from({ length: 12 }, (_, i) =>
    overflowProbe(`overflow-${String(i + 1).padStart(2, '0')}`, 51 + i, `溢出探针 #${i + 1}`),
  ),
  now: r7(13, 55),
};

/** #692 压力探针卡工厂（无 capture，overflowProbe 先例）：相位可指定，
 *  同式无标签、单项目。orderIndex 递增 = 列视图序即数组序。 */
function stressProbe(
  id: string,
  seqNum: number,
  title: string,
  phase: TodoRecord['phase'],
): TodoRecord {
  return { ...probeTodo(phase, r7(13, 40)), id, seqNum, title, spec: title };
}

/** #692 看板最坏数据命名场景（无 capture，board-overflow 先例）：
 *  待开始 = 超长混排标题（不可断行拉丁长词 + 长路径），执行中 = 120 卡
 *  （三位数列头计数 + 列表纵溢出），待处理 = 空列，已完成 = 常规卡。
 *  e2e 在 ⌘J 停靠 / 窄窗 / RTL 下钉「列不塌、卡可读、列头不溢出」。 */
export const boardStress: FixtureSet = {
  ...boardDefault,
  todos: [
    stressProbe(
      'stress-title',
      51,
      '重构 SuperCalendarUnavailableNamespaceController 并同步 docs/2026-09-30-architecture-decision-records/supplementary-review-notes.md 里的全部引用路径与脚注编号',
      'todo',
    ),
    ...Array.from({ length: 120 }, (_, i) =>
      stressProbe(
        `stress-build-${String(i + 1).padStart(3, '0')}`,
        100 + i,
        `批量探针 #${i + 1}`,
        'building',
      ),
    ),
    stressProbe('stress-done', 900, '常规完成卡', 'done'),
  ],
  now: r7(13, 55),
};

/** Board with the probe in the given phase (r7 02/22/21/33 …). The dark
 *  board pair (02/02b) shows `9 分钟前` on the confirm card → captured
 *  ~13:35 with phaseAt 13:26. Done-phase boards (35/35d) list #9 ahead of
 *  #2 in the 已完成 column (r7 35, #9 card first at y94). */
export function boardWithProbe(
  phase: TodoRecord['phase'],
  phaseAt: number,
  now: number,
): FixtureSet {
  const probe = probeTodo(phase, phaseAt);
  const todos =
    phase === 'done' ? [legacyReview, probe, legacyDone] : [legacyReview, legacyDone, probe];
  return { todos, now };
}

/** #67 results-state capture day (05b supplementary shot, 2026-09-22
 *  23:21 +08:00) — the r5 Chief observation session (#46) left probes
 *  #11–#14 on the board and the r3 legacy pair aged to `5 小时前` /
 *  `3 天前`. Titles/seqs/phases verbatim from the 05b capture. */
/** Agent model suffix on the chip popover's 执行对话 row (r7 19 verbatim:
 *  `r3-builder · claude-sonnet-5 · 默认`). */
export const AGENT_MODEL_LINE = 'claude-sonnet-5 · 默认';

const CHIEF_DAY = '2026-09-22';
const chief = (h: number, m: number) => at(CHIEF_DAY, h, m);
const CHIEF_NOW = chief(23, 21);
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

function chiefProbe(
  seqNum: number,
  title: string,
  phase: TodoRecord['phase'],
  phaseAt: number,
): TodoRecord {
  return {
    id: `chief-${seqNum}`,
    teamId: TEAM_ID,
    projectId: PROJECT_ID,
    title,
    spec: title,
    phase,
    phaseAt,
    seqNum,
    orderIndex: 0,
    tagIds: [],
    assignment: { agentId: R3_BUILDER.id },
    agent: R3_BUILDER,
    latestBuildId: `chief-conv-${seqNum}`,
    lastRunAt: phaseAt,
    hasChanges: phase === 'review' || phase === 'done',
    hasPlan: phase !== 'done',
    buildHistory: [{ buildId: `chief-conv-${seqNum}`, createdAt: phaseAt }],
    sourceTodo: null,
    v: 2,
  };
}

/** Board behind the 05b search-results capture: 执行中 #12 (failed),
 *  待验收 #1 + #13, 已完成 #14/#11/#2 — column order as captured (#1
 *  above #13 despite the lower seq: card order is fixture order). */
export const boardChiefProbes: FixtureSet = {
  todos: [
    chiefProbe(
      12,
      'README 文档目录 + 新建 CHANGELOG.md + scripts/hello.js',
      'failed',
      CHIEF_NOW - 5 * HOUR_MS - 2 * 60_000,
    ),
    // #1 sits in 待验收 with a 完成 button in the 05b capture — the chief
    // session answered it, so the waiting-on-user flag is gone by then
    { ...legacyReview, phaseAt: CHIEF_NOW - 5 * HOUR_MS - 2 * 60_000, awaitingReply: false },
    chiefProbe(
      13,
      '给 README.md 增加「项目结构」一节并链接贡献指南',
      'review',
      CHIEF_NOW - 5 * HOUR_MS - 2 * 60_000,
    ),
    chiefProbe(14, '给 index.html 的页面标题加上项目名后缀', 'done', CHIEF_NOW - 5 * HOUR_MS),
    chiefProbe(11, '编写 CONTRIBUTING.md 贡献指南', 'done', CHIEF_NOW - 5 * HOUR_MS),
    { ...legacyDone, phaseAt: CHIEF_NOW - 3 * DAY_MS - 2 * 60_000 },
  ],
  now: CHIEF_NOW,
  usageNav: true,
};

/** r7 22d: board at ~13:55 — #10 fresh (刚刚), #9 already done (13:52),
 *  r3 legacy pair untouched. */
export const boardDarkFresh: FixtureSet = {
  todos: [legacyReview, legacyDone, probeTodo('done', r7(13, 52)), darkFreshProbe],
  now: r7(13, 55),
};

/** r7 probe #10 — the dark fresh capture (23d) is a separate throwaway
 *  todo: title/seq/creation time all read off that bitmap. */
const probe10: TodoRecord = {
  ...probeTodo('todo', r7(13, 40)),
  id: 'r7-probe-10',
  title: 'r7-dark-fresh 探针（拍完即删）',
  spec: 'r7-dark-fresh 探针（拍完即删）',
  seqNum: 10,
};

/** Plan document of probe #9, verbatim from the r7 17 doc pane except for the
 *  section labels: XMON-55 P2 promotes the four canon sections (PLAN_SECTIONS)
 *  from body-weight lines to `.doc-block--head`, so the four `label:` paras the
 *  r7 capture froze as plain text are now head blocks with their remainder
 *  trailing — what mapPlanDoc's planSectionHead does to the live wire text. */
const PROBE_PLAN_DOC: DocBlock[] = [
  { kind: 'head', segments: [{ text: 'Context' }] },
  {
    kind: 'para',
    segments: [
      {
        text: '仓库根目录的 README.md 当前末尾一行为 "r6 rebaseline probe"(文件以换行符结尾)。需求是在文件末尾追加新的一行 "r7 rebaseline probe"。',
      },
    ],
  },
  { kind: 'head', segments: [{ text: 'Changes' }] },
  {
    kind: 'bullet',
    segments: [
      {
        text: 'README.md:在文件末尾追加一行新内容 "r7 rebaseline probe",保持与现有行一致的格式(纯文本行,行尾换行符),不改动文件中已有的其他内容。',
      },
    ],
  },
  { kind: 'head', segments: [{ text: 'Edge cases' }] },
  { kind: 'para', segments: [{ text: '无。' }] },
  { kind: 'head', segments: [{ text: 'Verification' }] },
  {
    kind: 'bullet',
    segments: [
      { text: '执行 ' },
      { text: 'tail -n 3 README.md', style: 'code' },
      {
        text: ' 确认最后一行为 "r7 rebaseline probe",且原有的 "r6 rebaseline probe" 一行保留在其上一行。',
      },
    ],
  },
  {
    kind: 'bullet',
    segments: [
      { text: '执行 ' },
      { text: 'git diff README.md', style: 'code' },
      { text: ' 确认改动仅为新增一行,未影响其他行。' },
    ],
  },
];

/** Probe #9 transcript while planning (r7 16): stamp, start bubble, live
 *  step row. */
const PROBE_RUN_OPEN: TranscriptItem[] = [
  { kind: 'run', at: '13:26', machine: MACHINE_NAME },
  {
    kind: 'user',
    text: '开始执行任务',
    seq: 9,
    title: '在 README.md 末尾追加一行「r7 rebaseline probe」',
  },
];

/** Probe #9 transcript while planning (r7 16): run open + live step row. */
const PROBE_PLANNING_TRANSCRIPT: TranscriptItem[] = [
  ...PROBE_RUN_OPEN,
  { kind: 'streaming', seconds: 3, label: '准备工作区...' },
];

/** Probe #9 transcript once the plan landed (r7 17/17b/17d, and 16d which
 *  the r7 manifest filed under the streaming name). */
const PROBE_CONFIRM_TRANSCRIPT: TranscriptItem[] = [
  ...PROBE_RUN_OPEN,
  {
    kind: 'robot',
    paragraphs: [
      [{ text: '任务简单明确:在 README.md 末尾追加一行新文本,文件已有末尾换行行,直接追加即可。' }],
    ],
  },
  {
    kind: 'plan',
    title: '方案 · v1',
    preview:
      'Context: 仓库根目录的 README.md 当前末尾一行为 "r6 rebaseline probe"(文件以换行符结尾)。需求是在文件末尾追加新的一行 "r7 rebaseline probe"。  Changes: README.md:在文件末尾追加一行新内容 "r7 rebaseline probe",保持与现有行一致的格式(纯文本行,行尾换行符),不改动文件中已有的其他内容。',
    seconds: 21,
  },
];

/** Execution round open, shared by the 26/26d/27/27b/28/36 surfaces: plan
 *  round + 13:35 stamp + the user's 确认 bubble (r7 §5 时序). */
const PROBE_BUILD_OPEN: TranscriptItem[] = [
  ...PROBE_CONFIRM_TRANSCRIPT,
  { kind: 'note', text: '13:35' },
  { kind: 'user', text: '确认' },
];

/** Agent result message closing the execution round (r7 26d/27/36;
 *  straight quotes + fullwidth commas per the captures). */
const PROBE_BUILD_RESULT: TranscriptItem = {
  kind: 'robot',
  paragraphs: [
    [
      {
        text: '已在 README.md 末尾追加一行"r7 rebaseline probe"，验证通过，未影响其他内容。',
      },
    ],
  ],
  footer: {},
};

/** The two tool calls of the execution round (r7 28 expanded form:
 *  `edit README.md` + the verification `bash …` pill). The bash label is
 *  also the 26d streaming row's 调用工具 text — the capture runs it to
 *  the chat edge with an ellipsis. */
export const PROBE_TOOL_PILLS = [
  'edit README.md',
  'bash cd "$(git rev-parse --show-toplevel 2>/dev/null || pwd)" && tail -n 3 README.md && echo …',
];

/** Streaming-row tool label of the 26d capture — chrome carried inside the
 *  fixture (frozen capture text); the en dict keys on this exact value. */
export const PROBE_TOOL_CALL_LABEL = `调用工具：${PROBE_TOOL_PILLS[1]}`;

/** Tool-call group row of the execution round (r7 27 collapsed `完成
 *  19s ▸`; r7 28 expanded with pills + 收起). */
function probeTools(expanded: boolean): TranscriptItem {
  return { kind: 'tools', seconds: 19, expanded, pills: PROBE_TOOL_PILLS };
}

/** Merge round appended on completion (r7 36/36d): announcement stamp,
 *  merge-result message with the mono command chip, elapsed row, 🎉
 *  banner. */
const PROBE_MERGE_ROUND: TranscriptItem[] = [
  { kind: 'note', text: 'Xmon Dai 发起了合并' },
  {
    kind: 'robot',
    paragraphs: [
      [
        { text: 'git merge origin/main', style: 'code' },
        { text: ' 结果为 "Already up to date"，无需处理冲突。' },
      ],
    ],
    footer: { seconds: 17 },
  },
  { kind: 'note', text: '🎉 任务已完成' },
];

/** r3 legacy #1 transcript (r7 38): schedule-triggered run waiting on the
 *  user's reply — stamp + 由定时发起 + start bubble + the agent's
 *  no-op analysis (code chips around the probe line and the commit
 *  subject) + 完成 32s. */
const LEGACY_REVIEW_TRANSCRIPT: TranscriptItem[] = [
  { kind: 'run', at: '星期六 14:30', machine: 'r3-mbp' },
  { kind: 'scheduled' },
  {
    kind: 'user',
    text: '开始执行任务',
    seq: 1,
    title: '在 README.md 末尾追加一行「r3 lifecycle probe」',
  },
  {
    kind: 'robot',
    paragraphs: [
      [
        { text: 'README.md 中已存在这行内容（' },
        { text: 'r3 lifecycle probe', style: 'code' },
        { text: '），且历史提交记录显示已有一次' },
      ],
      [
        { text: 'docs（readme）：append lifecycle probe line', style: 'code' },
        { text: ' 的提交完成了这项任务。当前工作区无待提交更改，' },
      ],
      [{ text: '任务已满足，无需重复修改。' }],
    ],
    footer: { seconds: 32 },
  },
];

/** The probe's one-file changeset (r7 27/27b/36): README.md +1 line.
 *  `expanded` is the pane's initial state — review surfaces pass true
 *  (XMON-55 P2), the captured-collapsed form is opt-in. */
function probeChanges(expanded: boolean): ChangesContent {
  return {
    expanded,
    files: [
      {
        path: 'README.md',
        added: 1,
        hunks: [
          {
            header: '@@ -3,3 +3,4 @@ r3 lifecycle probe',
            lines: [
              { kind: 'context', text: 'r3 lifecycle probe2', oldNo: 3, newNo: 3 },
              { kind: 'context', text: 'r5b lifecycle probe', oldNo: 4, newNo: 4 },
              { kind: 'context', text: 'r6 rebaseline probe', oldNo: 5, newNo: 5 },
              { kind: 'add', text: 'r7 rebaseline probe', newNo: 6 },
            ],
          },
        ],
        // #225 全文槽:与 hunk 窗(@@ -3,3 +3,4 @@)自洽的六行——3–5 行 =
        // 窗内 context 原文,第 6 行 = +行;初渲不展示,视觉零影响。
        fullContent:
          '# r3 probe\nprobe readme\nr3 lifecycle probe2\nr5b lifecycle probe\nr6 rebaseline probe\nr7 rebaseline probe\n',
      },
    ],
  };
}

/** Detail fresh state (r7 23): no transcript, no doc pane. */
export const detailFresh: FixtureSet = {
  todos: [probeTodo('todo', r7(13, 21))],
  now: r7(13, 22),
};

/** Detail fresh state, dark capture (r7 23d = probe #10). */
export const detailFreshDark: FixtureSet = { todos: [probe10], now: r7(13, 41) };

/** Detail planning state (r7 16): live transcript, empty doc pane. */
export const detailPlanning: FixtureSet = {
  todos: [probeTodo('planning', r7(13, 26))],
  now: r7(13, 26),
  detail: { transcript: PROBE_PLANNING_TRANSCRIPT },
};

/** Detail confirm state (r7 17/17b/17d, plus 16d = same surface dark with
 *  the popover). `userMenuOpen` reproduces the popover the 17 and 16d
 *  captures include. */
export function detailConfirm(userMenuOpen: boolean): FixtureSet {
  return {
    todos: [probeTodo('confirm', r7(13, 26))],
    now: r7(13, 28),
    detail: { transcript: PROBE_CONFIRM_TRANSCRIPT, doc: PROBE_PLAN_DOC, userMenuOpen },
  };
}

/** Detail building state (r7 26/26d): execution streaming. The light
 *  capture froze at `3s › 处理中...`; the dark one (with the user menu
 *  open) caught the later `19s › 调用工具：bash …` after the result
 *  message landed. `lateCapture` selects the dark capture's later
 *  moment — the theme itself comes from the matrix row. */
export function detailBuilding(lateCapture: boolean): FixtureSet {
  const tail: TranscriptItem[] = lateCapture
    ? [
        PROBE_BUILD_RESULT,
        {
          kind: 'streaming',
          seconds: 19,
          // full command rides the label; CSS ellipsis cuts it at the
          // chat edge exactly like the capture
          label: PROBE_TOOL_CALL_LABEL,
        },
      ]
    : [{ kind: 'streaming', seconds: 3, label: '处理中...' }];
  return {
    todos: [probeTodo('building', r7(13, 35))],
    now: r7(13, 36),
    detail: {
      transcript: [...PROBE_BUILD_OPEN, ...tail],
      doc: PROBE_PLAN_DOC,
      userMenuOpen: lateCapture,
    },
  };
}

/** #471 quiescent building gap (named scenario, no capture — the
 *  detail-unread precedent): the task is executing but the agent is not
 *  streaming (no active step) — the transcript keeps one live row through
 *  the same streaming component: loading indicator (#672: loading-dev
 *  Atom) + the static 执行中... label, no seconds counter. [设计] */
export function detailSpinnerQuiescent(): FixtureSet {
  return {
    todos: [probeTodo('building', r7(13, 35))],
    now: r7(13, 36),
    detail: {
      transcript: [...PROBE_BUILD_OPEN, { kind: 'streaming', label: '执行中...' }],
      doc: PROBE_PLAN_DOC,
    },
  };
}

/** Detail review state (r7 27/27b/28). XMON-55 P2 flipped the changes-pane
 *  default to expanded: the r7 27/27d captures froze it collapsed, which
 *  left the 488px pane holding one file row over blank space. The dark
 *  capture carries the user-menu popover. */
export function detailReview(opts: {
  userMenuOpen: boolean;
  changesExpanded?: boolean;
  toolsExpanded?: boolean;
}): FixtureSet {
  return {
    todos: [probeTodo('review', r7(13, 37))],
    now: r7(13, 40),
    detail: {
      transcript: [
        ...PROBE_BUILD_OPEN,
        PROBE_BUILD_RESULT,
        probeTools(opts.toolsExpanded ?? false),
      ],
      changes: probeChanges(opts.changesExpanded ?? true),
      userMenuOpen: opts.userMenuOpen,
    },
  };
}

/** #1101 diff-pane stress changeset (named scenario, no capture —
 *  chief-threads-long precedent). One file, three hunks, pinning the five
 *  shapes the word-level highlight + horizontal-scroll fixes must handle:
 *  a one-word del/add pair (word highlight), an uneven del run against a
 *  shorter add run (minimum pairing, the surplus del stays whole-line),
 *  a marker row separating a del/add pair (r8 72 adjacency shape — pairing
 *  must see through markers), long rows (the horizontal-scroll bg face) and
 *  an oversized pair beyond the word-diff cap (the loud fallback face). */
const STRESS_MEGA_ARGS = Array.from({ length: 120 }, (_, i) => `field${i}: "value${i}"`).join(', ');

function stressChanges(): ChangesContent {
  const longDel =
    'renderDashboard({ title: "Quarterly Revenue Overview", region: "apac", quarter: "Q3", limit: 100, offset: 0, sort: "createdAt", filter: { active: true } });';
  const longAdd = longDel.replace('limit: 100', 'limit: 200');
  const cappedDel = `const mega = { ${STRESS_MEGA_ARGS} };`;
  const cappedAdd = cappedDel.replace('field7: "value7"', 'field7: "VALUE7"');
  const lines = [
    { kind: 'context' as const, text: 'import { retry } from "./retry.js";', oldNo: 1, newNo: 1 },
    { kind: 'del' as const, text: 'const timeoutMs = 3000; // retry window', oldNo: 2 },
    { kind: 'add' as const, text: 'const timeoutMs = 5000; // retry window', newNo: 2 },
    { kind: 'context' as const, text: 'const attempts = 3;', oldNo: 3, newNo: 3 },
    { kind: 'context' as const, text: 'const jitter = 0.2;', oldNo: 4, newNo: 4 },
    {
      kind: 'context' as const,
      text: 'export { timeoutMs, attempts, jitter };',
      oldNo: 5,
      newNo: 5,
    },
  ];
  return {
    expanded: true,
    files: [
      {
        path: 'src/pipeline/config.ts',
        added: 4,
        removed: 5,
        hunks: [
          { header: '@@ -1,5 +1,5 @@', lines },
          {
            header: '@@ -20,4 +20,3 @@',
            lines: [
              { kind: 'del', text: 'keepAlpha = true;', oldNo: 20 },
              { kind: 'del', text: 'keepBeta = true;', oldNo: 21 },
              { kind: 'add', text: 'keepAlpha = false;', newNo: 20 },
              { kind: 'context', text: 'keepGamma = true;', oldNo: 22, newNo: 21 },
              { kind: 'context', text: 'keepDelta = true;', oldNo: 23, newNo: 22 },
            ],
          },
          {
            header: '@@ -40,3 +40,3 @@',
            lines: [
              { kind: 'del', text: longDel, oldNo: 40 },
              { kind: 'marker', text: 'No newline at end of file' },
              { kind: 'add', text: longAdd, newNo: 40 },
              { kind: 'del', text: cappedDel, oldNo: 41 },
              { kind: 'add', text: cappedAdd, newNo: 41 },
              { kind: 'context', text: 'export default pipeline;', oldNo: 42, newNo: 42 },
            ],
          },
        ],
        // #225 full-file slot: the long rows ride here too so the 显示完整文件
        // face exercises the same horizontal-scroll width contract.
        fullContent: [
          '// src/pipeline/config.ts',
          longAdd,
          cappedAdd,
          'export default pipeline',
          '',
        ].join('\n'),
      },
    ],
  };
}

/** #1101 review surface carrying the stress changeset above. */
export function detailDiffWordStress(): FixtureSet {
  return {
    todos: [probeTodo('review', r7(13, 37))],
    now: r7(13, 40),
    detail: {
      transcript: [...PROBE_BUILD_OPEN, PROBE_BUILD_RESULT],
      changes: stressChanges(),
    },
  };
}

/** Detail done state (r7 36/36d): review surface + merge round. */
export function detailDone(): FixtureSet {
  return {
    todos: [probeTodo('done', r7(13, 52))],
    now: r7(13, 55),
    detail: {
      transcript: [
        ...PROBE_BUILD_OPEN,
        PROBE_BUILD_RESULT,
        probeTools(false),
        ...PROBE_MERGE_ROUND,
      ],
      changes: probeChanges(true),
    },
  };
}

/** r3 legacy #1 detail (r7 38): read-only review surface, schedule
 *  marker, no changes to show (`暂无可显示的变更`). */
export const detailLegacy: FixtureSet = {
  todos: [legacyReview, legacyDone],
  now: r7(13, 58),
  detail: { transcript: LEGACY_REVIEW_TRANSCRIPT },
};

/** Overlay payloads of the r3 legacy #1 build as the r8 78–80 dark captures
 *  froze them (issue #68): probe #9 no longer exists on the live account, so
 *  the dark overlay pairs bind to this todo's own build data. #1 re-ran on
 *  2026-09-22 18:30 (schedule trigger), which replaced the r7 38 surface:
 *  new run stamp, four-run history, a real changeset, no awaiting-reply. */
const LEGACY_TOKEN_USAGE: TokenUsageContent = {
  total: '66.1k',
  model: 'r3-gw/claude-sonnet-5',
  modelTotal: '66.1k',
  input: '10',
  output: '424',
  cacheRead: '52.3k',
  cacheWrite: '13.4k',
  cacheHitRate: '100%',
};

const LEGACY_BRANCH_INFO: BranchInfoContent = {
  // capture 79 truncates the branch after `2488`; the tail is unobservable
  // and only needs to keep the mono row overflowing at the same glyph
  branch: conversationBranch('01a0c8aa-9e64-742b-acbd-2488a1b2c3d4'),
  commit: 'f3ce121ba492',
  machine: MACHINE_NAME,
  directory: '~/preview/project',
};

/** r8 57 surface: #12's failed build whose single history row IS the
 *  failed current run — 当前 chip + footer 重跑 (r8 57); title/seq verbatim
 *  from the r8 54/57 captures. The failed-detail background behind the
 *  dialog is a later ticket, so the fixture pair rides smoke for now. */
const FAILED_CURRENT_ID = 'r8-failed-12';
const failedCurrentTodo: TodoRecord = {
  ...probeTodo('failed', at('2026-09-22', 12, 30)),
  id: FAILED_CURRENT_ID,
  seqNum: 12,
  title: 'README 文档目录 + 新建 CHANGELOG.md + scripts/hello.js',
  spec: 'README 文档目录 + 新建 CHANGELOG.md + scripts/hello.js',
};

const FAILED_CURRENT_RUNS: RunHistoryRow[] = [
  {
    label: '第 1 次运行',
    meta: '6 小时前 · 72.1k tokens · Machine offline',
    status: 'failed-current',
  },
];

export function detailFailedCurrent(): FixtureSet {
  return {
    todos: [failedCurrentTodo],
    now: at('2026-09-22', 18, 30),
    // the failed-state transcript surface is a later ticket; the smoke
    // pair only gates the dialog over whatever the detail route renders
    detail: { transcript: [] },
  };
}

const LEGACY_RUN_HISTORY: RunHistoryRow[] = [
  { label: '第 4 次运行', meta: '6 小时前 · 66.1k tokens', status: 'current' },
  { label: '第 3 次运行', meta: '3 天前 · Cancelled', status: 'failed' },
  { label: '第 2 次运行', meta: '3 天前', status: 'done' },
  { label: '第 1 次运行', meta: '4 天前 · Machine offline', status: 'failed' },
];

/** r3 legacy #2 overlay payload — [推断]: no capture ever opened an overlay
 *  on this build; the values exist so the done card's branch icon opens a
 *  dialog instead of dead-clicking. No e2e row rides them. */
const LEGACY2_OVERLAY: BuildOverlayContent = {
  token: {
    total: '41.7k',
    model: 'r3-gw/claude-sonnet-5',
    modelTotal: '41.7k',
    input: '9',
    output: '388',
    cacheRead: '31.6k',
    cacheWrite: '9.4k',
    cacheHitRate: '100%',
  },
  branch: {
    branch: conversationBranch('r3-legacy-2'),
    commit: 'b7e1f0a9c4d2',
    machine: MACHINE_NAME,
    directory: '~/preview/project',
  },
  runs: [{ label: '第 1 次运行', meta: '2 天前 · 41.7k tokens', status: 'done' }],
};

/** r3 legacy #1 as of the r8 dark captures (2026-09-23): review phase,
 *  schedule-triggered run of 2026-09-22 18:30, single-paragraph result. */
const legacyNow: TodoRecord = {
  ...legacyReview,
  phaseAt: at('2026-09-22', 18, 30),
  lastRunAt: at('2026-09-22', 18, 30),
  hasChanges: true,
  hasPlan: true,
  awaitingReply: false,
  buildHistory: [
    { buildId: 'r3-conv-legacy-1', createdAt: at(R3_DAY, 13, 5) },
    { buildId: 'r3-conv-legacy-1b', createdAt: at('2026-09-22', 18, 30) },
  ],
};

/** Two synthetic confirm-phase todos: the dark captures show the sidebar
 *  看板 badge at 2 (live board had two confirm cards); the detail route
 *  renders nothing of them but the badge. */
const darkBadgeFillers: TodoRecord[] = [1, 2].map((n) => ({
  ...legacyNow,
  id: `dark-badge-filler-${n}`,
  phase: 'confirm',
}));

const LEGACY_NOW_TRANSCRIPT: TranscriptItem[] = [
  { kind: 'run', at: '昨天 18:30', machine: MACHINE_NAME },
  { kind: 'scheduled' },
  {
    kind: 'user',
    text: '开始执行任务',
    seq: 1,
    title: '在 README.md 末尾追加一行「r3 lifecycle probe」',
  },
  {
    kind: 'robot',
    paragraphs: [[{ text: '已在 README.md 末尾追加了一行「r3 lifecycle probe」。' }]],
  },
  { kind: 'elapsed', seconds: 25 },
];

/** Dark capture set (r8 78–81): legacy #1's current surface with a frozen
 *  open state — `chiefUnread` reproduces the FAB badge the captures carry.
 *  #366: the token/branch/history freezes moved from the (deleted) overlay
 *  dialogs to the right-pane view (ui.paneView); accept stays an overlay. */
export function detailLegacyNow(freeze: Pick<FixtureSet, 'overlay' | 'ui'>): FixtureSet {
  return {
    todos: [legacyNow, ...darkBadgeFillers],
    now: at('2026-09-23', 0, 13),
    chiefUnread: 1,
    detail: { transcript: LEGACY_NOW_TRANSCRIPT, changes: probeChanges(true) },
    ...freeze,
  };
}

/** Build-scoped overlay display data per todo (issue #68): the dialog
 *  payloads are not record fields (02 §6.2), so the fixture layer maps the
 *  captured builds — probe #9 (r7 30/31/32) and r3 legacy #1 (r8 78–80) —
 *  plus one [推断] set for legacy #2 so its card's branch icon is not a
 *  dead control; no e2e row rides the [推断] values. */
export function overlayContent(todoId: string): BuildOverlayContent | null {
  if (todoId === PROBE_ID) {
    return { token: PROBE_TOKEN_USAGE, branch: PROBE_BRANCH_INFO, runs: PROBE_RUN_HISTORY };
  }
  if (todoId === FAILED_CURRENT_ID) {
    return { token: PROBE_TOKEN_USAGE, branch: PROBE_BRANCH_INFO, runs: FAILED_CURRENT_RUNS };
  }
  if (todoId === legacyReview.id) {
    return { token: LEGACY_TOKEN_USAGE, branch: LEGACY_BRANCH_INFO, runs: LEGACY_RUN_HISTORY };
  }
  if (todoId === legacyDone.id) {
    return LEGACY2_OVERLAY;
  }
  return r8OverlayContent(todoId);
}
// ---- issue #71: schedules + project route sets ----

/** r3 93 list card: the once rule built in r3 §9 (fired 14:30, todo #1 went
 *  done, rule still listed with 下次 今天 14:30 at capture time ~13:50).
 *  Record shape verbatim from r3 §8.3; `createdBy` id is [推断] (masked in
 *  the capture, never rendered). */
const scheduleOnce: ScheduleRecord = {
  id: 'r3-schedule-1',
  teamId: TEAM_ID,
  projectId: PROJECT_ID,
  todoId: 'r3-legacy-1',
  kind: 'once',
  at: at(R3_DAY, 14, 30),
  tz: 'Asia/Shanghai',
  machineId: null,
  nextRunAt: at(R3_DAY, 14, 30),
  createdBy: 'u-xmon-dai',
  todo: {
    seqNum: 1,
    title: legacyReview.title,
    phase: 'done',
    projectName: PROJECT_NAME,
    ownerId: 'u-xmon-dai',
  },
};

/** r7 11: the schedules empty state. Dedicated set (not a boardDefault
 *  alias) so edits to the board fixture can never drift the only gated
 *  baseline row of this batch (scenario contract, scenario.ts header). */
export const schedulesEmpty: FixtureSet = {
  todos: [legacyReview, legacyDone],
  now: r7(13, 14),
  schedules: [],
  project: projectContent,
};

/** r3 93: list with the single once rule. Capture instant ~13:50 keeps
 *  `下次 今天 14:30` in the future. */
export const schedulesList: FixtureSet = {
  todos: [legacyReview, legacyDone],
  now: at(R3_DAY, 13, 50),
  schedules: [scheduleOnce],
  project: projectContent,
};

/** r3 92: 新建定时 dialog open on the 每天 tab (the default frequency). */
export const schedulesFormDaily: FixtureSet = {
  todos: [legacyReview, legacyDone],
  now: at(R3_DAY, 13, 50),
  schedules: [],
  scheduleForm: 'daily',
  project: projectContent,
};

/** r3 92b: same dialog on 单次 — the 日期 row appears above 时间. */
export const schedulesFormOnce: FixtureSet = {
  ...schedulesFormDaily,
  scheduleForm: 'once',
};

/** The project routes share one content set; the route picks the page and
 *  `projectTab` picks the 任务|文件 surface (r2 07 / 07e·24 / 24b·26 / 24c).
 *  Default tab = 文件 (r2 §2 route table). */
export const projectFixture: FixtureSet = {
  todos: [legacyReview, legacyDone],
  now: r7(13, 14),
  project: projectContent,
};

/** r2 26: 任务 tab with the two legacy rows (checkbox + title + rel time
 *  + owner avatar). */
export const projectTasks: FixtureSet = { ...projectFixture, projectTab: 'tasks' };

/** r2 24b: 任务 tab of a project without todos — the 暂无内容 empty state
 *  with the `+ 任务` entry (the r2 session's r2-inventory project). */
export const projectTasksEmpty: FixtureSet = {
  todos: [],
  now: r7(13, 14),
  project: projectContent,
  projectTab: 'tasks',
};

/** spec 12 / #362 G2-T2 v1: local 仓库项目的 文件 tab 禁用面（占位 +
 *  一行 disable 文案）；任务行 = legacy 双行（切换对照用）。 */
/** local 形态 Files 面演示集（scenario prj-local-files；#1030 起 Files tab
 * 开闸）：与 hosted 演示集（projectContent / r2 07e tree 面）同形，内容换
 * local 语义——本地仓 README、分支钉 trunk（local 仓默认分支任意，非恒
 * main）。 */
export const projectLocalFiles: FixtureSet = {
  todos: projectFixture.todos,
  now: projectFixture.now,
  project: {
    ...projectContent,
    repoKind: 'local',
    hosted: false,
    repoName: 'local-repo',
    branch: 'trunk',
    fileContents: {
      'README.md': [
        '# local-repo',
        '',
        '本地仓库：用户本机既有 git 工作树仓，Files tab 直读工作树 HEAD。',
        '',
      ].join('\n'),
    },
    commits: [
      {
        id: 'c1d2e3f4a5b60718293a4b5c6d7e8f90a1b2c3d4',
        shortSha: 'c1d2e3f',
        message: 'init local-repo',
        authorName: 'local-user',
        at: r7(10, 5),
        // #1102：根提交（无父）= 相对空树全文件新增（server readCommitDetail
        // S4 语义的 fixture 同形供肉）。
        files: [
          {
            path: 'README.md',
            additions: 3,
            deletions: 0,
            hunks: [
              {
                header: '@@ -0,0 +1,3 @@',
                lines: [
                  '+# local-repo',
                  '+',
                  '+本地仓库：用户本机既有 git 工作树仓，Files tab 直读工作树 HEAD。',
                ],
              },
            ],
          },
        ],
      },
    ],
  },
  projectTab: 'files',
}; /** Resource surfaces (r7 06–10, issue #69): the r3 session left one skill,
 *  one MCP server, the online r3 machine and a custom gateway on the free
 *  team, so the captures show populated rows rather than empty states
 *  (secrets excepted — its empty state is the capture). Row content is
 *  verbatim from the bitmaps; `2 天前` on the MCP row is the capture's own
 *  relative label (created on the r3 day), carried verbatim like the
 *  board's relative labels. */
// providers 页 runtime tabs canon（spec 11 §A1-A4，#356）：pi 段 = custom
// provider models[] 投影的展示样（承接 r7 07「R3 网关」canon 的量感）；
// claude-code 段 = 本机 settings.json 槽位映射样。hostname 与 machines
// canon（MACHINE_NAME）同源。两段提成命名常量 = 未安装分支变体（resources
// CcMissing）的复用源。
const PROVIDER_SOURCE_PI: ModelSource = {
  runtime: 'pi',
  installed: true,
  hostname: MACHINE_NAME,
  models: [
    { id: 'claude-sonnet-5', name: 'Claude Sonnet 5（R3 网关）' },
    { id: 'claude-opus-4-5', name: 'Claude Opus 4.5（R3 网关）' },
    { id: 'gpt-5.2', name: 'GPT-5.2（R3 网关）' },
  ],
};

const PROVIDER_SOURCE_CC: ModelSource = {
  runtime: 'claude-code',
  installed: true,
  hostname: MACHINE_NAME,
  // #1050：canon fixture 带上两个可用性事实位（装了 + 已登录），三态的另两支
  // 由 e2e 按 scenario 覆写（页面断言需要「装了没配」与「没装」同时可见）。
  bin: { path: '/home/u/.local/bin/claude', version: '2.1.289' },
  auth: { state: 'logged-in', method: 'oauth_token', provider: 'firstParty' },
  models: [
    { id: 'claude-opus-4-5', name: 'claude-opus-4-5', slot: 'default' },
    { id: 'claude-opus-4-1', name: 'claude-opus-4-1', slot: 'opus' },
    { id: 'claude-sonnet-5', name: 'claude-sonnet-5', slot: 'sonnet' },
    { id: 'claude-haiku-4-5', name: 'claude-haiku-4-5', slot: 'haiku' },
  ],
};

const RESOURCES: ResourcesContent = {
  skills: [{ name: 'r3-probe-skill', description: 'R3 盘点测试技能' }],
  mcpServers: [
    {
      name: 'r3-mcp',
      kind: '远程（HTTP）',
      url: 'https://example.invalid/mcp',
      ago: '2 天前',
    },
  ],
  // spec 11 A8（#357）：本机行钉首（hostname canon + per-runtime 品牌 mark，
  // pi 开 / Claude Code 关 = 两态展示）；托管 facade 行已除。
  machines: [
    {
      id: MACHINE_ID,
      kind: 'local',
      name: MACHINE_NAME,
      online: true,
      enabledRuntimes: ['pi'],
      // XMON-113：机器层 shell 闸，fixture canon = 关（与 server migration
      // 回填 false 同态——存量机器默认不给 shell）。
      shellEnabled: false,
      // #1108：并发面 fixture canon = 历史默认 3 / 空载 0（与 migration 回填
      // DEFAULT 3 同态）。
      maxConcurrent: 3,
      runningSteps: 0,
    },
  ],
  providerSources: [PROVIDER_SOURCE_PI, PROVIDER_SOURCE_CC],
};

// ── Chief surfaces (issue #72, r5 100–116) ───────────────────────────────
// Copy verbatim from the r5 captures: 100 gate bar + hero + draft, 101–104
// settings tabs, 111 bound hero, 114 dispatch-report stream, 116 switcher.
// The r5 batch is 1438×730 (off the r7 baseline batch), so these sets back
// smoke rows only — see docs/research/r8-chief-panel-adhoc.md for the
// baseline gap registration.

/** r5 100/111 hero grid, card order = capture order. */
const CHIEF_EXAMPLES: ChiefExample[] = [
  { icon: 'user-plus', text: '帮我组建 Agent 团队' },
  { icon: 'folder', text: '帮我创建一个新项目' },
  { icon: 'grid', text: '总结一下我所有项目现在的进展' },
  { icon: 'bars', text: '查一下这个月的 token 用量' },
];

/** r5 100/111 composer draft (localStorage pacman.cache.chief-draft-v1, the
 *  capture shows it restored into the textarea). */
const CHIEF_DRAFT =
  '我想做一个能在浏览器里直接玩的网页小游戏 （比如贪吃蛇或打砖块）： 单文件 HTML + Canvas， 不用任何构建工具，做完能在项目的文件页直接试玩。请在现有的入门项目里做， 组建 Agent 团队把游戏逻辑、 画面手感、 难度调优拆成并行任务， 然后向我汇报方案， 等我确认后再开始动工。';

/** r5 116 switcher rows: the two threads of the r5 session, active first. */
const CHIEF_THREADS: ChiefThreadRef[] = [
  { title: '给 r3-lifecycle 做三件小事…', active: true },
  { title: '帮 r3-lifecycle 写一份…' },
];

/** r5 100: drawer on a fresh thread, no agent bound — gate bar + hero. */
export const chiefGated: FixtureSet = {
  todos: [legacyReview, legacyDone],
  now: r7(13, 14),
  chief: {
    view: 'drawer',
    bound: false,
    threadTitle: '新主题',
    examples: CHIEF_EXAMPLES,
    draft: CHIEF_DRAFT,
  },
};

/** r5 111: same fresh-thread drawer once an agent is bound — model slot
 *  filled, gate bar gone. */
export const chiefReady: FixtureSet = {
  todos: [legacyReview, legacyDone],
  now: r7(13, 14),
  chief: {
    view: 'drawer',
    bound: true,
    modelSlot: 'claude-sonnet-5 · 默认',
    threadTitle: '新主题',
    examples: CHIEF_EXAMPLES,
    draft: CHIEF_DRAFT,
  },
};

/** r5 113: 回合进行中流式面（#624 命名场景，手法循 #499/#444 无 capture
 *  先例）——testA 线程发出后 Chief 在仓库基座跑 git 只读探索（doc §2 实测
 *  工具行 `git show`），回合未收尾：robot 行无 `完成 Ns` 徽标（seconds 空串
 *  = live 流式同形），composer 占位切 steer canon（running 位）。线程标题 =
 *  首句 12 字截断 + …（shared chiefThreadTitle 律）。流内容 [推断]：capture
 *  仅工具行与占位词可辨（截图 113），拼装循 114 族；捕获面的 `停止` 钮属
 *  live 停止链，另票裁决不入本景。 */
export const chiefStreaming: FixtureSet = {
  todos: [legacyReview, legacyDone],
  now: r7(13, 14),
  chief: {
    view: 'drawer',
    bound: true,
    modelSlot: 'claude-sonnet-5 · 默认',
    threadTitle: '我想做一个能在浏览器里直…',
    running: true,
    stream: [
      { kind: 'note', text: '17:19' },
      { kind: 'note', text: '运行在 ', machineName: MACHINE_NAME },
      { kind: 'user', text: CHIEF_DRAFT },
      {
        kind: 'robot',
        paragraphs: [
          [
            {
              text: '收到。我先读一遍现有入门项目的结构，再把游戏逻辑、画面手感、难度调优拆成并行任务向你汇报方案。',
            },
          ],
        ],
        seconds: '',
        tools: [{ label: 'git show' }],
      },
    ],
  },
};

/** r5 114: thread view with the dispatch report of todo #11 — user bubble,
 *  chief report paragraphs with the #11 / r5-scribe chips, 完成 44s footer. */
export const chiefThread: FixtureSet = {
  todos: [legacyReview, legacyDone],
  now: r7(13, 14),
  chief: {
    view: 'drawer',
    bound: true,
    modelSlot: 'claude-sonnet-5 · 默认',
    threadTitle: '帮 r3-lifecycle 写一份…',
    stream: [
      { kind: 'note', text: '17:26' },
      { kind: 'note', text: '运行在 ', machineName: MACHINE_NAME },
      {
        kind: 'user',
        text: '帮 r3-lifecycle 写一份 CONTRIBUTING.md 贡献指南，说明怎么给 Agent 提任务、怎么验收改动，写完放到项目根目录。',
      },
      {
        kind: 'robot',
        paragraphs: [
          [
            { text: '已创建并派工 ' },
            { text: '', todo: 11 },
            { text: ' 「编写 CONTRIBUTING.md 贡献指南」， 由文档专职 Agent ' },
            { text: '', agent: 'r5-scribe' },
            { text: ' 承接，正在编写中。' },
          ],
          [
            {
              text: '要求内容涵盖：如何给 Agent 提任务、如何验收改动，文件写入项目根目录 CONTRIBUTING.md。完成或需要确认时我会跟进汇报。',
            },
          ],
        ],
        seconds: '44s',
        // #615 返工：foot 折叠箭头展开面（r5 114 捕获为折叠态，展开内容未
        // 采——工具行 [推断] 自回执文本「已创建并派工 #11 … 承接」）。
        tools: [
          { label: 'create_todo', seconds: 2 },
          { label: 'run_builds', seconds: 5 },
        ],
      },
    ],
  },
};

/** r5 116: the 三件小事 thread with the header switcher popover open —
 *  the visible stream tail is the merge-check report (bullets + #12 ask). */
export const chiefThreadsOpen: FixtureSet = {
  todos: [legacyReview, legacyDone],
  now: r7(13, 14),
  chief: {
    view: 'drawer',
    bound: true,
    modelSlot: 'claude-sonnet-5 · 默认',
    threadTitle: '给 r3-lifecycle 做三件小事…',
    threadsOpen: true,
    threads: CHIEF_THREADS,
    stream: [
      {
        kind: 'robot',
        paragraphs: [
          [
            { text: '顺带说明： CONTRIBUTING.md 本身由 ' },
            { text: '', todo: 11 },
            {
              text: ' 负责编写，目前在 review 阶段尚未合并进 main，我在新任务里已注明"只需在 README 里列出该条目，不必等它合并"。',
            },
          ],
          [{ text: '等它落到 review/完成时我会来汇报，到时候也会补上记忆总结。' }],
        ],
        seconds: '1m 4s',
      },
      {
        kind: 'robot',
        paragraphs: [[{ text: '三项改动都已核对，符合要求：' }]],
        bullets: [
          [
            { text: 'README.md:', strong: true },
            { text: '新增 「文档目录」 节，列出 ' },
            { text: 'CONTRIBUTING.md', code: true },
            { text: ' 链接。' },
          ],
          [
            { text: 'CHANGELOG.md:', strong: true },
            { text: '新建,含 「未发布」 初始条目，列出本次三项变更。' },
          ],
          [
            { text: 'scripts/hello.js:', strong: true },
            { text: 'node scripts/hello.js', code: true },
            { text: ' 打印 ' },
            { text: 'hello', code: true },
            { text: '，构建里已本地验证过。' },
          ],
        ],
        seconds: '31s',
      },
      {
        kind: 'robot',
        paragraphs: [
          [
            { text: '', todo: 12 },
            { text: ' 现在停在 review 阶段等你确认合并。要我现在 merge 吗?' },
          ],
        ],
        seconds: '31s',
      },
    ],
  },
};

/** #1094 长列表滚动面（synthetic scenario，chief-md 先例）：r5 116 的
 *  切换器形态 + 22 行线程（canon 两行在前，active 仍钉首行）。修复前
 *  容器零 max-height，尾部行被 WINDOW_CLS 的 overflow-hidden 裁掉——
 *  不可见也不可点；e2e/chief-thread-switcher-scroll.spec 钉封顶 +
 *  纵向滚动可达 + 尾部行可点，短列表面（116）零变化对照。 */
const CHIEF_THREADS_LONG: ChiefThreadRef[] = [
  ...CHIEF_THREADS,
  ...Array.from({ length: 20 }, (_, i) => ({ title: '长列表主题 ' + (i + 1) })),
];

export const chiefThreadsLong: FixtureSet = {
  todos: [legacyReview, legacyDone],
  now: r7(13, 14),
  chief: {
    view: 'drawer',
    bound: true,
    modelSlot: 'claude-sonnet-5 · 默认',
    threadTitle: '给 r3-lifecycle 做三件小事…',
    threadsOpen: true,
    threads: CHIEF_THREADS_LONG,
    stream: [
      {
        kind: 'robot',
        paragraphs: [[{ text: '三项改动都已核对，符合要求：' }]],
        seconds: '31s',
      },
    ],
  },
};

/** #1067 滚动停靠面（synthetic scenario，chief-threads-long 先例）：30 段
 *  robot 段落的单线程——600px 窗体下 scrollHeight 远超 clientHeight，钉
 *  「滚到中间 → 最小化 → 重开落在原位置」（inert/opacity 停靠载体）与
 *  停靠态的焦点/可及树缺席断言（e2e/chief-park-scroll.spec）。段文本带
 *  序号使滚动位置可按行断言（首个可见行 ≠ 首行 ≠ 尾行）。 */
const CHIEF_SCROLL_STREAM = Array.from({ length: 30 }, (_, i) => ({
  kind: 'robot' as const,
  paragraphs: [[{ text: `滚动停靠语料第 ${i + 1} 段：最小化后这行所在的位置必须原样回来。` }]],
  seconds: '1s',
}));

export const chiefScrollPark: FixtureSet = {
  todos: [legacyReview, legacyDone],
  now: r7(13, 14),
  chief: {
    view: 'drawer',
    bound: true,
    modelSlot: 'claude-sonnet-5 · 默认',
    threadTitle: '给 r3-lifecycle 做三件小事…',
    stream: CHIEF_SCROLL_STREAM,
  },
};

/** #650/#651 named scenario (no capture, mdToolout / chiefStreaming 先例):
 *  总管抽屉的 markdown 面——定稿 robot 行携带 raw block markdown（`markdown`
 *  槽优先于段数组，渲染期走共用 chat-markdown 解析，live mapper 同路），
 *  尾行 = typing 打字面（`typing` 位，无 foot；静态表达 live 流式态，
 *  scenario 113 的 running 位同手法）。e2e/chief-stream-markdown.spec 钉
 *  bold/code/mention/列表/栅栏的渲染形与「星号不漏字面」。 */
const CHIEF_MD_REPLY = [
  '## 凭证链路验证报告',
  '',
  '三项检查已完成，**全部通过**，输出细节在 `docs/verify/` 目录。',
  '',
  '- **项目**: 凭证链路验证',
  '- 次要点: 由 [r5-scribe](agent:a1) 承接复核',
  '- 关联任务: [#1](todo:r3-legacy-1) 已进入复核；prose #12 与 [伪链](todos:t2) 保持字面',
  '',
  '1. 第一步：读取配置',
  '   - 子项：token 门',
  '2. 第二步：跑通探针',
  '',
  '```sh',
  'curl -s localhost:8787/healthz',
  '```',
].join('\n');

export const chiefMarkdown: FixtureSet = {
  todos: [legacyReview, legacyDone],
  now: r7(13, 14),
  chief: {
    view: 'drawer',
    bound: true,
    modelSlot: 'claude-sonnet-5 · 默认',
    threadTitle: '验证一下凭证链路…',
    running: true,
    stream: [
      { kind: 'note', text: '17:26' },
      { kind: 'user', text: '验证一下凭证链路，然后给我一份报告' },
      {
        kind: 'robot',
        markdown: CHIEF_MD_REPLY,
        seconds: '44s',
      },
      {
        kind: 'robot',
        markdown: '正在复核 **relay 通道** 的重试预算',
        typing: true,
        seconds: '',
      },
    ],
  },
};

/** r5 101–104: the 总管设置 view, one set per tab (unbound agent). */
export function chiefSettings(tab: ChiefSettingsTab): FixtureSet {
  return {
    todos: [legacyReview, legacyDone],
    now: r7(13, 14),
    chief: { view: 'settings', tab, bound: false, threadTitle: '新主题' },
  };
}

/** #358 AC2 canon（spec 11 §A10）：compactionModel 仍引用已废 preset
 *  （`anthropic` ∈ PROVIDER_PRESET_IDS，preset 方案退役后不再是选项来源），
 *  命中不了 fixture canon 单行（#770 起为 claude-code 行）→ 选择器落裸串
 *  `provider/modelId`
 *  兜底回显，不空白不崩。scenario = 101-stale-model。 */
export const chiefSettingsStaleModel: FixtureSet = {
  ...chiefSettings('agent'),
  chief: {
    view: 'settings',
    tab: 'agent',
    bound: false,
    threadTitle: '新主题',
    compactionModel: { provider: 'anthropic', modelId: 'claude-3-5-haiku-20241022' },
  },
};

/** #895 主力机槽命名场景（无 capture，101-stale-model 先例）：settings
 *  Agent tab + resources 两机（在线本机 + 离线远端，boardMachinePicker 同
 *  行集）+ 槽值钉本机——e2e 钉机器 chip 的回显/清单/accept 律。 */
export const chiefSettingsMachines: FixtureSet = {
  ...chiefSettings('agent'),
  resources: boardMachinePicker.resources,
  chief: {
    view: 'settings',
    tab: 'agent',
    bound: false,
    threadTitle: '新主题',
    machineId: MACHINE_ID,
  },
};

/** Default drawer content for a FAB-opened drawer on a scenario without a
 *  chief surface (dev interactivity; fixture rows always carry a set). */
export const chiefDefault: ChiefContent = {
  view: 'drawer',
  bound: false,
  threadTitle: '新主题',
  examples: CHIEF_EXAMPLES,
};

/** Team route roster (r7 12): `1 个成员` stats bar + the single agent card
 *  (`claude-sonnet-5 · 默认`, role unset) beside the dashed 创建 Agent slot. */
export const TEAM_R7: TeamContent = {
  members: 1,
  agents: [
    {
      id: R3_BUILDER.id,
      displayName: R3_BUILDER.displayName,
      model: 'claude-sonnet-5',
      isDefault: true,
      role: null,
    },
  ],
};

/** Team route fixture (r7 12): the board todos never render here, the
 *  roster is the whole surface. */
export const teamGrid: FixtureSet = {
  todos: boardDefault.todos,
  now: boardDefault.now,
  team: TEAM_R7,
};

/** chart 组织图 named scenario（命名场景无 capture 先例 #444）：r7 12 捕获
 *  只有一个成员，组织图的根/子结构在那份语料里长不出来——这里合成 3 个
 *  Agent + 1 个绑定总管，字段形状照 todos.dev 实测 members 行
 *  （displayName/provider/modelId/description）。供
 *  ./e2e/team-org-chart.spec.ts 钉组织图的结构与连接件几何。 */
const TEAM_ORG_CHART: TeamContent = {
  members: 3,
  agents: [
    {
      id: 'org-chief',
      displayName: 'r3-builder',
      model: 'claude-sonnet-5',
      isDefault: true,
      role: '负责代码实现与工程修改。',
      provider: 'r3-gw',
    },
    {
      id: 'org-scribe',
      displayName: 'r5-scribe',
      model: 'qwen3.8-max',
      isDefault: false,
      role: '负责撰写与润色各类文档。',
      provider: 'r3-gw',
    },
    {
      id: 'org-scout',
      displayName: 'r9-scout',
      model: 'glm-5.3-flash',
      isDefault: false,
      role: null,
      provider: 'r3-gw',
    },
  ],
};

/** 总管绑定在 org-chief 上 —— 组织图的根节点由它决定。 */
export const teamOrgChart: FixtureSet = {
  todos: boardDefault.todos,
  now: boardDefault.now,
  team: TEAM_ORG_CHART,
  chief: {
    view: 'drawer',
    bound: true,
    agent: { id: 'org-chief', displayName: 'r3-builder', avatarUrl: null },
    threadTitle: '新主题',
  },
};

/** 零成员团队（r2 §8.1 17c：无成员时整块内容 = 暂无成员，不渲组织图）。 */
export const teamOrgChartEmpty: FixtureSet = {
  todos: boardDefault.todos,
  now: boardDefault.now,
  team: { members: 0, agents: [] },
};

// ── Agent 详情编辑面（r3 §4 实测样本）────────────────────────────────────
// 记录字段逐字 = r3 §4 的 wire 样本（provider `r3-gw`、modelId
// `claude-sonnet-5`、thinkingLevel null、四组权限数组全空）；团队页卡上的
// `未设置职责` 就是这里 description:null 的呈现。

/** Agent 记录样本（r3 §4 wire 原样——存量 provider 绑定：#770 起 picker 不再
 *  列 providers 段，本记录是存量值裸串回显的 pin 源）。 */
const AGENT_R3_BUILDER: AgentRecord = {
  id: R3_BUILDER.id,
  displayName: R3_BUILDER.displayName,
  description: null,
  status: 'active',
  avatarUrl: null,
  provider: 'r3-gw',
  modelId: 'claude-sonnet-5',
  thinkingLevel: null,
  tools: [],
  secrets: [],
  defaultSkill: null,
  skillsAllowlist: null,
  mcpServers: [],
};

/** Agent 详情 + 创建弹窗模型位的数据集：团队页 roster 与详情页记录同场景，
 *  团队页卡点进详情后 `?scenario=agent-detail` 随行（#121 Link 律）不会丢。
 *  resources 在 RESOURCES 之上补空 memories（记忆 tab 走 shared canon 空态）。
 *  本集不带 providers（#770 起 picker 不再读 providers 段）与 secrets（密钥区
 *  走零密钥空态，#510：无密钥时不出开关，没有对象可授）；memories 的两形
 *  （空 / 非空）由下面两个导出件分持。 */
const AGENT_DETAIL_RESOURCES: ResourcesContent = {
  ...RESOURCES,
  memories: [],
};

export const agentDetail: FixtureSet = {
  ...teamGrid,
  agents: [AGENT_R3_BUILDER],
  resources: AGENT_DETAIL_RESOURCES,
};

/** #510 密钥区聚合总开关的数据集：两个团队密钥 + 一个未授权的 Agent。
 *  两个密钥是有意的——per-secret 粒度回退会渲染两行，e2e 的「恰好一行」
 *  才有牙（只播一个密钥时两种实现都过）。 */
const AGENT_DETAIL_SECRETS: SecretRecord[] = [
  { id: 'secret-stripe', teamId: TEAM_ID, name: 'STRIPE_API_KEY', description: null },
  { id: 'secret-npm', teamId: TEAM_ID, name: 'NPM_TOKEN', description: null },
];

export const agentDetailSecrets: FixtureSet = {
  ...agentDetail,
  resources: { ...AGENT_DETAIL_RESOURCES, secrets: AGENT_DETAIL_SECRETS },
};

/** #499 named scenario（无 capture，agentDetail 先例）：记忆 tab 的非空语料。
 *  r5 §6 捕获（截图 134）只有 1 条记忆（`记忆 · 1 / 100`），多行排序在那份
 *  语料里长不出来；这里给 r3-builder 合成 3 条。三处刻意安排：
 *  · 列序（旧 → 新）与标题序不同——`默认`（到达序）与 `添加时间`（新 → 旧）
 *    两档才分得开；
 *  · 只有第 2 条的 content 含 `probe`、只有第 3 条的 title 含 `PROBE`——搜索
 *    的「命中 content」与「ASCII 大小写不敏感」各钉一条；
 *  · `添加时间` 档下两档的先后正好对调。
 *  供 ./e2e/agent-detail.spec.ts 钉配额头、搜索过滤与排序。 */
const AGENT_MEMORY_ROWS: MemoryRecord[] = [
  {
    id: 'mem-r5-1',
    agentId: R3_BUILDER.id,
    teamId: TEAM_ID,
    title: '构建分支的命名规律',
    content: '构建分支固定 agent/<运行 id>，不再挂日期后缀。',
    projectId: PROJECT_ID,
    sourceTodoId: null,
    sourceBuildId: null,
    createdAt: boardDefault.now - 180 * 60_000,
    updatedAt: boardDefault.now - 180 * 60_000,
  },
  {
    id: 'mem-r5-2',
    agentId: R3_BUILDER.id,
    teamId: TEAM_ID,
    title: '验收只看真机跑通',
    content: '本地绿不算数，要在 probe 机器上真跑一遍再报完成。',
    projectId: PROJECT_ID,
    sourceTodoId: null,
    sourceBuildId: null,
    createdAt: boardDefault.now - 120 * 60_000,
    updatedAt: boardDefault.now - 120 * 60_000,
  },
  {
    id: 'mem-r5-3',
    agentId: R3_BUILDER.id,
    teamId: TEAM_ID,
    title: 'PROBE 探针的历史轮次',
    content: 'r3、r5b、r6、r7 每轮各留一个 commit 收尾。',
    projectId: PROJECT_ID,
    sourceTodoId: null,
    sourceBuildId: null,
    createdAt: boardDefault.now - 60 * 60_000,
    updatedAt: boardDefault.now - 60 * 60_000,
  },
];

export const agentDetailMemory: FixtureSet = {
  ...agentDetail,
  resources: { ...AGENT_DETAIL_RESOURCES, memories: AGENT_MEMORY_ROWS },
};

/** Agent 详情「进行中」段的非空语料（无 capture，agentDetail 先例——r3 53
 *  截图拍到的正是空态「暂无进行中的任务」，行态在观测窗口里长不出来）。
 *  两行刻意分持两个状态支：第 1 行 `state:'waiting'`（build 已建、等机器，
 *  消费面把它渲染成 `queued` 的 chip），第 2 行 `state:null`（跑起来了，
 *  chip 直接吃 todo.phase 的 `building`）。标题取自参考账号里真实存在的两条
 *  todo（seq 12 / 13），不是编的。
 *  供 ./e2e/agent-detail.spec.ts 钉行形状、状态位映射与点击落点。 */
const AGENT_TASK_ROWS: AgentTask[] = [
  {
    kind: 'build',
    state: 'waiting',
    buildId: 'r3-conv-task-12',
    todo: {
      id: 'r3-legacy-12',
      seqNum: 12,
      title: 'README 文档目录 + 新建 CHANGELOG.md + scripts/',
      phase: 'queued',
    },
  },
  {
    kind: 'build',
    state: null,
    buildId: 'r3-conv-task-13',
    todo: {
      id: 'r3-legacy-13',
      seqNum: 13,
      title: '给 README.md 增加「项目结构」一节并链接贡献指南',
      phase: 'building',
    },
  },
];

export const agentDetailActive: FixtureSet = {
  ...agentDetail,
  agentTasks: AGENT_TASK_ROWS,
};

/** #741 named scenario（无 capture，chief-md / agentDetail 先例）：agent 身份
 *  可点进设置的两面语料。① 抽屉 robot 行身份 chip——chief.agent 带 id（live
 *  mapper 恒带，fixture 面特意给 id 才钉得住「成链」面；无 id 惰性面由单测
 *  test/chief-identity.test.ts 钉）；② 提及 chip——robot markdown 携五种
 *  scheme 的 mention wire：agent/todo 成链（#741/#675 两个导航面），
 *  skill/project/machine 保持惰性 span（参考站落点未实拍取证，票面明确不入
 *  本票——字面负例要有牙，三种同播）。detail transcript 同场景带一条 agent
 *  提及——segments 单源的两个消费面（抽屉 + 详情页对话）一套语料钉齐。
 *  agents 复用 AGENT_R3_BUILDER：身份 chip 点击后 scenario 按 #121 Link 律
 *  随行，Agent 详情页解析出真记录（fixture 面全链）。 */
const CHIEF_AGENT_CHIP_REPLY = [
  '派工回执：由 [r5-scribe](agent:a1) 复核 [#1](todo:r3-legacy-1)。',
  '',
  '技能 [deploy](skill:s1)、项目 [web](project:p1) 与机器 [box](machine:m1) 的提及保持惰性。',
].join('\n');

export const chiefAgentChip: FixtureSet = {
  ...agentDetail,
  todos: [legacyReview, legacyDone],
  chief: {
    view: 'drawer',
    bound: true,
    modelSlot: 'claude-sonnet-5 · 默认',
    threadTitle: '验证一下凭证链路…',
    agent: { id: R3_BUILDER.id, displayName: R3_BUILDER.displayName, avatarUrl: null },
    stream: [
      { kind: 'note', text: '17:26' },
      { kind: 'user', text: '验证一下凭证链路，然后给我一份报告' },
      {
        kind: 'robot',
        markdown: CHIEF_AGENT_CHIP_REPLY,
        seconds: '44s',
      },
    ],
  },
  detail: {
    transcript: [
      { kind: 'run', at: '13:35', machine: 'xmonsMac-3574' },
      { kind: 'user', text: '开始执行任务', seq: 1 },
      {
        kind: 'robot',
        markdown: '凭证复核由 [r5-scribe](agent:a1) 承接，完成后汇报。',
        footer: { seconds: 12 },
      },
    ],
  },
};

/** XMON-19/B2 删除 Agent 的 e2e 语料（命名场景无 capture，agent-detail
 *  先例）：roster 两个 Agent——删掉 r3-builder 后名单里还剩一个，卡随行消失
 *  这一条才有牙（只播一个 Agent 时「删对了」与「整块空掉」两种实现都过）。
 *  邻居字段形状照 todos.dev 实测 members 行。 */
const AGENT_DELETE_NEIGHBOR: TeamContent['agents'][number] = {
  id: 'r3-qa',
  displayName: 'r3-qa',
  model: 'claude-sonnet-5',
  isDefault: false,
  role: '负责回归测试与验收。',
};

export const agentDelete: FixtureSet = {
  ...agentDetail,
  team: { members: 2, agents: [...TEAM_R7.agents, AGENT_DELETE_NEIGHBOR] },
};

/** #444 named scenario（无 capture，notify-banner 先例）：绑定 Agent 的
 *  头像骑上总管 FAB。一套内容同时供 board（.chief-fab）与 team（secondary
 *  壳的 总管 FAB，#947 起载体 = aria-label）两个消费点（projectFixture
 *  多路由单集先例）；
 *  chiefUnread 2 钉角标与头像共存面。avatarUrl null = dicebear 按
 *  displayName 种子生成，e2e 钉图标来源切换（chief-fab.spec），非像素。 */
const FAB_AVATAR_CHIEF: ChiefContent = {
  // ADR 0013 D4：FAB 与窗互斥——FAB 面的捕获形 = 关窗态（view: 'none'；
  // 旧形抽屉开态仍挂 FAB，互斥退役该共存面）；#444 钉面是 FAB 头像，不是窗。
  view: 'none',
  bound: true,
  modelSlot: 'claude-sonnet-5 · 默认',
  threadTitle: '新主题',
  examples: CHIEF_EXAMPLES,
  agent: { displayName: R3_BUILDER.displayName, avatarUrl: null },
};

export const chiefFabAvatar: FixtureSet = {
  ...teamGrid,
  chiefUnread: 2,
  chief: FAB_AVATAR_CHIEF,
};

/** 同面的 avatarUrl 覆盖变体：覆盖值赢过 dicebear 生成（Avatar 原语语义
 *  在 FAB 层的透传钉）；资产用本地 /avatar-robot-2.svg，零网络。 */
export const chiefFabAvatarOverride: FixtureSet = {
  ...teamGrid,
  chiefUnread: 2,
  chief: {
    ...FAB_AVATAR_CHIEF,
    agent: { displayName: R3_BUILDER.displayName, avatarUrl: '/avatar-robot-2.svg' },
  },
};

/** One created API key exercising both r3 §6 display rules: the list row
 *  mask and the one-time plaintext (02 §8 canon copy rides along in the
 *  page). Mask rule = 品牌前缀 + 前 8 hex + 省略号（r3 §6 observed sample
 *  `tds_afe07565…`；前缀随 BRAND.apiKeyPrefix 槽，#109）。 */
const API_KEY_PLAINTEXT = `${BRAND.apiKeyPrefix}afe07565b3c9d2e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0`;
const API_KEY_CREATED: ApiKeyRecord = {
  id: 'apikey-r7-1',
  name: null,
  masked: maskApiKey(API_KEY_PLAINTEXT),
  gitAccess: true,
  mcpAccess: true,
  plaintext: API_KEY_PLAINTEXT,
};

/** API-keys route fixture with the created key; the empty state (r2 19)
 *  is the fixture-less fallback. */
export const apiKeysCreated: FixtureSet = {
  todos: boardDefault.todos,
  now: boardDefault.now,
  apiKeys: { keys: [API_KEY_CREATED] },
}; /* ---- r8 overlay batch (#66): dark captures 78–81, shot 2026-09-22
   23:41–23:45 on the live space. The board behind them carries the
   session's own probe #16 plus the concurrent r8-dynamic ticket's #15
   and its #11–#14 leftovers; all transcribed off the captures, never
   touched on the live space. ---- */

/** r8 capture day. */
export const R8_DAY = '2026-09-22';
/** r8 capture-day timestamp. */
export const r8 = (h: number, m: number) => at(R8_DAY, h, m);

/** r8-dynamic ticket probe #15 (concurrent session, left untouched):
 *  planning while 54 shot, confirm by 57. */
function dyn15(phase: TodoRecord['phase']): TodoRecord {
  return {
    id: 'r8-dynamic-15',
    teamId: TEAM_ID,
    projectId: PROJECT_ID,
    title: '在 README.md 末尾追加一行「r8 dynamic probe」',
    spec: '在 README.md 末尾追加一行「r8 dynamic probe」',
    phase,
    phaseAt: r8(23, 39),
    seqNum: 15,
    orderIndex: 0,
    tagIds: [],
    assignment: { agentId: R3_BUILDER.id },
    agent: R3_BUILDER,
    latestBuildId: 'r8-dynamic-conv-15',
    lastRunAt: r8(23, 39),
    hasChanges: false,
    hasPlan: false,
    buildHistory: [{ buildId: 'r8-dynamic-conv-15', createdAt: r8(23, 39) }],
    sourceTodo: null,
    v: 2,
  };
}

/** r8-dynamic ticket's failed #12 (执行中 column, 重试 button, 5 小时前). */
const dyn12Failed: TodoRecord = {
  id: 'r8-dynamic-12',
  teamId: TEAM_ID,
  projectId: PROJECT_ID,
  title: 'README 文档目录 + 新建 CHANGELOG.md + scripts/hello.js',
  spec: 'README 文档目录 + 新建 CHANGELOG.md + scripts/hello.js',
  phase: 'failed',
  phaseAt: r8(18, 44),
  seqNum: 12,
  orderIndex: 0,
  tagIds: [],
  assignment: { agentId: R3_BUILDER.id },
  agent: R3_BUILDER,
  latestBuildId: 'r8-dynamic-conv-12',
  lastRunAt: r8(18, 44),
  hasChanges: false,
  hasPlan: false,
  buildHistory: [{ buildId: 'r8-dynamic-conv-12', createdAt: r8(18, 40) }],
  sourceTodo: null,
  v: 3,
};

/** r8-dynamic ticket's review/done leftovers (#13 待验收, #14/#11 已完成;
 *  #1/#2 are the r3 legacy pair, still on the board). */
function dynLeftover(
  seq: number,
  title: string,
  phase: TodoRecord['phase'],
  hoursAgo: number,
): TodoRecord {
  return {
    id: `r8-dynamic-${seq}`,
    teamId: TEAM_ID,
    projectId: PROJECT_ID,
    title,
    spec: title,
    phase,
    phaseAt: r8(23 - hoursAgo, 44),
    seqNum: seq,
    orderIndex: 0,
    tagIds: [],
    assignment: { agentId: R3_BUILDER.id },
    agent: R3_BUILDER,
    latestBuildId: `r8-dynamic-conv-${seq}`,
    lastRunAt: r8(23 - hoursAgo, 44),
    hasChanges: phase === 'review' || phase === 'done',
    hasPlan: phase === 'review',
    buildHistory: [{ buildId: `r8-dynamic-conv-${seq}`, createdAt: r8(23 - hoursAgo, 40) }],
    sourceTodo: null,
    v: 3,
  };
}

const R8_LEFTOVERS = [
  dynLeftover(13, '给 README.md 增加「项目结构」一节并链接贡献指南', 'review', 6),
  dynLeftover(14, '给 index.html 的页面标题加上项目名后缀', 'done', 6),
  dynLeftover(11, '编写 CONTRIBUTING.md 贡献指南', 'done', 6),
];

/** This ticket's probe #16 (created 23:42, deleted 23:45 — zero residue). */
function probe16(phase: TodoRecord['phase'], phaseAt: number): TodoRecord {
  return {
    id: 'u_B5ngeVOlKdKbG_4H9Cl',
    teamId: TEAM_ID,
    projectId: PROJECT_ID,
    title: 'r8-overlay-dark 探针',
    spec: 'r8-overlay-dark 探针',
    phase,
    phaseAt,
    seqNum: 16,
    orderIndex: 0,
    tagIds: [],
    assignment: phase === 'todo' ? null : { agentId: R3_BUILDER.id },
    agent: phase === 'todo' ? null : R3_BUILDER,
    latestBuildId: phase === 'todo' ? null : R8_BUILD_ID,
    lastRunAt: phase === 'todo' ? null : r8(23, 43),
    hasChanges: false,
    hasPlan: phase === 'confirm',
    buildHistory: phase === 'todo' ? [] : [{ buildId: R8_BUILD_ID, createdAt: r8(23, 43) }],
    sourceTodo: null,
    v: 2,
  };
}

/** r8 build id of probe #16 (synthetic: the record never survived the
 *  session, same precedent as r7 probe #10). */
const R8_BUILD_ID = 'r8-conv-overlay-16';

/** Probe #16 plan document, verbatim from the 56 doc pane: markdown
 *  headings + file/commit reference spans (blue mono chips). */
const R8_PLAN_DOC: DocBlock[] = [
  { kind: 'head', segments: [{ text: 'Context' }] },
  {
    kind: 'para',
    segments: [
      { text: 'r3-lifecycle 是一个纯静态单页仓库（' },
      { text: 'index.html', style: 'link' },
      { text: ' + ' },
      { text: 'README.md', style: 'link' },
      { text: '，无构建/测试/CI）。历史上每一轮 rN 探针任务（r3、r5b、r6、r7，见 ' },
      { text: 'README.md', style: 'link' },
      { text: ' 现有内容及对应 commit ' },
      { text: '2f47b62', style: 'link' },
      { text: '、' },
      { text: '386b8e4', style: 'link' },
      { text: '、' },
      { text: '1cecf83', style: 'link' },
      { text: '、' },
      { text: '2cceb9d', style: 'link' },
      { text: '）都遵循同一套路：在 ' },
      { text: 'README.md', style: 'link' },
      { text: ' 末尾追加一行 "' },
      { text: '<探针名> probe', style: 'link' },
      { text: '" 文本，作为该轮次生命周期/rebaseline 探针的可验证产物，commit message 统一为 ' },
      { text: 'docs(readme): append <探针名> probe line', style: 'link' },
      { text: '。本次任务 ' },
      { text: 'r8-overlay-dark 探针', style: 'link' },
      {
        text: ' 的 Spec 未给出具体文案，按同一约定执行：追加对应的第 r8 轮探针行，保持仓库内探针记录的连续性。',
      },
    ],
  },
  { kind: 'head', segments: [{ text: '假设' }] },
  {
    kind: 'bullet',
    segments: [
      { text: 'Spec 为空，按仓库既有 r3/r5b/r6/r7 探针的命名与格式惯例，在 ' },
      { text: 'README.md', style: 'link' },
      { text: ' 末尾新增一行：' },
      { text: 'r8 overlay-dark probe', style: 'link' },
      { text: '（对应标题中的 ' },
      { text: 'r8-overlay-dark', style: 'link' },
      { text: '，与既有行如 ' },
      { text: 'r7 rebaseline probe', style: 'link' },
      { text: ' 的措辞风格一致）。' },
    ],
  },
  {
    kind: 'bullet',
    segments: [
      { text: '不改动 ' },
      { text: 'index.html', style: 'link' },
      { text: '、' },
      { text: 'CONTRIBUTING.md', style: 'link' },
      { text: '，本轮探针只涉及 ' },
      { text: 'README.md', style: 'link' },
      { text: '。' },
    ],
  },
  { kind: 'head', segments: [{ text: 'Changes' }] },
  {
    kind: 'bullet',
    segments: [
      { text: 'README.md', style: 'link' },
      { text: '：在文件末尾追加一行 ' },
      { text: 'r8 overlay-dark probe', style: 'link' },
      { text: '，与现有 5 行探针记录（' },
      { text: 'r3 lifecycle probe', style: 'link' },
      { text: ' 等）保持相同的纯文本追加方式，不改动已有内容、不加空行。' },
    ],
  },
  { kind: 'head', segments: [{ text: 'Verification' }] },
  {
    kind: 'bullet',
    segments: [
      { text: 'git diff README.md', style: 'code' },
      { text: ' 确认只新增一行 ' },
      { text: 'r8 overlay-dark probe', style: 'link' },
      { text: '，无其他改动。' },
    ],
  },
  {
    kind: 'bullet',
    segments: [
      { text: 'git log --oneline -1', style: 'code' },
      { text: ' 确认提交信息符合约定：' },
      { text: 'docs(readme): append r8 overlay-dark probe line', style: 'link' },
      { text: '。' },
    ],
  },
  {
    kind: 'bullet',
    segments: [
      {
        text: '用变更审阅（change review）里 README.md 的预览按钮确认渲染正常、新行显示在列表末尾。',
      },
    ],
  },
];

/** Probe #16 transcript at confirm (r8 80): stamp, start bubble with the
 *  taskline, the agent's spec-empty note, plan card `完成 2m 41s`. */
const R8_CONFIRM_TRANSCRIPT: TranscriptItem[] = [
  { kind: 'run', at: '23:43', machine: MACHINE_NAME },
  { kind: 'user', text: '开始执行任务', seq: 16, title: 'r8-overlay-dark 探针' },
  {
    kind: 'robot',
    paragraphs: [
      [
        {
          text: '该任务的 Spec 为空，只有标题「r8-overlay-dark 探针」。参照仓库里 r3~r7 同类型探针 commit（如 ',
        },
        { text: 'docs(readme): append r7 rebaseline probe line', style: 'code' },
        {
          text: '）的固定套路——在 README.md 末尾追加一行与探针名对应的文本——我按同一约定生成本次改动的具体文案，并在计划中的「假设」里写明。',
        },
      ],
    ],
  },
  {
    kind: 'plan',
    title: '方案 · v1',
    preview:
      'Context r3-lifecycle 是一个纯静态单页仓库（index.html + README.md，无构建/测试/CI）。历史上每一轮 rN 探针任务（r3、r5b、r6、r7，见 README.md 现有内容及对应 commit 2f47b62、386b8e4、1cecf83、2cceb9d）都遵循…',
    seconds: 161,
  },
];

/** r8 78: board at 23:41 — #15 planning (streaming card behind the
 *  dialog), #12 failed with 重试, the legacy pair in 待验收/已完成 plus
 *  the dynamic ticket's done leftovers. */
export const boardR8Overlay: FixtureSet = {
  todos: [dyn15('planning'), dyn12Failed, legacyReview, ...R8_LEFTOVERS, legacyDone],
  now: r8(23, 44),
  usageNav: true,
};

/** r8 81: probe #16 fresh detail at 23:43 (#15 already confirm → badge 3). */
export const detailR8Fresh: FixtureSet = {
  todos: [
    probe16('todo', r8(23, 42)),
    dyn15('confirm'),
    dyn12Failed,
    legacyReview,
    ...R8_LEFTOVERS,
    legacyDone,
  ],
  now: r8(23, 43),
  usageNav: true,
};

/** r8 82: probe #17 (created 2026-09-23 00:34, deleted 00:36 — zero
 *  residue), fresh detail under the delete confirm. Badge 2 in the
 *  capture → #15 already out of confirm by then; the fresh surface keeps
 *  this pair clear of the doc-pane/taskline drift the 79/80 pairs hit. */
const probe17Fresh: TodoRecord = {
  id: 'r8-delete-17',
  teamId: TEAM_ID,
  projectId: PROJECT_ID,
  title: 'r8-delete-dark 探针',
  spec: 'r8-delete-dark 探针',
  phase: 'todo',
  phaseAt: at('2026-09-23', 0, 34),
  seqNum: 17,
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

export const detailR8DeleteFresh: FixtureSet = {
  todos: [probe17Fresh, dyn15('done'), dyn12Failed, legacyReview, ...R8_LEFTOVERS, legacyDone],
  now: at('2026-09-23', 0, 35),
  usageNav: true,
};

/** r8 80/79: probe #16 confirm detail at 23:44 (badge 4), the surface the
 *  更多 menu and the delete confirm sit over. */
export function detailR8Confirm(): FixtureSet {
  return {
    todos: [
      probe16('confirm', r8(23, 43)),
      dyn15('confirm'),
      dyn12Failed,
      legacyReview,
      ...R8_LEFTOVERS,
      legacyDone,
    ],
    now: r8(23, 44),
    usageNav: true,
    detail: { transcript: R8_CONFIRM_TRANSCRIPT, doc: R8_PLAN_DOC },
  };
}

export const resourcesDefault: FixtureSet = {
  todos: [legacyReview, legacyDone],
  now: r7(13, 14),
  resources: RESOURCES,
};

/** #356 未安装分支 canon（spec 11 §A4）：机器上既没有 settings.json 也没有
 *  claude 二进制 → header 转「未安装」指引态、模型行零渲染。#1050 起
 *  「没装」在 wire 上是 `bin: null`（探过了没有），不是键缺席。 */
export const resourcesCcMissing: FixtureSet = {
  ...resourcesDefault,
  resources: {
    ...RESOURCES,
    providerSources: [
      PROVIDER_SOURCE_PI,
      {
        runtime: 'claude-code',
        installed: false,
        hostname: MACHINE_NAME,
        models: [],
        bin: null,
      },
    ],
  },
};

/** #1050 配置文件在但二进制没了：settings.json 照常解出模型槽，探测结论是
 *  没有二进制 → 主句「未安装」（消掉旧行为的假绿）。scenario = 10-cc-bin-gone。 */
export const resourcesCcBinGone: FixtureSet = {
  ...resourcesDefault,
  resources: {
    ...RESOURCES,
    providerSources: [{ ...PROVIDER_SOURCE_CC, bin: null }],
  },
};

/** #1050 老 daemon（没探过）：`bin` 键整个缺席 → 页面维持「只看 installed」
 *  的旧行为，且不出现细字行、不写「未知」。scenario = 10-cc-legacy。 */
export const resourcesCcLegacy: FixtureSet = {
  ...resourcesDefault,
  resources: {
    ...RESOURCES,
    providerSources: [{ ...PROVIDER_SOURCE_CC, bin: undefined }],
  },
};

/** #1050 装了没配态：二进制在、settings.json 缺（或没写槽）→ 主句「已安装，
 *  未配置模型槽」+ 配置补法句（与「没装」的补法不同），模型行零渲染。
 *  scenario = 10-cc-noconfig。 */
export const resourcesCcNoConfig: FixtureSet = {
  ...resourcesDefault,
  resources: {
    ...RESOURCES,
    providerSources: [
      PROVIDER_SOURCE_PI,
      {
        runtime: 'claude-code',
        installed: false,
        hostname: MACHINE_NAME,
        models: [],
        bin: { path: '/home/u/.local/bin/claude', version: '2.1.289' },
      },
    ],
  },
};

/** #1050 未登录态：二进制与配置都在、凭据态 = not-logged-in → 细字行尾加
 *  「未登录」角标（主句不变——「装没装」与「登没登」是两个维度）。
 *  scenario = 10-cc-loggedout。 */
export const resourcesCcLoggedOut: FixtureSet = {
  ...resourcesDefault,
  resources: {
    ...RESOURCES,
    providerSources: [
      PROVIDER_SOURCE_PI,
      { ...PROVIDER_SOURCE_CC, auth: { state: 'not-logged-in', provider: 'firstParty' } },
    ],
  },
};

/** #895 机器页三态读标注命名场景（无 capture，newtask-machines 先例）：
 *  resourcesDefault 面 + 三机行集——本机（主力机徽标）+ 在线远端（回合
 *  进行中）+ 离线远端（等待机器）。e2e 钉三态标注的展示形与「标注零
 *  控件」纪律；live 全链真值归 verify 证据（docs/verify/865/）。 */
export const machinesChiefState: FixtureSet = {
  ...resourcesDefault,
  resources: {
    ...RESOURCES,
    machines: [
      {
        id: MACHINE_ID,
        kind: 'local',
        name: MACHINE_NAME,
        online: true,
        enabledRuntimes: ['pi'],
        shellEnabled: false,
        chiefHost: true,
      },
      { id: 'mea-wsl-online', kind: 'remote', name: 'mea-wsl', online: true, chiefRunning: true },
      {
        id: 'vps-relay-offline',
        kind: 'remote',
        name: 'vps-relay',
        online: false,
        chiefWaiting: true,
      },
    ],
  },
};

// ---- issue #75: r8 dynamic-state sets (reject loop / failed / reuse) ----
// Content verbatim from the r8 captures 54–77 (docs/research/r8-dynamic-
// states.md §1–§3) plus the raw geometry dumps. Two session days: the
// evening of 2026-09-22 (23:1x–23:5x) and the minutes past midnight
// (00:0x, 2026-09-23) — the `昨天 17:38` stamp flip in 57 pins the split.

/** r8 past-midnight (2026-09-23). */
const r8n = (h: number, m: number) => at('2026-09-23', h, m);

/** #12: r5-leftover failed todo, chief-launched, no plan document
 *  (r8 §3.4: hence no 复用方案 button on its rerun dialog). */
const failed12: TodoRecord = {
  id: 'r8-12',
  teamId: TEAM_ID,
  projectId: PROJECT_ID,
  title: 'README 文档目录 + 新建 CHANGELOG.md + scripts/hello.js',
  spec: 'README 文档目录 + 新建 CHANGELOG.md + scripts/hello.js',
  phase: 'failed',
  phaseAt: r8(17, 38),
  seqNum: 12,
  orderIndex: 0,
  tagIds: [],
  assignment: { agentId: R3_BUILDER.id },
  agent: R3_BUILDER,
  latestBuildId: 'r8-conv-12',
  lastRunAt: r8(17, 38),
  hasChanges: true,
  hasPlan: false,
  buildHistory: [{ buildId: 'r8-conv-12', createdAt: r8(17, 38) }],
  sourceTodo: null,
  v: 3,
};

/** #13: review todo of the r8 session — only ever off-screen (board
 *  column 5 sliver) but counted by the 看板 badge (r8 55/57). */
const review13: TodoRecord = {
  id: 'r8-13',
  teamId: TEAM_ID,
  projectId: PROJECT_ID,
  title: 'r8 session review probe',
  spec: 'r8 session review probe',
  phase: 'review',
  phaseAt: r8(22, 50),
  seqNum: 13,
  orderIndex: 0,
  tagIds: [],
  assignment: { agentId: R3_BUILDER.id },
  agent: R3_BUILDER,
  latestBuildId: 'r8-conv-13',
  lastRunAt: r8(22, 40),
  hasChanges: true,
  hasPlan: true,
  buildHistory: [{ buildId: 'r8-conv-13', createdAt: r8(22, 40) }],
  sourceTodo: null,
  v: 2,
};

const R8_TITLE = '在 README.md 末尾追加一行「r8 dynamic probe」';

/** #15 in the given phase (probe of the r8 session). */
function probe15(phase: TodoRecord['phase'], phaseAt: number): TodoRecord {
  return {
    id: 'r8-15',
    teamId: TEAM_ID,
    projectId: PROJECT_ID,
    title: R8_TITLE,
    spec: R8_TITLE,
    phase,
    phaseAt,
    seqNum: 15,
    orderIndex: 0,
    tagIds: [],
    assignment: { agentId: R3_BUILDER.id },
    agent: R3_BUILDER,
    latestBuildId: 'r8-conv-15',
    lastRunAt: r8(23, 40),
    hasChanges: phase === 'failed' || phase === 'review' || phase === 'done',
    hasPlan: phase !== 'todo',
    buildHistory: [
      { buildId: 'r8-conv-15', createdAt: r8(23, 40) },
      ...(phase === 'review' || phase === 'building'
        ? [{ buildId: 'r8-conv-15b', createdAt: r8n(0, 2) }]
        : []),
    ],
    sourceTodo: null,
    v: 4,
  };
}

/** #12 changeset (r8 54): three files, +15. */
const CHANGES_12: ChangesContent = {
  expanded: false,
  files: [
    { path: 'CHANGELOG.md', added: 9, hunks: [] },
    { path: 'README.md', added: 4, hunks: [] },
    { path: 'scripts/hello.js', added: 2, hunks: [] },
  ],
};

/** #15 changeset (r8 73/77): README.md +1. */
const CHANGES_15: ChangesContent = {
  expanded: false,
  files: [{ path: 'README.md', added: 1, hunks: [] }],
};

/** #12 transcript (r8 54): chief-launched run, result message, failed
 *  merge round. `stamp` flips to `昨天 17:38` past midnight (57). */
function transcript12(stamp: string): TranscriptItem[] {
  return [
    { kind: 'run', at: stamp, machine: MACHINE_NAME },
    { kind: 'chief' },
    { kind: 'user', text: '开始执行任务', seq: 12, title: failed12.title },
    {
      kind: 'robot',
      paragraphs: [
        {
          segments: [
            { text: '验证通过，输出为 ' },
            { text: 'hello', style: 'code' },
            { text: '。' },
          ],
        },
        { segments: [{ text: '三项改动均已完成：' }] },
        {
          bullet: true,
          segments: [
            { text: 'README.md', style: 'code' },
            { text: ': 新增「文档目录」章节，列出 ' },
            { text: 'CONTRIBUTING.md', style: 'code' },
            { text: ' 链接（该文件由 ' },
            { text: '#11', style: 'code' },
            { text: ' 负责，尚未合并，链接暂时指向不存在的文件属预期）。' },
          ],
        },
        {
          bullet: true,
          segments: [
            { text: 'CHANGELOG.md', style: 'code' },
            { text: ': 新建文件，写入初始条目。' },
          ],
        },
        {
          bullet: true,
          segments: [
            { text: 'scripts/hello.js', style: 'code' },
            { text: ': 新增脚本，' },
            { text: 'node scripts/hello.js', style: 'code' },
            { text: ' 运行打印 ' },
            { text: 'hello', style: 'code' },
            { text: '（已本地验证）。' },
          ],
        },
      ],
      footer: { seconds: 28 },
    },
    { kind: 'note', text: '18:18' },
    { kind: 'note', text: 'Xmon Dai 发起了合并' },
    {
      kind: 'fail',
      title: '运行该任务的机器已离线',
      body: '请将其重新上线，或重新运行任务以改派其他机器。',
      links: ['查看原始错误', '排查指南'],
    },
  ];
}

/** plan.md section paragraph per version wording (`w` = the appended
 *  line; r8 63/76 doc panes). The first README.md chip is link-styled. */
function planDoc(w: string, withCommit: boolean, msg: string): DocBlock[] {
  const blocks: DocBlock[] = [
    { kind: 'head', segments: [{ text: 'Context' }] },
    {
      kind: 'para',
      segments: [
        { text: '仓库根目录的 ' },
        { text: 'README.md', style: 'link' },
        { text: ' 目前内容为逐行累积的"探针记录"（' },
        { text: 'r3 lifecycle probe', style: 'code' },
        { text: '、' },
        { text: 'r6 rebaseline probe', style: 'code' },
        { text: '、' },
        { text: 'r7 rebaseline probe', style: 'code' },
        {
          text: ' 等），每次任务在文件末尾新增一行文字，文件以换行符结尾。本次任务按同样的惯例，在文件末尾追加一行 ',
        },
        { text: w, style: 'code' },
        { text: '。' },
      ],
    },
    { kind: 'head', segments: [{ text: '改动' }] },
    {
      kind: 'bullet',
      segments: [
        { text: 'README.md', style: 'link' },
        { text: ': 在文件末尾追加新的一行 ' },
        { text: w, style: 'code' },
        { text: '，保持文件以换行符结尾（与现有各行格式一致），不修改任何已有内容。' },
      ],
    },
  ];
  if (withCommit) {
    blocks.push({
      kind: 'bullet',
      segments: [
        { text: '提交：改动完成后需创建一次 commit，遵循仓库历史惯例（如 ' },
        { text: 'docs(readme): append r7 rebaseline probe line', style: 'code' },
        { text: '），本次 commit message 使用 ' },
        { text: msg, style: 'code' },
        { text: '。' },
      ],
    });
  }
  blocks.push(
    { kind: 'head', segments: [{ text: '验证' }] },
    {
      kind: 'bullet',
      segments: [
        { text: '执行 ' },
        { text: 'cat README.md', style: 'code' },
        { text: ' 或 ' },
        { text: 'tail -1 README.md', style: 'code' },
        { text: '，确认最后一行为 ' },
        { text: w, style: 'code' },
        { text: '。' },
      ],
    },
    {
      kind: 'bullet',
      segments: [
        { text: '执行 ' },
        { text: 'git diff README.md', style: 'code' },
        { text: '，确认只新增了一行 ' },
        { text: `+${w}`, style: 'code' },
        { text: '，没有改动其他内容。' },
      ],
    },
  );
  return blocks;
}

const DYNAMIC = 'r8 dynamic probe';
const MANUAL = 'r8 probe manual-revision';
const MSG_DYNAMIC = 'docs(readme): append r8 dynamic probe line';
const MSG_MANUAL = 'docs(readme): append r8 probe manual-revision line';

const DOC_V1 = planDoc(DYNAMIC, false, MSG_DYNAMIC);
const DOC_V2 = planDoc(DYNAMIC, true, MSG_DYNAMIC);
const DOC_V3 = planDoc(MANUAL, true, MSG_MANUAL);

/** Plan-card preview line of the #15 plan cards (r8 63/68/73/76): the
 *  two-line clamp cut lands before the version wording, so every version
 *  shares this truncation, ellipsis included. */
const R8_PLAN_PREVIEW =
  'Context 仓库根目录的 README.md 目前内容为逐行累积的"探针记录"（r3 lifecycle probe、r6 rebaseline probe、r7 rebaseline probe 等），每次任务在文件末尾新增一行文字，文件以换行符结尾。本次任务按同样的惯例，在文件末尾…';

/** plan.md line list per version (diff source of truth). */
function planLines(w: string, msg: string | null): string[] {
  return [
    '## Context',
    `仓库根目录的 README.md 目前内容为逐行累积的"探针记录"（r3 lifecycle probe、r6 rebaseline probe、r7 rebaseline probe 等），每次任务在文件末尾新增一行文字，文件以换行符结尾。本次任务按同样的惯例，在文件末尾追加一行 ${w}。`,
    '',
    '## 改动',
    `- README.md: 在文件末尾追加新的一行 ${w}，保持文件以换行符结尾（与现有各行格式一致），不修改任何已有内容。`,
    ...(msg != null
      ? [
          `- 提交：改动完成后需创建一次 commit，遵循仓库历史惯例（如 docs(readme): append r7 rebaseline probe line），本次 commit message 使用 ${msg}。`,
        ]
      : []),
    '',
    '## 验证',
    `- 执行 cat README.md 或 tail -1 README.md，确认最后一行为 ${w}。`,
    `- 执行 git diff README.md，确认只新增了一行 +${w}，没有改动其他内容。`,
  ];
}

const NO_NEWLINE = '\\ No newline at end of file';

/** Unified hunk between two plan.md line lists (single hunk, full file).
 *  The trailing no-newline marker rides per side when both sides change
 *  at EOF (r8 72: del marker between the last del and the first add). */
function planHunk(from: string[], to: string[]): DiffHunk {
  // 01-stack-v2 §4.1 pins the diff data layer to npm `diff` 9.0.0 (render
  // stays hand-rolled); the fixture hunks go through the same pin.
  const lines: DiffLine[] = [];
  let oldNo = 0;
  let newNo = 0;
  for (const part of diffLines(from.join('\n'), to.join('\n'))) {
    const rows = part.value.split('\n');
    if (rows[rows.length - 1] === '') rows.pop(); // trailing join separator
    for (const text of rows) {
      if (part.added === true) {
        newNo++;
        lines.push({ kind: 'add', text, newNo });
      } else if (part.removed === true) {
        oldNo++;
        lines.push({ kind: 'del', text, oldNo });
      } else {
        oldNo++;
        newNo++;
        lines.push({ kind: 'context', text, oldNo, newNo });
      }
    }
  }
  // r8 72 renders the no-newline marker per side when both sides change
  // at EOF; add-only diffs (r8 66) carry the single trailing marker
  const lastDel = lines.findLastIndex((l) => l.kind === 'del');
  const firstAdd = lines.findIndex((l) => l.kind === 'add');
  if (lastDel !== -1 && lastDel > firstAdd) {
    lines.splice(lastDel + 1, 0, { kind: 'marker', text: NO_NEWLINE });
  }
  return {
    header: `@@ -1,${from.length} +1,${to.length} @@`,
    lines: [...lines, { kind: 'marker', text: NO_NEWLINE }],
  };
}

/** plan-version diff surface (r8 65–72): one plan.md file, stats derived
 *  from the hunk. */
function planDiff(
  fromV: string,
  toV: string,
  from: string[],
  to: string[],
  expanded: boolean,
): PlanDiffContent {
  const hunk = planHunk(from, to);
  const added = hunk.lines.filter((l) => l.kind === 'add').length;
  const removed = hunk.lines.filter((l) => l.kind === 'del').length;
  return {
    from: fromV,
    to: toV,
    expanded,
    // #244 全文槽:to 版本 plan.md 全文(与 hunk 同源,LINES 数组即版本内容);
    // 初渲不展示,视觉零影响。
    files: [{ path: 'plan.md', added, removed, hunks: [hunk], fullContent: to.join('\n') }],
  };
}

const LINES_V1 = planLines(DYNAMIC, null);
const LINES_V2 = planLines(DYNAMIC, MSG_DYNAMIC);
const LINES_V3 = planLines(MANUAL, MSG_MANUAL);

/** AI-review message of run 1 (r8 60/65): conclusion-first prose, one
 *  numbered blocking finding, the quoted plan line, closing paragraph. */
const REVIEW_MESSAGE: TranscriptItem = {
  kind: 'robot',
  paragraphs: [
    { segments: [{ text: '看好还是坏，直接给结论：' }] },
    { segments: [{ text: 'Please address the points below before coding.' }] },
    {
      ordinal: 1,
      segments: [
        {
          text: '计划完全没有提到提交(commit)这一步。仓库历史显示每次追加探针行都伴随一次格式统一的 commit(如 ',
        },
        { text: 'docs(readme): append r7 rebaseline probe line', style: 'code' },
        {
          text: ')，但计划的"改动"和"验证"部分只字未提是否要创建对应的 commit、以及 commit message 应遵循什么格式。请在计划中补充：追加该行后是否需要提交，若需要，commit message 按照惯例应为类似 ',
        },
        { text: 'docs(readme): append r8 dynamic probe line', style: 'code' },
        { text: ' 的格式。(blocking)' },
      ],
    },
    {
      quote: true,
      segments: [
        { text: 'README.md', style: 'code' },
        { text: '：在文件末尾追加新的一行 ' },
        { text: DYNAMIC, style: 'code' },
        { text: '，保持文件以换行符结尾（与现有各行格式一致），不修改任何已有内容。' },
      ],
    },
    {
      segments: [
        {
          text: '除此之外，计划本身与现有文件内容、格式惯例(每行探针记录、文件以换行符结尾)完全吻合，没有其他问题。',
        },
      ],
    },
  ],
  footer: { seconds: 53 },
};

/** Auto-revision summary after the blocking finding (r8 61/65). */
const ADJUST_V2_MESSAGE: TranscriptItem = {
  kind: 'robot',
  paragraphs: [
    {
      segments: [
        { text: '确认历史提交惯例后，补充 commit 相关说明到计划中。已按反馈补充：查看 ' },
        { text: 'git log --oneline -- README.md', style: 'code' },
        { text: ' 确认历史上每次追加探针行都有对应 commit（如 ' },
        { text: 'docs(readme): append r7 rebaseline probe line', style: 'code' },
        { text: '），在「改动」部分新增一条，明确本次需提交一次 commit，message 为 ' },
        { text: MSG_DYNAMIC, style: 'code' },
        { text: '。' },
      ],
    },
  ],
};

/** Manual-reject revision summary (r8 68). */
const ADJUST_V3_MESSAGE: TranscriptItem = {
  kind: 'robot',
  paragraphs: [
    {
      segments: [
        {
          text: '用户明确要求把追加行文案改为「r8 probe manual-revision」，需要同步更新计划中所有引用该文案的地方（Context、改动、验证），以保持一致；commit message 中的描述性文字也随之同步（因为它直接引用了追加内容，若不改会与实际内容不符），其余结构和逻辑不变。已按用户要求将追加行文案统一改为「r8 probe manual-revision」，同步更新了 Context、改动（含 commit message）和验证三处，其余结构不变。',
        },
      ],
    },
  ],
};

const REJECT_FEEDBACK = '请把追加行的文案改为「r8 probe manual-revision」，其余不变';

/** Run-1 transcript of #15 up to the v2 plan card (r8 62/63). */
const RUN1_TO_V2: TranscriptItem[] = [
  { kind: 'run', at: '23:40', machine: MACHINE_NAME },
  { kind: 'user', text: '开始执行任务', seq: 15, title: R8_TITLE },
  {
    kind: 'robot',
    paragraphs: [
      {
        segments: [{ text: '任务明确：在 README.md 末尾追加探针行，直接规划。' }],
      },
    ],
  },
  { kind: 'plan', title: '方案 · v1', preview: R8_PLAN_PREVIEW, seconds: 31 },
  { kind: 'note', text: 'Xmon Dai 发起了 AI 审核' },
  REVIEW_MESSAGE,
  ADJUST_V2_MESSAGE,
  { kind: 'plan', title: '方案 · v2', preview: R8_PLAN_PREVIEW, seconds: 29 },
];

/** v2 landed (r8 63–66): run-1 transcript, version dropdown rows. */
function detailV2(now: number): FixtureSet {
  return {
    todos: [failed12, review13, probe15('confirm', r8(23, 53))],
    now,
    detail: {
      transcript: RUN1_TO_V2,
      doc: DOC_V2,
      planVersions: [
        { v: 'v2', at: r8(23, 53) },
        { v: 'v1', at: r8(23, 44) },
      ],
    },
  };
}

/** v3 landed (r8 68–72): reject bubble + v3 summary + v3 card; the open
 *  diff auto-rebased to v1 → v3 (r8 §2.7). */
const RUN1_TO_V3: TranscriptItem[] = [
  ...RUN1_TO_V2,
  { kind: 'user', text: REJECT_FEEDBACK },
  ADJUST_V3_MESSAGE,
  { kind: 'plan', title: '方案 · v3', preview: R8_PLAN_PREVIEW, seconds: 49 },
];

function detailV3(now: number): FixtureSet {
  return {
    todos: [failed12, review13, probe15('confirm', r8(23, 56))],
    now,
    detail: {
      transcript: RUN1_TO_V3,
      doc: DOC_V3,
      planVersions: [
        { v: 'v3', at: r8(23, 56) },
        { v: 'v2', at: r8(23, 53) },
        { v: 'v1', at: r8(23, 44) },
      ],
      planDiff: planDiff('v1', 'v3', LINES_V1, LINES_V3, false),
    },
  };
}

/** #15 failed (r8 73–75): v3 round confirmed, execution merged-failed. */
const RUN1_FAILED: TranscriptItem[] = [
  ...RUN1_TO_V3,
  { kind: 'user', text: '确认' },
  {
    kind: 'robot',
    paragraphs: [
      {
        segments: [
          { text: '已在 ' },
          { text: 'README.md', style: 'code' },
          { text: ' 末尾追加一行 ' },
          { text: MANUAL, style: 'code' },
          { text: '，验证通过：' },
          { text: 'tail -1', style: 'code' },
          { text: ' 与 ' },
          { text: 'git diff', style: 'code' },
          { text: ' 均确认仅新增该行，其余内容未改动。' },
        ],
      },
    ],
    footer: { seconds: 29 },
  },
  { kind: 'note', text: 'Xmon Dai 发起了合并' },
  {
    kind: 'fail',
    title: '运行该任务的机器已离线',
    body: '请将其重新上线，或重新运行任务以改派其他机器。',
    links: ['查看原始错误', '排查指南'],
  },
];

function detailFailed15(now: number): FixtureSet {
  return {
    todos: [failed12, probe15('failed', r8n(0, 0))],
    now,
    detail: { transcript: RUN1_FAILED, changes: CHANGES_15 },
  };
}

/** Reused build (r8 76): skipped planning, quoted plan card, second run
 *  stamp split around it, 确认 round streaming. */
const REUSED_TRANSCRIPT: TranscriptItem[] = [
  { kind: 'run', at: '00:02' },
  { kind: 'user', text: '开始执行任务', seq: 15, title: R8_TITLE },
  { kind: 'robot', paragraphs: [{ segments: [{ text: '复用了上一次运行的方案。' }] }] },
  { kind: 'plan', title: '方案 · v1', preview: R8_PLAN_PREVIEW },
  { kind: 'run', machine: MACHINE_NAME },
  { kind: 'user', text: '确认' },
  { kind: 'streaming', seconds: 1, label: '连接机器...' },
];

/** Reused build once it reached review (r8 77 background). */
const REUSED_REVIEW_TRANSCRIPT: TranscriptItem[] = [
  ...REUSED_TRANSCRIPT.slice(0, 5),
  {
    kind: 'robot',
    paragraphs: [
      {
        segments: [
          {
            text: '已在 README.md 末尾追加一行 r8 dynamic probe（任务标题要求的具体文字，与之前计划中占位的 ',
          },
          { text: MANUAL, style: 'code' },
          { text: ' 不同，故以任务标题为准），' },
          { text: 'git diff', style: 'code' },
          { text: ' 确认仅新增了这一行，未改动其他内容。' },
        ],
      },
    ],
    footer: { seconds: 49 },
  },
];

// ---- scenario sets ----

/** Detail-content patch helper: keeps the r8 scenario sets free of
 *  non-null assertions on the optional `detail` field. */
function withDetail(
  base: FixtureSet,
  patch: Partial<NonNullable<FixtureSet['detail']>>,
): FixtureSet {
  const detail = base.detail;
  if (detail == null) return base;
  return { ...base, detail: { ...detail, ...patch } };
}

/** r8 54/56: #12 failed detail, evening now. */
export const detailFailed12: FixtureSet = {
  todos: [failed12, review13],
  now: r8(23, 14),
  detail: { transcript: transcript12('17:38'), changes: CHANGES_12 },
};

/** r8 55: board with the failed #12 card in 执行中. */
export const boardFailed: FixtureSet = {
  todos: [failed12, review13],
  now: r8(23, 14),
  schedules: [],
  project: projectContent,
};

/** r8 56: rerun dialog over #12 (no plan doc → no 复用方案 button)。
 *  #640：dialog 瘦身形（说明行 + 重跑；agent 行/分用开关/双分支已撤销）。 */
export const rerunDialog12: FixtureSet = {
  ...detailFailed12,
  overlay: { kind: 'rerun' },
};

/** r8 57: run history of #12 past midnight (昨天 stamp, 6 小时前 row).
 *  Rows ride the upstream overlayContent mechanism (#68); #366 freezes the
 *  right pane on the history section instead of opening a dialog. */
export const history12: FixtureSet = {
  ...detailFailed12,
  ui: { paneView: 'history' },
};

/** #366 AC 钉面（无 capture，smoke scenario）：review 变更面 + 线程内折叠
 *  plan 卡行——plan 卡激活入口（右 pane 切文档面 plan 显示面）需要「变更面
 *  + 线程含 plan 卡」的组合面，r7/r8 捕获均无此组合。 */
export const planOpenReview: FixtureSet = {
  todos: [probeTodo('review', r7(13, 37))],
  now: r7(13, 40),
  detail: {
    transcript: [
      { kind: 'plan', title: '方案 · v1', preview: R8_PLAN_PREVIEW },
      ...PROBE_BUILD_OPEN,
      PROBE_BUILD_RESULT,
    ],
    doc: DOC_V2,
    changes: probeChanges(true),
  },
};

/** #469 named scenario (no capture, planOpenReview precedent): the chat
 *  surface that exercises the two block-rendering paths — an agent reply
 *  carrying raw block markdown (heading / ordered+unordered nested lists /
 *  code fence / inline code) and a tool group whose bash stdout renders as
 *  left-aligned mono blocks instead of flattening into `.chat-note`. The
 *  robot message holds `markdown` (parsed at render time by
 *  chat-markdown.tsx), so this fixture drives the same parse+render path
 *  as the live mapper. */
const MD_SAMPLE = [
  '## 检查结果',
  '',
  '仓库根目录内容如下，运行 `ls -la` 的输出已折叠在上方工具行。',
  '',
  '1. 第一步：确认目录',
  '   - 子项 A',
  '   - 子项 B',
  '2. 第二步：打印问候',
  '',
  '- 顶层要点',
  '  - 嵌套要点',
  '',
  '```sh',
  'total 16',
  'drwxr-xr-x  4 xmon  staff  128 Sep 30 10:00 .',
  '```',
].join('\n');

const MD_TOOL_PILLS = ['bash ls -la', 'bash echo "hello from pacman"'];
const MD_TOOL_OUTPUTS = [
  'total 16\ndrwxr-xr-x@ 4 xmon  staff  128 Sep 30 10:00 .\ndrwxr-xr-x@ 6 xmon  staff  192 Sep 30 09:00 ..',
  'hello from pacman',
];

const MD_TOOLOUT_TRANSCRIPT: TranscriptItem[] = [
  { kind: 'run', at: '13:35', machine: 'xmonsMac-3574' },
  {
    kind: 'user',
    text: '列出仓库根目录并打印一句问候',
    seq: 9,
    title: '在 README.md 末尾追加一行「r7 rebaseline probe」',
  },
  {
    kind: 'tools',
    seconds: 19,
    expanded: false,
    pills: MD_TOOL_PILLS,
    outputs: MD_TOOL_OUTPUTS,
  },
  { kind: 'robot', markdown: MD_SAMPLE, footer: { seconds: 12 } },
];

export const mdToolout: FixtureSet = {
  todos: [probeTodo('review', r7(13, 37))],
  now: r7(13, 40),
  detail: {
    transcript: MD_TOOLOUT_TRANSCRIPT,
    doc: DOC_V2,
    changes: probeChanges(true),
  },
};

/** #919 named scenario（无 capture，mdToolout 先例）：技能路由行为验收的
 *  UI 面钉扎 #918 落地的那张脸（并行票先合，本票 seam 4 的验收对象即它）：
 *  活行披露面的技能事实行（▶ 命中 / ✕ 挡下）+ 持久汇总行（技能/挡下两列）。
 *  场景词表与行为证据腿同款（haiku 命中 + secret 挡下）。 */
const SKILLS_ROUTING_TRANSCRIPT: TranscriptItem[] = [
  { kind: 'run', at: '13:35', machine: 'xmonsMac-3574' },
  {
    kind: 'user',
    text: '写一首深夜写代码主题的三行俳句，保存到 haiku.txt',
    seq: 9,
    title: '写一首俳句并保存',
  },
  { kind: 'skills', read: ['haiku-helper'], denied: ['secret-local'] },
  {
    kind: 'robot',
    paragraphs: [[{ text: '已把俳句写进 haiku.txt。' }]],
    footer: { seconds: 12 },
  },
];

export const skillsRouting: FixtureSet = {
  todos: [probeTodo('review', r7(13, 37))],
  now: r7(13, 40),
  detail: {
    transcript: SKILLS_ROUTING_TRANSCRIPT,
    doc: DOC_V2,
    changes: probeChanges(true),
  },
};

/** #1106 named scenario（无 capture，skills-routing 先例）：派发技能注入
 *  回查行（详情面持久一份）的渲染钉扎——live 面由 mapTranscript 从
 *  step.skillInjection 派生（unit：injected-skills-row.test.ts + live 探针
 *  docs/verify/1106/）；fixture 捕获面无 step 数据源，行以冻结 view item
 *  直供本场景钉渲染缝（行形/原因随行/零命中占位）。 */
const SKILL_INJECT_TRANSCRIPT: TranscriptItem[] = [
  { kind: 'run', at: '13:35', machine: 'xmonsMac-3574' },
  {
    kind: 'injected-skills',
    skills: [
      {
        id: 'better-typography',
        reason: '任务文本与技能同域「前端界面」（任务命中「字号」，技能描述命中「ui」）',
      },
      { id: 'tdd', reason: '任务文本显式点名「tdd」' },
    ],
  },
  {
    kind: 'user',
    text: '修复看板卡片的字号过小与换行溢出',
    seq: 9,
    title: '字号与换行修复',
  },
  {
    kind: 'robot',
    paragraphs: [[{ text: '已修复字号与换行。' }]],
    footer: { seconds: 12 },
  },
];

/** 零命中对照面：已计算零命中的行 = 「未注入技能」占位（配置事实可见，
 *  不是行缺席——与 skills-routing 的零噪声对照（27 场景）语义相反）。 */
const SKILL_INJECT_ZERO_TRANSCRIPT: TranscriptItem[] = [
  { kind: 'run', at: '13:35', machine: 'xmonsMac-3574' },
  { kind: 'injected-skills', skills: [] },
  {
    kind: 'user',
    text: '把首页轮播图换成静态图',
    seq: 10,
    title: '轮播图静态化',
  },
];

export const skillInject: FixtureSet = {
  todos: [probeTodo('review', r7(13, 37))],
  now: r7(13, 40),
  detail: {
    transcript: SKILL_INJECT_TRANSCRIPT,
    doc: DOC_V2,
    changes: probeChanges(true),
  },
};

export const skillInjectZero: FixtureSet = {
  todos: [probeTodo('review', r7(13, 37))],
  now: r7(13, 40),
  detail: {
    transcript: SKILL_INJECT_ZERO_TRANSCRIPT,
    doc: DOC_V2,
    changes: probeChanges(true),
  },
};

/** r8 63: version dropdown open on the v2 surface. */
export const versionMenuV2: FixtureSet = withDetail(detailV2(r8(23, 54)), {
  versionMenu: 'versions',
  compareTarget: planDiff('v1', 'v2', LINES_V1, LINES_V2, false),
});

/** r8 64: compare submenu open (single 上一版本 row). */
export const compareMenuV2: FixtureSet = withDetail(detailV2(r8(23, 54)), {
  versionMenu: 'compare',
  compareTarget: planDiff('v1', 'v2', LINES_V1, LINES_V2, false),
});

/** r8 65/66: plan-version diff v1 → v2, collapsed / expanded. */
export function diffV1V2(expanded: boolean): FixtureSet {
  return withDetail(detailV2(r8(23, 55)), {
    planDiff: planDiff('v1', 'v2', LINES_V1, LINES_V2, expanded),
  });
}

/** r8 67: reject sent — replan streaming with the v1 → v2 diff still open. */
export const revisionStreaming: FixtureSet = {
  todos: [failed12, review13, probe15('planning', r8(23, 55))],
  now: r8(23, 55),
  detail: {
    transcript: [
      ...RUN1_TO_V2,
      { kind: 'user', text: REJECT_FEEDBACK },
      { kind: 'streaming', seconds: 1, label: '处理中...' },
    ],
    doc: DOC_V2,
    planVersions: [
      { v: 'v2', at: r8(23, 53) },
      { v: 'v1', at: r8(23, 44) },
    ],
    planDiff: planDiff('v1', 'v2', LINES_V1, LINES_V2, true),
  },
};

/** r8 68/69: v3 landed, auto-rebased v1 → v3 diff collapsed. */
export const detailV3Collapsed: FixtureSet = detailV3(r8(23, 58));

/** r8 70: version dropdown open over the v3 diff surface (5 rows: the
 *  open diff adds the compare row's `v1` label + 回到与 base 对比). */
export const versionMenuV3: FixtureSet = withDetail(detailV3(r8(23, 58)), {
  versionMenu: 'versions',
  compareTarget: planDiff('v2', 'v3', LINES_V2, LINES_V3, false),
});

/** r8 71/72: manual-reject diff v2 → v3, collapsed / expanded. */
export function diffV2V3(expanded: boolean): FixtureSet {
  return withDetail(detailV3(r8(23, 58)), {
    planDiff: planDiff('v2', 'v3', LINES_V2, LINES_V3, expanded),
  });
}

/** r8 73: #15 failed detail. */
export const detailFailed15Set: FixtureSet = detailFailed15(r8n(0, 1));

/** r8 74: rerun dialog with the 复用方案 button (#15 has a plan doc)。
 *  #640：dialog 瘦身形（重跑降 ghost 次钮 + indigo 复用方案）。 */
export const rerunDialog15: FixtureSet = {
  ...detailFailed15(r8n(0, 1)),
  overlay: { kind: 'rerun' },
};

/** r8 75: 复用方案 sub-panel. */
export const reusePanel15: FixtureSet = {
  ...detailFailed15(r8n(0, 1)),
  overlay: { kind: 'reuse' },
};

/** r8 76: reused build streaming (执行中, plan pane on the reused v1). */
export const reusedBuilding: FixtureSet = {
  todos: [failed12, review13, probe15('building', r8n(0, 2))],
  now: r8n(0, 2),
  detail: { transcript: REUSED_TRANSCRIPT, doc: DOC_V3 },
};

/** r8 77: run history of the reused build, two rows, review phase. */
export const history15: FixtureSet = {
  todos: [failed12, review13, probe15('review', r8n(0, 2))],
  now: r8n(0, 3),
  detail: { transcript: REUSED_REVIEW_TRANSCRIPT, changes: CHANGES_15 },
  ui: { paneView: 'history' },
};

/** Interactive reject chain (issue #75 AC3): confirm v1 with a revision
 *  script — send walks 请求修改 → streaming → v2 → diff → 确认. */
export const revisionChain: FixtureSet = {
  todos: [failed12, review13, probe15('confirm', r8(23, 44))],
  now: r8(23, 45),
  detail: {
    transcript: RUN1_TO_V2.slice(0, 4),
    doc: DOC_V1,
    planVersions: [{ v: 'v1', at: r8(23, 44) }],
    revision: {
      feedback: REJECT_FEEDBACK,
      streaming: { seconds: 1, label: '处理中...' },
      landed: {
        planVersions: [
          { v: 'v2', at: r8(23, 45) },
          { v: 'v1', at: r8(23, 44) },
        ],
        doc: DOC_V2,
        transcriptTail: [
          ADJUST_V2_MESSAGE,
          {
            kind: 'plan',
            title: '方案 · v2',
            preview: R8_PLAN_PREVIEW,
            seconds: 29,
          },
        ],
        planDiff: planDiff('v1', 'v2', LINES_V1, LINES_V2, false),
      },
    },
  },
};

/** r8 57/77 run-history rows (upstream #68 shape): the failed current row
 *  carries the 当前 chip and the state-gated 重跑 button (r8 §3.3). */
const RUNS_12: RunHistoryRow[] = [
  {
    label: '第 1 次运行',
    meta: '6 小时前 · 72.1k tokens · Machine offline',
    status: 'failed-current',
  },
];

const RUNS_15: RunHistoryRow[] = [
  { label: '第 2 次运行', meta: '刚刚', status: 'current' },
  {
    label: '第 1 次运行',
    meta: '22 分钟前 · 435.5k tokens · Machine offline',
    status: 'failed',
  },
];

/** [推断] token/branch payloads for the r8 todos — the r8 captures only
 *  exercised the history face; no e2e row rides these values. */
const R8_OVERLAY_TOKEN: TokenUsageContent = {
  total: '72.1k',
  model: 'r3-gw/claude-sonnet-5',
  modelTotal: '72.1k',
  input: '12',
  output: '980',
  cacheRead: '49.7k',
  cacheWrite: '25.4k',
  cacheHitRate: '100%',
};
const R8_OVERLAY_BRANCH: BranchInfoContent = {
  branch: conversationBranch('r8-12'),
  commit: '386b8e4af054',
  machine: MACHINE_NAME,
  directory: `~/${BRAND.homeDirName}/workspaces/r8-12`,
};

export function r8OverlayContent(todoId: string): BuildOverlayContent | null {
  if (todoId === 'r8-12')
    return { token: R8_OVERLAY_TOKEN, branch: R8_OVERLAY_BRANCH, runs: RUNS_12 };
  if (todoId === 'r8-15')
    return {
      token: R8_OVERLAY_TOKEN,
      branch: { ...R8_OVERLAY_BRANCH, branch: conversationBranch('r8-15') },
      runs: RUNS_15,
    };
  return null;
}
