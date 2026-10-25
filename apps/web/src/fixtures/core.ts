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
export const PROJECT_INITIAL = 'r';
export const USER_NAME = 'Xmon Dai';
export const MACHINE_NAME = 'xmonsMac-3574.local';
export const MACHINE_ID = 'TlZ2sSD4EJCxjNJqVhdo_';
export const MACHINE_REMOTE_ID = 'Kd8fG2hJ4mN9pQ1rStUvWx3';
export const MACHINE_REMOTE_NAME = 'mea-wsl';
export const R7_BUILD_ID = '01a0c26e-23ea-734f-9847-cf9cdbce7802';
export const R7_BUILD_BRANCH = conversationBranch(R7_BUILD_ID);
export const R7_TARGET_COMMIT = '2cceb9dbf7a8';

export const AGENT_MODEL_LINE = 'claude-sonnet-5 · 默认';

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

export const PROBE_BRANCH_INFO: BranchInfoContent = {
  branch: R7_BUILD_BRANCH,
  commit: R7_TARGET_COMMIT,
  machine: MACHINE_NAME,
  directory: '~/preview/project',
};

export const PROBE_RUN_HISTORY: RunHistoryRow[] = [
  { label: '第 1 次运行', meta: '12 分钟前 · 38.3k tokens', status: 'current' },
];

export const at = (date: string, h: number, m: number) =>
  Date.parse(`${date}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00+08:00`);

export const R7_DAY = '2026-09-21';
export const R3_DAY = '2026-09-19';

export const r7 = (h: number, m: number) => at(R7_DAY, h, m);

export const R8_DAY = '2026-09-22';
export const r8 = (h: number, m: number) => at(R8_DAY, h, m);

export const R3_BUILDER = { id: 'r3-builder', displayName: 'r3-builder' };

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
  hasChanges: false,
  hasPlan: false,
  buildHistory: [{ buildId: 'r3-conv-legacy-1', createdAt: at(R3_DAY, 13, 5) }],
  sourceTodo: null,
  v: 3,
  awaitingReply: true,
};

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
    hasPlan: phase === 'confirm' || phase === 'review',
    buildHistory: phase === 'todo' ? [] : [{ buildId: R7_BUILD_ID, createdAt: r7(13, 21) }],
    sourceTodo: null,
    v: 2,
  };
}

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

export const projectContent: ProjectContent = {
  name: PROJECT_NAME,
  branch: 'main',
  files: ['README.md'],
  repoName: PROJECT_NAME,
  hosted: true,
  defaultBranch: 'main',
  description: null,
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
      files: [],
    },
  ],
};
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
