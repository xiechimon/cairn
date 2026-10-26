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

export const boardDefault: FixtureSet = {
  todos: [legacyReview, legacyDone],
  now: r7(13, 14),
  schedules: [],
  project: projectContent,
};

export const boardProjectPicker: FixtureSet = {
  ...boardDefault,
  projectNames: {
    [PROJECT_ID]: PROJECT_NAME,
    'r2-inventory': 'r2-inventory',
  },
};

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

const tagFilterRows = FIXED_TAGS.map((t) => ({
  id: `tag-${t.name}`,
  name: t.name,
  color: t.color,
}));

function tagFilterProbe(
  id: string,
  seqNum: number,
  title: string,
  phase: TodoRecord['phase'],
  tagIds: string[],
): TodoRecord {
  return { ...probeTodo(phase, r7(13, 40)), id, seqNum, title, spec: title, tagIds };
}

function dragMatrixProbe(
  id: string,
  seqNum: number,
  title: string,
  phase: TodoRecord['phase'],
  over?: Partial<TodoRecord>,
): TodoRecord {
  return { ...probeTodo(phase, r7(13, 40)), id, seqNum, title, spec: title, tagIds: [], ...over };
}

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

export const boardTagFilterEmpty: FixtureSet = {
  ...boardDefault,
  todos: [
    tagFilterProbe('tagfilter-e-bug', 44, 'tagfilter 空态探针（bug）', 'todo', ['tag-bug']),
    tagFilterProbe('tagfilter-e-docs', 45, 'tagfilter 空态探针（docs）', 'building', ['tag-docs']),
  ],
  now: r7(13, 55),
  tags: tagFilterRows,
};

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

function overflowProbe(id: string, seqNum: number, title: string): TodoRecord {
  return { ...probeTodo('todo', r7(13, 40)), id, seqNum, title, spec: title };
}

export const boardOverflow: FixtureSet = {
  ...boardDefault,
  todos: Array.from({ length: 12 }, (_, i) =>
    overflowProbe(`overflow-${String(i + 1).padStart(2, '0')}`, 51 + i, `溢出探针 #${i + 1}`),
  ),
  now: r7(13, 55),
};

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

function stressProbe(
  id: string,
  seqNum: number,
  title: string,
  phase: TodoRecord['phase'],
): TodoRecord {
  return { ...probeTodo(phase, r7(13, 40)), id, seqNum, title, spec: title };
}

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

export const boardChiefProbes: FixtureSet = {
  todos: [
    chiefProbe(
      12,
      'README 文档目录 + 新建 CHANGELOG.md + scripts/hello.js',
      'failed',
      CHIEF_NOW - 5 * HOUR_MS - 2 * 60_000,
    ),
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

export const boardDarkFresh: FixtureSet = {
  todos: [legacyReview, legacyDone, probeTodo('done', r7(13, 52)), darkFreshProbe],
  now: r7(13, 55),
};

const INBOX_NOW = r7(13, 55);
const INBOX_DAY_MS = 24 * 60 * 60 * 1000;

function inboxProbe(
  id: string,
  seqNum: number,
  title: string,
  phase: TodoRecord['phase'],
  ageMs: number,
  over?: Partial<TodoRecord>,
): TodoRecord {
  return {
    ...probeTodo(phase, INBOX_NOW - ageMs),
    id,
    seqNum,
    title,
    spec: title,
    tagIds: [],
    ...over,
  };
}

export const boardInbox: FixtureSet = {
  ...boardDefault,
  projectNames: { [PROJECT_ID]: 'pacman', 'inbox-probe': 'pacman-gh-probe' },
  todos: [
    inboxProbe(
      'inbox-reply',
      101,
      'bug 票自动复现：要不要把复现脚本放进 e2e？',
      'review',
      40 * 60_000,
      {
        awaitingReply: true,
      },
    ),
    inboxProbe(
      'inbox-confirm',
      102,
      '段超时杀已交付 plan 的残留流：停闸后的 build 被覆写为 failed',
      'confirm',
      2 * 60 * 60_000,
    ),
    inboxProbe(
      'inbox-review',
      103,
      '上下文顶格时压缩请求自身 400 且不可恢复：整步无恢复路径',
      'review',
      5 * 60 * 60_000,
      {
        hasChanges: true,
      },
    ),
    inboxProbe(
      'inbox-failed-fresh',
      104,
      '自治合并试点：纯文档与纯测试 PR 闸全绿即由 cairn 自己合并',
      'failed',
      26 * 60 * 60_000,
    ),
    inboxProbe(
      'inbox-stale-1',
      22,
      '调慢 spinner 至 1.8s 同步呼吸律：补全 PR1119 证据段',
      'failed',
      16 * INBOX_DAY_MS,
    ),
    inboxProbe(
      'inbox-stale-2',
      77,
      '规划 #1301 模型下拉宽度修复：消费端组合/零皮 adapter 方案',
      'confirm',
      13 * INBOX_DAY_MS,
    ),
    inboxProbe(
      'inbox-stale-3',
      26,
      '实现 issue #1138：claim 闸加 agent 级 maxConcurrentTasks',
      'failed',
      14 * INBOX_DAY_MS,
    ),
    inboxProbe(
      'inbox-stale-4',
      48,
      '实现 #1186 skills 注入面三前置条件的机器断言',
      'failed',
      14 * INBOX_DAY_MS,
      {
        projectId: 'inbox-probe',
      },
    ),
    inboxProbe(
      'inbox-stale-5',
      50,
      '#1242 冲突解除收尾轮：PR1283 已合并，落地态核验全绿',
      'failed',
      14 * INBOX_DAY_MS,
      {
        projectId: 'inbox-probe',
      },
    ),
    inboxProbe(
      'inbox-running',
      105,
      'bug 票自动复现：新 bug 票先由 agent 用 verify-cairn 跑一遍并贴证据',
      'building',
      60 * 60_000,
    ),
    inboxProbe('inbox-todo', 106, '给工作台加上按项目分组的开关', 'todo', 10 * 60 * 60_000),
    inboxProbe(
      'inbox-done',
      107,
      'chief: split_todo 拆解方案过检查器即自动开跑',
      'done',
      5 * 60 * 60_000,
    ),
    inboxProbe('inbox-done-2', 108, '修复看板拖拽列的直角与圆角不一致', 'done', 20 * 60 * 60_000),
    inboxProbe('inbox-done-3', 109, '模型下拉在窄屏下被截断', 'closed', 2 * INBOX_DAY_MS),
    inboxProbe('inbox-done-4', 110, '记忆候选流程接上评测', 'done', 3 * INBOX_DAY_MS),
  ],
  now: INBOX_NOW,
};
