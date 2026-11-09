import { infoReportMessageSchema, quoteIssueLines } from '@cairn/shared';
import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { build, message, step, todo } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import type { MachineWakeHub } from './machine-wake-hub.js';

export const BLOCKED_BY_HOLD = 'blocked-by';
const HOLD_MS = 100 * 365 * 24 * 60 * 60 * 1000;
const HELD_KINDS = ['plan', 'session'] as const;
const DEAD_ENDS = new Set(['failed', 'closed']);

type TodoRow = typeof todo.$inferSelect;

function blockersOf(db: Db, row: Pick<TodoRow, 'blockedBy'>): TodoRow[] {
  const ids = row.blockedBy ?? [];
  if (ids.length === 0) return [];
  return db.select().from(todo).where(inArray(todo.id, ids)).all();
}

function reportLesson(db: Db, blocker: TodoRow): string | null {
  if (blocker.output !== 'info' || blocker.latestBuildId === null) return null;
  const buildRow = db.select().from(build).where(eq(build.id, blocker.latestBuildId)).get();
  const row = db
    .select({ content: message.content })
    .from(message)
    .where(eq(message.id, `info-report-${blocker.latestBuildId}`))
    .get();
  if (typeof row?.content !== 'string') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.content);
  } catch {
    return null;
  }
  const report = infoReportMessageSchema.safeParse(parsed);
  if (!report.success || report.data.attachmentId !== buildRow?.reportAttachmentId) return null;
  return `Prior research (data):\n${quoteIssueLines(report.data.content)}`;
}

function satisfied(db: Db, blocker: TodoRow): boolean {
  if (blocker.phase === 'done') return true;
  return blocker.phase === 'review' && reportLesson(db, blocker) !== null;
}

export function blockedNow(db: Db, row: Pick<TodoRow, 'blockedBy'>): boolean {
  const blockers = blockersOf(db, row);
  return (
    new Set(row.blockedBy ?? []).size !== blockers.length ||
    blockers.some((blocker) => !satisfied(db, blocker))
  );
}

export function deadEndBlocker(
  db: Db,
  row: Pick<TodoRow, 'blockedBy'>,
): { id: string; seqNum: number | string | null; phase: string } | null {
  const blockers = blockersOf(db, row);
  const missing = row.blockedBy?.find((id) => !blockers.some((blocker) => blocker.id === id));
  if (missing !== undefined) return { id: missing, seqNum: missing, phase: 'deleted' };
  return blockers.find((blocker) => DEAD_ENDS.has(blocker.phase)) ?? null;
}

export function blockedHold(): { holdReason: string; holdUntil: number } {
  return { holdReason: BLOCKED_BY_HOLD, holdUntil: Date.now() + HOLD_MS };
}

export function holdBlockedBuild(db: Db, buildId: string): void {
  const buildRow = db
    .select({ todoId: build.todoId })
    .from(build)
    .where(eq(build.id, buildId))
    .get();
  const row =
    buildRow === undefined
      ? undefined
      : db.select().from(todo).where(eq(todo.id, buildRow.todoId)).get();
  if (row === undefined || !blockedNow(db, row)) return;
  db.update(step)
    .set(blockedHold())
    .where(
      and(
        eq(step.buildId, buildId),
        inArray(step.status, ['pending', 'waiting_quota']),
        inArray(step.kind, [...HELD_KINDS]),
      ),
    )
    .run();
}

type BlockedRow = Pick<TodoRow, 'id' | 'teamId' | 'latestBuildId'>;

export function checkBlockedBy(db: Db, row: BlockedRow, ids: readonly string[]): string[] {
  const unique = [...new Set(ids)];
  if (unique.includes(row.id))
    throw new HttpError(400, 'invalid blockedBy: a task cannot block itself');
  const found = unique.length === 0 ? [] : blockersOf(db, { blockedBy: unique });
  const missing = unique.filter(
    (id) => !found.some((blocker) => blocker.id === id && blocker.teamId === row.teamId),
  );
  if (missing.length > 0)
    throw new HttpError(400, `invalid blockedBy: unknown todo ${missing.join(', ')}`);
  const seen = new Set<string>();
  const stack = [...found];
  while (stack.length > 0) {
    const next = stack.pop() as TodoRow;
    if (next.id === row.id) throw new HttpError(400, 'invalid blockedBy: the edges form a cycle');
    if (seen.has(next.id)) continue;
    seen.add(next.id);
    stack.push(...blockersOf(db, next));
  }
  if (row.latestBuildId !== null && blockedNow(db, { blockedBy: unique })) {
    const running = db
      .select({ id: step.id })
      .from(step)
      .where(
        and(
          eq(step.buildId, row.latestBuildId),
          eq(step.status, 'claimed'),
          inArray(step.kind, [...HELD_KINDS]),
        ),
      )
      .get();
    if (running !== undefined)
      throw new HttpError(
        409,
        'blockedBy cannot hold a thread that is already running: stop_thread first, or let it finish',
      );
  }
  return unique;
}

export function releaseBlockedSteps(deps: { db: Db; machineHub?: MachineWakeHub }): void {
  const held = deps.db.select().from(step).where(eq(step.holdReason, BLOCKED_BY_HOLD)).all();
  for (const heldStep of held) {
    const buildRow = deps.db
      .select({ todoId: build.todoId })
      .from(build)
      .where(eq(build.id, heldStep.buildId))
      .get();
    const row =
      buildRow === undefined
        ? undefined
        : deps.db.select().from(todo).where(eq(todo.id, buildRow.todoId)).get();
    if (row !== undefined && blockedNow(deps.db, row)) continue;
    const lesson = (row === undefined ? [] : blockersOf(deps.db, row))
      .map((blocker) => reportLesson(deps.db, blocker))
      .filter((text): text is string => text !== null)
      .join('\n\n');
    const prompt =
      lesson !== '' && !(heldStep.prompt ?? '').includes(lesson)
        ? `${heldStep.prompt ?? ''}\n\n${lesson}`
        : heldStep.prompt;
    deps.db
      .update(step)
      .set({ holdReason: null, holdUntil: null, prompt })
      .where(eq(step.id, heldStep.id))
      .run();
    if (row !== undefined) deps.machineHub?.wake(row.teamId);
  }
}
