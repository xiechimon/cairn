import { at, PROJECT_ID, probeTodo, R7_DAY, r7 } from './core.js';
import { HOME_C_CRED, homeC } from './home-c.js';
import type { FixtureSet, TodoRecord } from './records.js';

const day = (date: string, h: number, m: number) => at(date, h, m);

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
    r7(20, 0),
    1.84,
  ),
  activityTodo('act-gallery', 438, 'Trim the gallery frame', 'building', CAIRN, r7(19, 30), 0.31),
  activityTodo('act-bump', 120, 'Dependency bump', 'confirm', RELAY, r7(18, 0), 0.08),
  activityTodo(
    'act-routing',
    402,
    'Move routing rules behind the work policy',
    'failed',
    CAIRN,
    day('2026-09-20', 15, 0),
    4.1,
  ),
  activityTodo('act-flip', 377, 'Flip detector', 'review', CAIRN, day('2026-09-20', 9, 0), 0.62),
  activityTodo(
    'act-sweep',
    88,
    'Weekly flaky-test sweep',
    'done',
    RELAY,
    day('2026-09-18', 11, 0),
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
  now: r7(20, 30),
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
      Date.parse(`${R7_DAY}T20:00:00+08:00`) - i * 60_000,
      0.5,
    ),
  ),
};
