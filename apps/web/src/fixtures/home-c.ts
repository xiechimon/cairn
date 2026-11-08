import { boardDefault } from './board.js';
import { chiefDefault } from './chief.js';
import { PROJECT_ID, probeTodo, r7 } from './core.js';
import { detailBuilding, detailConfirm, detailReview } from './detail.js';
import type { ChiefContent, FixtureSet, TodoRecord } from './records.js';
import { scheduleOnce } from './schedules.js';

export const HOME_C_CRED = 'home-c-cred';

function homeTodo(
  id: string,
  seqNum: number,
  title: string,
  phase: TodoRecord['phase'],
  projectId: string,
): TodoRecord {
  return {
    ...probeTodo(phase, r7(20, 10)),
    id,
    seqNum,
    title,
    spec: title,
    projectId,
    latestBuildId: phase === 'todo' ? null : `build-${id}`,
  };
}

const conversation: ChiefContent = {
  ...chiefDefault,
  view: 'none',
  bound: true,
  threadTitle: 'Coordinator',
  threadId: 'chief-global',
  hasEarlier: true,
  stream: [
    {
      kind: 'user',
      id: 'home-c-ask-orb',
      text: 'Run the orb canary until it passes, then send the first real ticket through cairn.',
      projectId: HOME_C_CRED,
    },
    {
      kind: 'robot',
      id: 'home-c-reply-orb',
      seconds: '',
      paragraphs: [[{ text: 'Round 6 found no /work in the orb; fixed, round 7 is running.' }]],
    },
    {
      kind: 'question',
      id: 'home-c-question',
      requestId: 'home-c-q1',
      status: 'pending',
      answers: null,
      questions: [
        {
          header: 'Credential relay · #74',
          question: 'relay-186 cannot run glm-5.3-flash. Which model should rerun it?',
          options: [
            { label: 'wokey · deepseek-v4.1-flash', description: 'Metered' },
            {
              label: 'Claude subscription',
              description: 'Verified, uses the subscription',
              recommended: true,
            },
            { label: 'Hold it', description: '' },
          ],
        },
      ],
    },
    {
      kind: 'user',
      id: 'home-c-ask-fold',
      text: 'Fold finished turns before review.',
      projectId: PROJECT_ID,
      createdAt: r7(20, 5),
    },
    {
      kind: 'robot',
      id: 'home-c-reply-fold',
      seconds: '',
      createdAt: r7(20, 5) + 4 * 60_000,
      paragraphs: [[{ text: 'Started it; the PR is up for your review.' }]],
    },
  ],
  streamAt: [r7(20, 0), r7(20, 1), r7(20, 1), r7(20, 5), r7(20, 6)],
};

export const homeC: FixtureSet = {
  ...boardDefault,
  resources: {
    skills: [],
    mcpServers: [],
    providerSources: [],
    machines: [
      {
        id: 'home-c-mac',
        kind: 'local',
        name: 'xmonsMac',
        online: true,
        chiefHost: true,
        runningSteps: 2,
        maxConcurrent: 8,
      },
      { id: 'home-c-omarchy', kind: 'remote', name: 'omarchy', online: false, maxConcurrent: 16 },
    ],
  },
  projectNames: { [PROJECT_ID]: 'cairn', [HOME_C_CRED]: 'Credential relay' },
  todos: [
    homeTodo('home-c-confirm', 2301, 'Connect a Claude subscription token', 'confirm', PROJECT_ID),
    homeTodo('home-c-failed', 74, 'Rerun the relay probe', 'failed', HOME_C_CRED),
    homeTodo(
      'home-c-review',
      2271,
      'Fold finished turns into purpose and duration',
      'review',
      PROJECT_ID,
    ),
    homeTodo('home-c-working-a', 2302, 'Push for finished threads', 'building', PROJECT_ID),
    homeTodo('home-c-working-b', 2303, 'Serif greeting fix', 'planning', PROJECT_ID),
    homeTodo('home-c-working-c', 75, 'Orb canary round 7', 'building', HOME_C_CRED),
    homeTodo('home-c-idle', 2240, 'Sidebar status groups', 'todo', PROJECT_ID),
    homeTodo('home-c-done', 2201, 'Unread dot on threads', 'done', PROJECT_ID),
  ],
  chief: conversation,
  details: {
    'home-c-confirm': detailConfirm(false).detail ?? { transcript: [] },
    'home-c-review': detailReview({ userMenuOpen: false, changesExpanded: false }).detail ?? {
      transcript: [],
    },
    'home-c-working-a': detailBuilding(true).detail ?? { transcript: [] },
  },
  schedules: [
    scheduleOnce,
    {
      ...scheduleOnce,
      id: 'home-c-schedule-idle',
      todoId: 'home-c-idle',
      todo: { ...scheduleOnce.todo, seqNum: 2240, title: 'Sidebar status groups', phase: 'todo' },
    },
    {
      ...scheduleOnce,
      id: 'home-c-schedule-running',
      projectId: HOME_C_CRED,
      todoId: 'home-c-working-c',
      todo: { ...scheduleOnce.todo, seqNum: 75, title: 'Orb canary round 7', phase: 'building' },
    },
  ],
  now: r7(20, 30),
};

