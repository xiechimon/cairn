import { PROJECT_ID, probeTodo } from './core.js';
import { HOME_C_CRED, homeC } from './home-c.js';
import type { FixtureSet, TodoRecord } from './records.js';

const ACTIVITY_DAY = '2026-09-23';
const day = (date: string, h: number, m: number) =>
  Date.parse(`${date}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`);

function activityTodo(
  id: string,
  seqNum: number,
  title: string,
  phase: TodoRecord['phase'],
  projectId: string,
  phaseAt: number,
  total?: number,
): TodoRecord {
  return {
    ...probeTodo(phase, phaseAt),
    id,
    seqNum,
    title,
    spec: title,
    projectId,
    phaseAt,
    latestBuildId: `build-${id}`,
    ...(total === undefined
      ? {}
      : {
          usageCost: {
            input: total / 2,
            output: total / 2,
            cacheRead: 0,
            cacheWrite: 0,
            total,
            priced: true,
          },
        }),
  };
}

const CAIRN = PROJECT_ID;
const RELAY = HOME_C_CRED;

export const activityTodos: TodoRecord[] = [
  activityTodo(
    'act-fold',
    431,
    'Fold finished turns in the transcript',
    'failed',
    CAIRN,
    day(ACTIVITY_DAY, 20, 0),
    1.84,
  ),
  activityTodo(
    'act-gallery',
    438,
    'Trim the gallery frame',
    'building',
    CAIRN,
    day(ACTIVITY_DAY, 19, 30),
    0.31,
  ),
  activityTodo(
    'act-bump',
    120,
    'Dependency bump',
    'confirm',
    RELAY,
    day(ACTIVITY_DAY, 18, 0),
    0.08,
  ),
  activityTodo(
    'act-routing',
    402,
    'Move routing rules behind the work policy',
    'failed',
    CAIRN,
    day('2026-09-22', 15, 0),
    4.1,
  ),
  activityTodo('act-flip', 377, 'Flip detector', 'review', CAIRN, day('2026-09-22', 9, 0), 0.62),
  activityTodo(
    'act-sweep',
    88,
    'Weekly flaky-test sweep',
    'done',
    RELAY,
    day('2026-09-21', 11, 0),
    2.47,
  ),
  activityTodo(
    'act-old-done',
    40,
    'Retire the old board',
    'done',
    CAIRN,
    day('2026-09-01', 10, 0),
    0.95,
  ),
  activityTodo(
    'act-old-failed',
    33,
    'Backfill usage rows',
    'failed',
    CAIRN,
    day('2026-08-28', 10, 0),
  ),
];

export const activityFixture: FixtureSet = {
  ...homeC,
  todos: activityTodos,
  now: day(ACTIVITY_DAY, 20, 30),
};

export const activityManyFixture: FixtureSet = {
  ...activityFixture,
  todos: Array.from({ length: 30 }, (_, i) =>
    activityTodo(
      `act-many-${i}`,
      500 + i,
      `Thread ${i + 1}`,
      'done',
      CAIRN,
      day(ACTIVITY_DAY, 20, 0) - i * 60_000,
      0.5,
    ),
  ),
};
