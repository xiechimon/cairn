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

const scheduleOnce: ScheduleRecord = {
  id: 'r3-schedule-1',
  teamId: TEAM_ID,
  projectId: PROJECT_ID,
  todoId: 'r3-legacy-1',
  kind: 'once',
  at: at(R3_DAY, 14, 30),
  tz: 'Asia/Shanghai',
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

export const schedulesEmpty: FixtureSet = {
  todos: [legacyReview, legacyDone],
  now: r7(13, 14),
  schedules: [],
  project: projectContent,
};

export const schedulesList: FixtureSet = {
  todos: [legacyReview, legacyDone],
  now: at(R3_DAY, 13, 50),
  schedules: [scheduleOnce],
  project: projectContent,
};

export const schedulesFormDaily: FixtureSet = {
  todos: [legacyReview, legacyDone],
  now: at(R3_DAY, 13, 50),
  schedules: [],
  scheduleForm: 'daily',
  project: projectContent,
};

export const schedulesFormOnce: FixtureSet = {
  ...schedulesFormDaily,
  scheduleForm: 'once',
};
