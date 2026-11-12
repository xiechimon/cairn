import type { TokenUsage } from '@cairn/shared';
import { boardDefault } from './board.js';
import { chiefDefault } from './chief.js';
import { at, PROJECT_ID, probeTodo, r7 } from './core.js';
import { detailBuilding, detailConfirm, detailReview } from './detail.js';
import type { ChiefContent, FixtureSet, TodoRecord } from './records.js';
import { scheduleOnce } from './schedules.js';

export const HOME_C_CRED = 'home-c-cred';

const SERVER_SECTION: Record<TodoRecord['phase'], Pick<TodoRecord, 'section' | 'owner'>> = {
  todo: { section: 'up_next', owner: null },
  queued: { section: 'working', owner: null },
  planning: { section: 'working', owner: null },
  building: { section: 'working', owner: null },
  confirm: { section: 'needs_input', owner: 'owner' },
  needs_input: { section: 'needs_input', owner: 'owner' },
  review: { section: 'ready_for_review', owner: 'owner' },
  failed: { section: 'working', owner: 'coordinator' },
  done: { section: 'resolved', owner: null },
  closed: { section: 'resolved', owner: null },
};

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
    ...SERVER_SECTION[phase],
  };
}

function usageRow(
  buildId: string,
  input: number,
  output: number,
  cacheRead: number,
  costTotal: number,
): TokenUsage {
  return {
    buildId,
    model: 'anthropic/claude-sonnet-5-5',
    input,
    output,
    cacheRead,
    cacheWrite: 0,
    costInput: null,
    costOutput: null,
    costCacheRead: null,
    costCacheWrite: null,
    costTotal,
  };
}

