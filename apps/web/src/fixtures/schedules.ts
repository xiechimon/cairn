import {
  at,
  legacyDone,
  legacyReview,
  PROJECT_ID,
  PROJECT_NAME,
  projectContent,
  R3_DAY,
  r7,
  TEAM_ID,
} from './core.js';
import type { FixtureSet, ScheduleRecord } from './records.js';

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
