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
