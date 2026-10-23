// Board scenario sets: the default board plus every named-scenario board
// (pickers, filters, drag matrix, overflow/stress, chief-probe and dark
// boards).

import { FIXED_TAGS } from '@cairn/shared';
import {
  at,
  darkFreshProbe,
  legacyDone,
  legacyReview,
  MACHINE_ID,
  MACHINE_NAME,
  PROJECT_ID,
  PROJECT_NAME,
  probeTodo,
  projectContent,
  R3_BUILDER,
  r7,
  TEAM_ID,
} from './core.js';
import type { FixtureSet, TodoRecord } from './records.js';

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
        name: 'cairn',
        full_name: 'xiechimon/cairn',
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
    dragMatrixProbe('dm-done-changes', 56, 'dragmatrix 探针（已完成·有变更）', 'done', {
      phaseAt: r7(13, 20),
      orderIndex: 0,
    }),
    dragMatrixProbe('dm-done-plain', 57, 'dragmatrix 探针（已完成·无变更）', 'done', {
      hasChanges: false,
      phaseAt: r7(13, 50),
      orderIndex: 10,
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

/** #1261 等额度命名场景（无 capture，board-overflow 先例）：执行中一卡
 *  quotaWait 在位（等额度芯片 + 横幅 + 详情行标签的判定面），另一执行中卡
 *  无 quotaWait（负向钉——普通执行中不染等额度色）。probeAt 定在 now + 2min
 *  的整刻，让「{probe} 自动探测续跑」的时序文案确定性。 */
export const boardQuotaWait: FixtureSet = {
  ...boardDefault,
  todos: [
    {
      ...probeTodo('building', r7(13, 40)),
      id: 'quota-waiting-1',
      seqNum: 61,
      title: '等额度探针（relay-186 断粮）',
      spec: '等额度探针（relay-186 断粮）。',
      quotaWait: {
        kind: 'quota',
        providerId: 'relay-186',
        label: 'Relay 186',
        retryAfterMs: null,
        probeAt: r7(13, 56),
      },
    },
    {
      ...probeTodo('building', r7(13, 42)),
      id: 'quota-plain-1',
      seqNum: 62,
      title: '普通执行中探针（无配额信号）',
      spec: '普通执行中探针（无配额信号）。',
    },
    legacyReview,
    legacyDone,
  ],
  now: r7(13, 54),
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