export const homeCEmpty: FixtureSet = {
  ...boardDefault,
  projectNames: { [PROJECT_ID]: 'cairn' },
  todos: [],
  chief: { ...conversation, stream: [], streamAt: [], hasEarlier: false },
  now: r7(9, 0),
};

function askingTodo(
  id: string,
  seqNum: number,
  title: string,
  minutesAgo: number,
  ask: NonNullable<TodoRecord['ask']>,
): TodoRecord {
  return {
    ...homeTodo(id, seqNum, title, 'needs_input', PROJECT_ID),
    waitingOn: { on: 'owner', retryAt: null },
    phaseAt: r7(20, 30) - minutesAgo * 60_000,
    ask,
  };
}

export const HOME_INBOX_THREADS: TodoRecord[] = [
  askingTodo('inbox-retry', 2311, '定中继探针的重试次数', 4, {
    text: '中继探针失败后最多重跑几次再放弃？',
    requestId: 'ask-inbox-retry',
    options: [{ label: '三次', description: '和其他探针一致' }, { label: '五次' }],
    defaultAnswer: '三次',
  }),
  askingTodo('inbox-digest', 2312, '给夜间摘要起个名字', 11, {
    text: '摘要标题用「夜报」还是「今日回顾」？',
    requestId: 'ask-inbox-digest',
    options: [{ label: '夜报' }, { label: '今日回顾' }],
    defaultAnswer: null,
  }),
  askingTodo('inbox-drafts', 2313, '草稿要不要跨设备同步', 26, {
    text: '手机上写了一半的草稿，换到电脑上要不要接着显示？同步需要把草稿存到服务器。',
    requestId: 'ask-inbox-drafts',
    options: [],
    defaultAnswer: '先不同步，只存本机',
  }),
  askingTodo('inbox-badge', 2314, '确认侧栏角标的颜色', 48, {
    text: '角标沿用琥珀色，还是改成和失败一样的红色？',
    requestId: 'ask-inbox-badge',
    options: [{ label: '琥珀色' }, { label: '红色' }],
    defaultAnswer: '琥珀色',
  }),
  askingTodo('inbox-webhook', 2315, '旧 webhook 留还是删', 95, {
    text: '旧的 GitHub webhook 还有两个仓库在用，现在删会断它们的通知。删吗？',
    requestId: 'ask-inbox-webhook',
    options: [{ label: '先留着' }, { label: '现在删' }],
    defaultAnswer: null,
  }),
  {
    ...homeTodo('inbox-update', 2317, '中继探针在 omarchy 上重跑', 'building', PROJECT_ID),
    waitingOn: { on: 'machine-update', retryAt: null },
    phaseAt: r7(20, 30) - 2 * 3_600_000,
  },
  {
    ...homeTodo('inbox-confirm', 2316, '把输入框拆成两个文件', 'confirm', PROJECT_ID),
    phaseAt: r7(20, 30) - 3 * 3_600_000,
    ask: {
      text: '计划拆成 composer-surface 和 composer-tools 两个文件，测试跟着搬。',
      requestId: null,
      options: [],
      defaultAnswer: null,
    },
  },
];

export const homeInbox: FixtureSet = {
  ...homeC,
  todos: [
    ...HOME_INBOX_THREADS,
    ...homeC.todos.filter(
      (todo) => !['home-c-confirm', 'home-c-failed', 'home-c-review'].includes(todo.id),
    ),
  ],
};