function askedIn(todo: TodoRecord, messageId: string, spec: string): TodoRecord {
  return {
    ...todo,
    spec,
    request: {
      segments: [
        {
          source: { kind: 'chat', threadId: 'chief-global', messageId, span: 'whole' },
          author: 'owner',
          sourceRef: null,
          text: spec,
        },
      ],
      siblings: [],
      difficulty: null,
      titleSource: 'owner',
      titleSourceRef: null,
    },
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
      kind: 'task-card',
      id: 'home-c-card-orb',
      todoId: 'home-c-working-c',
      projectId: HOME_C_CRED,
      seq: 75,
      title: 'Orb canary round 7',
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
    {
      kind: 'task-card',
      id: 'home-c-card-fold',
      todoId: 'home-c-review',
      projectId: PROJECT_ID,
      seq: 2271,
      title: 'Fold finished turns into purpose and duration',
    },
  ],
  streamAt: [r7(20, 0), r7(20, 1), r7(20, 1), r7(20, 1), r7(20, 5), r7(20, 6), r7(20, 6)],
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
    askedIn(
      homeTodo(
        'home-c-review',
        2271,
        'Fold finished turns into purpose and duration',
        'review',
        PROJECT_ID,
      ),
      'home-c-ask-fold',
      'Fold finished turns before review.',
    ),
    homeTodo('home-c-working-a', 2302, 'Push for finished threads', 'building', PROJECT_ID),
    homeTodo('home-c-working-b', 2303, 'Serif greeting fix', 'planning', PROJECT_ID),
    askedIn(
      {
        ...homeTodo('home-c-working-c', 75, 'Orb canary round 7', 'building', HOME_C_CRED),
        context: { tokens: 62_000, contextWindow: 200_000 },
      },
      'home-c-ask-orb',
      'Run the orb canary until it passes, then send the first real ticket through cairn.',
    ),
    homeTodo('home-c-idle', 2240, 'Sidebar status groups', 'todo', PROJECT_ID),
    homeTodo('home-c-done', 2201, 'Unread dot on threads', 'done', PROJECT_ID),
  ],
  chief: conversation,
  details: {
    'home-c-confirm': detailConfirm(false).detail ?? { transcript: [] },
    'home-c-review': detailReview({ userMenuOpen: false, changesExpanded: false }).detail ?? {
      transcript: [],
    },
    'home-c-working-a': {
      ...(detailBuilding(true).detail ?? { transcript: [] }),
      usage: {
        rows: [usageRow('build-home-c-working-a', 38_000, 9_400, 310_000, 0.86)],
        machines: ['omarchy'],
      },
    },
    'home-c-working-c': {
      transcript: [{ kind: 'streaming', label: '处理中...' }],
      usage: {
        rows: [usageRow('build-home-c-working-c', 21_000, 6_200, 184_000, 0.47)],
        machines: ['omarchy'],
      },
    },
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

export const homeCQuiet: FixtureSet = {
  ...homeCEmpty,
  todos: [homeTodo('home-c-quiet-done', 2201, 'Unread dot on threads', 'done', PROJECT_ID)],
};

const MADE_DAY = '2026-09-24';

function madeTodo(
  id: string,
  seqNum: number,
  title: string,
  projectId: string,
  phaseAt: number,
  archivedAt: number | null = null,
): TodoRecord {
  return { ...homeTodo(id, seqNum, title, 'done', projectId), phaseAt, archivedAt };
}

export const homeCMade: FixtureSet = {
  ...homeC,
  todos: [
    ...(homeC.todos ?? []),
    madeTodo('made-today', 2310, 'Contributing guide', PROJECT_ID, at(MADE_DAY, 19, 40)),
    madeTodo('made-yesterday', 2309, 'Repository overview', PROJECT_ID, at('2026-09-23', 15, 5)),
    madeTodo('made-credential', 78, 'Relay probe report', HOME_C_CRED, at('2026-09-22', 11, 0)),
    madeTodo('made-earlier', 2150, 'Snake web game', HOME_C_CRED, at('2026-09-12', 9, 30)),
    madeTodo(
      'made-archived',
      2101,
      'Retired onboarding checklist',
      PROJECT_ID,
      at('2026-09-02', 10, 0),
      at('2026-09-10', 10, 0),
    ),
  ],
  now: at(MADE_DAY, 20, 30),
};

const HOUR_MS = 3_600_000;

export const homeCMachines: FixtureSet = {
  ...homeC,
  resources: {
    skills: [],
    mcpServers: [],
    providerSources: [],
    machines: [
      ...(homeC.resources?.machines ?? []),
      {
        id: 'home-c-studio',
        kind: 'remote',
        name: 'studio-linux',
        online: true,
        runningSteps: 1,
        maxConcurrent: 4,
      },
      {
        id: 'home-c-office',
        kind: 'local',
        name: 'Office Mac mini',
        online: false,
        lastSeenAt: Date.now() - 2 * HOUR_MS,
        maxConcurrent: 4,
      },
    ],
  },
};

const MADE_MANY_TITLES = [
  'Contributing guide',
  'Repository overview',
  'Release notes for 0.9',
  'Relay probe report',
  'Retry budget table',
  'Snake web game',
  'Onboarding checklist',
  'Queue latency chart',
  'Settings search index',
  'Archive toast copy',
  'Thread unread dot',
  'Model routing table',
  'Machine offline banner',
  'Changelog generator',
];

export const homeCMadeMany: FixtureSet = {
  ...homeC,
  todos: [
    ...(homeC.todos ?? []),
    ...MADE_MANY_TITLES.map((title, index) =>
      madeTodo(
        `made-many-${index}`,
        2400 + index,
        title,
        index % 3 === 0 ? HOME_C_CRED : PROJECT_ID,
        at(MADE_DAY, 19, 40) - index * 14 * HOUR_MS,
      ),
    ),
  ],
  now: at(MADE_DAY, 20, 30),
};

const MINUTE_MS = 60_000;

export const sessionsRef: FixtureSet = {
  ...homeC,
  resources: {
    skills: [],
    mcpServers: [],
    providerSources: [],
    machines: [
      {
        id: 'ref-macbook',
        kind: 'local',
        name: '工作室的 MacBook Air',
        hostname: 'studio-mbp-01',
        online: true,
        runningSteps: 2,
        maxConcurrent: 8,
        folders: [
          { path: 'tmp', enabled: true },
          { path: '~/Code', enabled: true },
        ],
        runningHere: [
          {
            threadId: 'home-c-working-a',
            title: 'Push for finished threads',
            projectId: PROJECT_ID,
            startedAt: Date.now() - 12 * MINUTE_MS,
          },
          {
            threadId: 'home-c-working-c',
            title: 'Orb canary round 7',
            projectId: HOME_C_CRED,
            startedAt: Date.now() - 41 * MINUTE_MS,
          },
        ],
      },
      {
        id: 'ref-huihui',
        kind: 'local',
        name: '办公室 Mac mini',
        hostname: 'huihui-mbp',
        online: false,
        lastSeenAt: Date.now() - 114 * MINUTE_MS,
        maxConcurrent: 4,
        folders: [{ path: '~/Projects', enabled: false }],
        runningHere: [],
      },
    ],
  },
};

export const sessionsRefDetail: FixtureSet = { ...sessionsRef, machinesOpen: 'ref-macbook' };

const PREVIEW_INK = 'rgb(38 38 38)';
const PREVIEW_LINE = 'rgb(214 214 214)';
const PREVIEW_FILL = 'rgb(236 236 236)';

function svgPreview(body: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="260" viewBox="0 0 400 260"><rect width="400" height="260" fill="rgb(255 255 255)"/>${body}</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function docPreview(title: string): string {
  const lines = [70, 92, 114, 136, 158]
    .map(
      (y, i) =>
        `<rect x="36" y="${y}" width="${i % 2 === 0 ? 300 : 240}" height="8" rx="4" fill="${PREVIEW_LINE}"/>`,
    )
    .join('');
  return svgPreview(
    `<text x="36" y="44" font-family="sans-serif" font-size="20" font-weight="600" fill="${PREVIEW_INK}">${title}</text>${lines}`,
  );
}

function designPreview(): string {
  return svgPreview(
    `<circle cx="80" cy="96" r="44" fill="${PREVIEW_FILL}"/><rect x="150" y="52" width="88" height="88" rx="18" fill="${PREVIEW_FILL}"/><polyline points="270,140 300,96 330,112 364,52" fill="none" stroke="${PREVIEW_LINE}" stroke-width="4"/>`,
  );
}

function refMade(
  id: string,
  seqNum: number,
  title: string,
  madeKind: TodoRecord['madeKind'],
  phaseAt: number,
  previewUrl?: string,
): TodoRecord {
  return {
    ...madeTodo(id, seqNum, title, PROJECT_ID, phaseAt),
    ...(madeKind === undefined ? {} : { madeKind }),
    ...(previewUrl === undefined ? {} : { previewUrl }),
    visibility: 'private',
  };
}

const REF_DOCS = [
  '发布会演讲稿（15 分钟）与时长分配',
  '产品路线图梳理（负责人速读版）',
  'cairn 贡献指南',
  '仓库结构总览',
  '0.9 版本发布说明',
  '中继探针复盘报告',
];

const REF_DESIGNS = ['卡片质感原型 + 自动更新', 'Design System', '设置页搜索草图'];

export const makeRef: FixtureSet = {
  ...homeC,
  todos: [
    ...(homeC.todos ?? []).filter((todo) => todo.phase !== 'done'),
    ...REF_DOCS.map((title, index) =>
      refMade(
        `ref-doc-${index}`,
        2500 + index,
        title,
        'document',
        at(MADE_DAY, 2, 30) - index * 3 * HOUR_MS,
        index < 4 ? docPreview(title) : undefined,
      ),
    ),
    ...REF_DESIGNS.map((title, index) =>
      refMade(
        `ref-design-${index}`,
        2520 + index,
        title,
        'design',
        at('2026-09-17', 15, 0) - index * HOUR_MS,
        index < 2 ? designPreview() : undefined,
      ),
    ),
    refMade('ref-other', 2530, '手帐模板', undefined, at('2026-09-20', 10, 0)),
  ],
  now: at(MADE_DAY, 20, 30),
};
