import { boardDefault } from './board.js';
import { chiefDefault } from './chief.js';
import { PROJECT_ID, probeTodo, r7 } from './core.js';
import type { ChiefContent, FixtureSet, TodoRecord } from './records.js';

function homeTodo(id: string, seqNum: number, title: string, phase: TodoRecord['phase']) {
  return { ...probeTodo(phase, r7(8, 41)), id, seqNum, title, spec: title, projectId: PROJECT_ID };
}

const OTHER_PROJECT = 'project-home-other';

const CAIRN_GOAL =
  'Ship an open-source, self-hostable agent team that merges its own PRs unattended and gets better every week.';

const coordinator: ChiefContent = {
  ...chiefDefault,
  view: 'none',
  bound: true,
  threadTitle: 'cairn',
  threadId: 'chief-project-home',
  examples: undefined,
  stream: [
    {
      kind: 'user',
      id: 'project-home-ask',
      text: 'Pick up B1: the subscription token, snooze, and the turn folding. Run them in parallel.',
    },
    {
      kind: 'robot',
      id: 'project-home-reply',
      seconds: '4s',
      paragraphs: [
        [{ text: 'Started three threads. I will bring each one back here when it needs you.' }],
      ],
    },
    { kind: 'handoff', todoId: 'project-home-waiting', id: 'project-home-h1' },
    { kind: 'handoff', todoId: 'project-home-review', id: 'project-home-h2' },
    { kind: 'handoff', todoId: 'project-home-working', id: 'project-home-h3' },
  ],
  streamAt: [r7(8, 41), r7(8, 41), r7(8, 41), r7(8, 41), r7(8, 41)],
};

const cairnTodos = [
  homeTodo('project-home-waiting', 2301, 'Connect a Claude subscription token', 'confirm'),
  homeTodo('project-home-review', 2271, 'Fold finished turns into purpose and duration', 'review'),
  homeTodo('project-home-working', 2302, 'Push for finished and failed threads', 'building'),
  homeTodo('project-home-idle', 2240, 'Sidebar status groups', 'todo'),
  {
    ...homeTodo('project-home-snoozed', 2236, 'Automation badge and popover', 'todo'),
    snoozeMode: 'needed' as const,
  },
  homeTodo('project-home-done-a', 2201, 'Unread dot on threads', 'done'),
  homeTodo('project-home-done-b', 2202, 'Snooze until a time', 'done'),
];

export const projectHome: FixtureSet = {
  ...boardDefault,
  projectNames: { [PROJECT_ID]: 'cairn' },
  todos: cairnTodos,
  chief: coordinator,
  projectHome: { goal: CAIRN_GOAL, repo: 'xiechimon/cairn' },
  now: r7(9, 0),
};

export const projectHomeEmpty: FixtureSet = {
  ...boardDefault,
  projectNames: { [PROJECT_ID]: 'api-latency', [OTHER_PROJECT]: 'cairn-site' },
  todos: [],
  chief: { ...coordinator, stream: [], streamAt: [] },
  projectHome: {
    goal: 'Bring p95 latency under 200 ms across the whole API, without new infrastructure.',
    repo: 'xiechimon/api',
  },
  now: r7(9, 0),
};

export const projectHomeSendError: FixtureSet = {
  ...projectHome,
  projectNames: { [PROJECT_ID]: 'cairn', [OTHER_PROJECT]: 'cairn-site' },
  projectHome: {
    goal: CAIRN_GOAL,
    repo: 'xiechimon/cairn',
    sendError: {
      draft: 'Plan the next batch',
      message: 'Could not reach the Coordinator. The server returned 502; your message is kept.',
    },
  },
};

export const projectHomeArchived: FixtureSet = {
  ...projectHome,
  projectHome: { goal: CAIRN_GOAL, repo: 'xiechimon/cairn', archived: true },
};
