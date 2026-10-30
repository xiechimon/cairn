import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { schedule, type todo } from '../db/schema.js';
import { HttpError, parseWith } from '../lib/errors.js';
import { nowMs } from '../lib/ids.js';
import {
  assertWorkerScheduleInterval,
  computeNextRunAt,
  createSchedule,
  cronExpressionFor,
  isWorkerSchedule,
  parseThreadCadence,
  pauseSchedule,
  type ScheduleDeps,
} from './schedules.js';

const threadScheduleToolNames = [
  'schedule_create',
  'get_schedule',
  'schedule_update',
  'schedule_pause',
  'schedule_clear',
] as const;

type ThreadScheduleToolName = (typeof threadScheduleToolNames)[number];

export function isThreadScheduleTool(name: string): name is ThreadScheduleToolName {
  return (threadScheduleToolNames as readonly string[]).includes(name);
}

const promptSchema = z
  .string()
  .min(1)
  .max(16_000)
  .refine((value) => value.trim().length > 0);
const cadenceSchema = z.string().trim().min(1).max(256);
const reasonSchema = z.string().trim().min(1).max(1000);
const createSchema = z.strictObject({ cadence: cadenceSchema, prompt: promptSchema });
const updateSchema = z
  .strictObject({ cadence: cadenceSchema.optional(), prompt: promptSchema.optional() })
  .refine((value) => value.cadence !== undefined || value.prompt !== undefined);
const pauseSchema = z.strictObject({ reason: reasonSchema.optional() });
const clearSchema = z.strictObject({ reason: reasonSchema });
const getSchema = z.strictObject({});

function view(row: typeof schedule.$inferSelect) {
  return {
    prompt: row.prompt,
    cadence:
      row.kind === 'once'
        ? `at ${new Date(row.at ?? 0).toISOString()}`
        : cronExpressionFor(row.kind, row.at, row.tz, row.cron),
    nextRunAt: row.nextRunAt,
    lastRunAt: row.lastRunAt,
    enabled: row.enabled,
  };
}

export function executeThreadScheduleTool(
  deps: ScheduleDeps,
  todoRow: typeof todo.$inferSelect,
  createdBy: string,
  name: ThreadScheduleToolName,
  params: Record<string, unknown>,
): string {
  const where = and(eq(schedule.todoId, todoRow.id), eq(schedule.teamId, todoRow.teamId));
  if (name === 'schedule_create') {
    const body = parseWith(createSchema, params, 'params');
    createSchedule(
      deps,
      {
        ...parseThreadCadence(body.cadence),
        todoId: todoRow.id,
        teamId: todoRow.teamId,
        createdBy,
        prompt: body.prompt,
      },
      { allowAnyMinute: true },
    );
  } else if (name === 'get_schedule') {
    parseWith(getSchema, params, 'params');
  } else if (name === 'schedule_update') {
    const body = parseWith(updateSchema, params, 'params');
    const row = deps.db.select().from(schedule).where(where).get();
    if (!row) throw new HttpError(404, 'thread schedule not found');
    const cadence = body.cadence === undefined ? null : parseThreadCadence(body.cadence);
    if (cadence === null) {
      assertWorkerScheduleInterval(row, nowMs(), !isWorkerSchedule(row.createdBy));
    }
    const timing =
      cadence === null
        ? {}
        : {
            ...cadence,
            cron: cadence.kind === 'cron' ? cadence.cron : null,
            nextRunAt: computeNextRunAt(
              cadence.kind,
              cadence.at,
              row.tz,
              nowMs(),
              cadence.kind === 'cron' ? cadence.cron : null,
            ),
            enabled: true,
            pausedReason: null,
          };
    deps.db
      .update(schedule)
      .set({ ...timing, createdBy, ...(body.prompt === undefined ? {} : { prompt: body.prompt }) })
      .where(where)
      .run();
  } else {
    const body =
      name === 'schedule_clear'
        ? parseWith(clearSchema, params, 'params')
        : parseWith(pauseSchema, params, 'params');
    const row = deps.db.select().from(schedule).where(where).get();
    if (!row) throw new HttpError(404, 'thread schedule not found');
    pauseSchedule(deps, row.id, body.reason ?? 'Paused by worker');
  }
  const row = deps.db.select().from(schedule).where(where).get();
  return JSON.stringify(row ? view(row) : null);
}
