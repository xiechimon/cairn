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
import type { FixtureSet, ScheduleRecord, TodoRecord } from './records.js';

export const scheduleOnce: ScheduleRecord = {
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

export const scheduleEvent: ScheduleRecord = {
  id: 'r3-schedule-2',
  teamId: TEAM_ID,
  projectId: PROJECT_ID,
  todoId: 'r3-legacy-2',
  kind: 'event',
  at: null,
  tz: 'Asia/Shanghai',
  nextRunAt: null,
  triggerSpec: { topic: 'todo.build.completed' },
  createdBy: 'u-xmon-dai',
  todo: {
    seqNum: 2,
    title: legacyDone.title,
    phase: 'done',
    projectName: PROJECT_NAME,
    ownerId: 'u-xmon-dai',
  },
};

export const legacyHook: TodoRecord = {
  ...legacyDone,
  id: 'r3-legacy-3',
  title: '把部署结果同步到看板',
  spec: '把部署结果同步到看板。',
  phase: 'todo',
  seqNum: 3,
};

export const scheduleWebhook: ScheduleRecord = {
  id: 'r3-schedule-3',
  teamId: TEAM_ID,
  projectId: PROJECT_ID,
  todoId: 'r3-legacy-3',
  kind: 'webhook',
  at: null,
  tz: 'Asia/Shanghai',
  nextRunAt: null,
  webhookMasked: 'cairn-wh-4f2a…9c71',
  createdBy: 'u-xmon-dai',
  todo: {
    seqNum: 3,
    title: legacyHook.title,
    phase: 'todo',
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
  todos: [legacyReview, legacyDone, legacyHook],
  now: at(R3_DAY, 13, 50),
  schedules: [scheduleOnce, scheduleEvent, scheduleWebhook],
  project: projectContent,
};
