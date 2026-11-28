import {
  classifyRetryFailureWithCode,
  RETRY_AFTER_MAX_MS,
  RETRY_AFTER_MIN_MS,
  RETRY_PARKED_MARK,
  type RetryFailureClass,
  type RetryReasonCode,
  redactSecrets,
  runtimeUpdateRequired,
  type StepFailureCode,
  type StepFailureDetail,
  type TodoRetryState,
} from '@cairn/shared';
import { and, eq, gte, inArray, lte } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { build, step, stepSchedule, type todo } from '../db/schema.js';
import { nowMs } from '../lib/ids.js';
import { pendingWorkerQuestions } from './worker-question-store.js';

export { RETRY_PARKED_MARK };
export const FAILED_BUILDS_PER_HOUR_LIMIT = 3;
export const FAILED_BUILD_WINDOW_MS = 3_600_000;
export const AUTOMATIC_RETRY_BASE_MS = 60_000;
export const UNKNOWN_RETRY_BASE_MS = 60_000;
export const UNKNOWN_RETRY_CAP_MS = 4 * 60_000;
export const UNKNOWN_RETRY_LIMIT = 3;
export const UNKNOWN_RETRY_WINDOW_MS = 15 * 60_000;
export const AUTOMATIC_RETRY_LIMIT = UNKNOWN_RETRY_LIMIT;
export const TRANSIENT_RETRY_BASE_MS = 60_000;
export const TRANSIENT_RETRY_CAP_MS = 30 * 60_000;
export const TRANSIENT_RETRY_WINDOW_MS = 6 * 3_600_000;
export const TRANSIENT_RETRY_MAX_ATTEMPTS = 20;
export const RATE_LIMIT_RETRY_BASE_MS = 60_000;
export const RATE_LIMIT_RETRY_CAP_MS = 30 * 60_000;
export const RATE_LIMIT_RETRY_WINDOW_MS = 24 * 3_600_000;
export const RATE_LIMIT_RETRY_MAX_ATTEMPTS = 48;

const DETAIL_MAX_CHARS = 80;
export const ERROR_SCAN_LIMIT = 8_192;

export function sanitizeDetail(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const cleaned = String(redactSecrets(raw).value)
    .replace(/[\p{Cc}[\]()`]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, DETAIL_MAX_CHARS);
  return cleaned === '' ? null : cleaned;
}

export interface RetryBuildSlice {
  id: string;
  todoId?: string;
  errorMessage: string | null;
  failureCode?: StepFailureCode | null;
  failureDetail?: StepFailureDetail | null;
  retryAttempt: number;
  retryClass?: RetryFailureClass | null;
  retryNextAt?: number | null;
  retryWindowStartedAt?: number | null;
  retryParkReason?: RetryReasonCode | null;
}

export function retryIsParked(error: string, failureCode?: StepFailureCode | null): boolean {
  if (error.startsWith(RETRY_PARKED_MARK)) return true;
  if (error.startsWith('PR Auto-fix needs you:')) return false;
  return classifyRetryFailureWithCode(error, failureCode).failureClass === 'permanent';
}

export function runtimeUpdateReason(
  update: NonNullable<ReturnType<typeof runtimeUpdateRequired>>,
): string {
  const runtime = sanitizeDetail(update.runtime) ?? 'the agent runtime';
  const need = `this model needs ${runtime} ${update.required} or newer`;
  return update.current === null
    ? `${RETRY_PARKED_MARK}: ${need}. Update Cairn, then retry.`
    : `${RETRY_PARKED_MARK}: Cairn's built-in ${runtime} ${update.current} is too old: ${need}. Update Cairn, then retry.`;
}

export function failureNeedsHuman(
  errorMessage: string,
  failureCode?: StepFailureCode | null,
): boolean {
  if (retryIsParked(errorMessage, failureCode)) return true;
  return classifyRetryFailureWithCode(errorMessage, failureCode).failureClass === 'permanent';
}

export function nominalDelayForClass(
  failureClass: Exclude<RetryFailureClass, 'permanent'>,
  retryAttempt: number,
  retryAfterMs: number | null = null,
): number {
  if (failureClass === 'rate_limit') {
    if (retryAfterMs !== null) {
      return Math.max(RETRY_AFTER_MIN_MS, Math.min(retryAfterMs, RETRY_AFTER_MAX_MS));
    }
    return Math.min(RATE_LIMIT_RETRY_BASE_MS * 2 ** retryAttempt, RATE_LIMIT_RETRY_CAP_MS);
  }
  if (failureClass === 'transient') {
    return Math.min(TRANSIENT_RETRY_BASE_MS * 2 ** retryAttempt, TRANSIENT_RETRY_CAP_MS);
  }
  return Math.min(UNKNOWN_RETRY_BASE_MS * 2 ** retryAttempt, UNKNOWN_RETRY_CAP_MS);
}

export function jitteredRetryDelayMs(
  nominalMs: number,
  fraction = 0.2,
  random: () => number = Math.random,
): number {
  const sample = Math.min(Math.max(random(), 0), 1);
  return Math.max(1_000, Math.round(nominalMs * (1 - sample * fraction)));
}

export function automaticRetryDelayMs(
  retryAttempt: number,
  failureClass: Exclude<RetryFailureClass, 'permanent'> = 'transient',
): number {
  return nominalDelayForClass(failureClass, retryAttempt);
}

export function automaticRetryDueAt(
  phaseAt: number,
  attemptOrBuild:
    | number
    | Pick<
        RetryBuildSlice,
        'retryAttempt' | 'retryClass' | 'retryNextAt' | 'errorMessage' | 'failureCode'
      >,
): number {
  if (typeof attemptOrBuild === 'number') {
    return phaseAt + automaticRetryDelayMs(attemptOrBuild);
  }
  const error = attemptOrBuild.errorMessage ?? '';
  const classified = classifyRetryFailureWithCode(error, attemptOrBuild.failureCode, phaseAt);
  const failureClass: Exclude<RetryFailureClass, 'permanent'> =
    attemptOrBuild.retryClass != null && attemptOrBuild.retryClass !== 'permanent'
      ? attemptOrBuild.retryClass
      : classified.failureClass === 'permanent'
        ? 'unknown'
        : classified.failureClass;
  const fallbackDueAt =
    failureClass === 'rate_limit' && classified.resetAt !== null
      ? Math.min(classified.resetAt, phaseAt + RETRY_AFTER_MAX_MS)
      : phaseAt +
        nominalDelayForClass(failureClass, attemptOrBuild.retryAttempt, classified.retryAfterMs);
  if (attemptOrBuild.retryNextAt != null) {
    return Math.min(attemptOrBuild.retryNextAt, fallbackDueAt);
  }
  return fallbackDueAt;
}

export function windowLimitMsFor(failureClass: Exclude<RetryFailureClass, 'permanent'>): number {
  if (failureClass === 'transient') return TRANSIENT_RETRY_WINDOW_MS;
  if (failureClass === 'rate_limit') return RATE_LIMIT_RETRY_WINDOW_MS;
  return UNKNOWN_RETRY_WINDOW_MS;
}

function lastStepScheduledBuildIds(db: Db, buildIds: string[]): Set<string> {
  if (buildIds.length === 0) return new Set();
  const latestByBuild = new Map<string, { scheduleId: string | null; createdAt: number }>();
  for (const row of db
    .select({
      buildId: step.buildId,
      scheduleId: stepSchedule.scheduleId,
      createdAt: step.createdAt,
    })
    .from(step)
    .leftJoin(stepSchedule, eq(stepSchedule.stepId, step.id))
    .where(inArray(step.buildId, buildIds))
    .all()) {
    const seen = latestByBuild.get(row.buildId);
    if (seen === undefined || row.createdAt >= seen.createdAt) latestByBuild.set(row.buildId, row);
  }
  return new Set(
    [...latestByBuild].flatMap(([buildId, row]) => (row.scheduleId === null ? [] : [buildId])),
  );
}

export function resolvedClassFor(
  row: Pick<RetryBuildSlice, 'errorMessage' | 'retryClass' | 'failureCode'>,
  now: number,
) {
  const classified = classifyRetryFailureWithCode(row.errorMessage ?? '', row.failureCode, now);
  const failureClass = row.retryClass ?? classified.failureClass;
  return { failureClass, classified };
}

function rateLimitAttemptsInWindow(
  db: Db,
  buildRow: Pick<RetryBuildSlice, 'id' | 'todoId' | 'retryWindowStartedAt'>,
  now: number,
): number {
  const todoId =
    buildRow.todoId ??
    db.select({ todoId: build.todoId }).from(build).where(eq(build.id, buildRow.id)).get()?.todoId;
  if (todoId === undefined) return 0;
  const since = buildRow.retryWindowStartedAt ?? now - RATE_LIMIT_RETRY_WINDOW_MS;
  return db
    .select({ id: build.id })
    .from(build)
    .where(
      and(
        eq(build.todoId, todoId),
        eq(build.retryClass, 'rate_limit'),
        gte(build.createdAt, since),
        lte(build.createdAt, now),
      ),
    )
    .all().length;
}

export function budgetExhaustedReason(
  db: Db,
  row: Pick<
    RetryBuildSlice,
    | 'id'
    | 'todoId'
    | 'errorMessage'
    | 'failureCode'
    | 'retryAttempt'
    | 'retryClass'
    | 'retryWindowStartedAt'
  >,
  now: number,
): RetryReasonCode | null {
  const { failureClass } = resolvedClassFor(row, now);
  if (failureClass === 'permanent') return null;
  const elapsed = row.retryWindowStartedAt != null ? now - row.retryWindowStartedAt : 0;
  if (failureClass === 'transient') {
    if (row.retryAttempt >= TRANSIENT_RETRY_MAX_ATTEMPTS || elapsed >= TRANSIENT_RETRY_WINDOW_MS) {
      return 'window_exhausted';
    }
    return null;
  }
  if (failureClass === 'rate_limit') {
    if (
      elapsed >= RATE_LIMIT_RETRY_WINDOW_MS ||
      rateLimitAttemptsInWindow(db, row, now) >= RATE_LIMIT_RETRY_MAX_ATTEMPTS
    ) {
      return 'rate_limit_exhausted';
    }
    return null;
  }
  if (row.retryAttempt >= UNKNOWN_RETRY_LIMIT || elapsed >= UNKNOWN_RETRY_WINDOW_MS) {
    return 'retries_exhausted';
  }
  return null;
}

export function automaticRetryOwed(db: Db, buildRow: RetryBuildSlice, now = nowMs()): boolean {
  if (buildRow.retryParkReason != null) return false;
  if (failureNeedsHuman(buildRow.errorMessage ?? '', buildRow.failureCode)) return false;
  if (budgetExhaustedReason(db, buildRow, now) !== null) return false;
  if (pendingWorkerQuestions(db, buildRow.id).length > 0) return false;
  return !lastStepScheduledBuildIds(db, [buildRow.id]).has(buildRow.id);
}

export function todoRetryStateOf(
  db: Db,
  todoRow: Pick<typeof todo.$inferSelect, 'phase' | 'phaseAt'>,
  buildRow: RetryBuildSlice | undefined,
  now = nowMs(),
): TodoRetryState | null {
  if (todoRow.phase !== 'failed' || buildRow === undefined) return null;
  const error = buildRow.errorMessage ?? '';
  const { failureClass, classified } = resolvedClassFor(buildRow, now);
  if (automaticRetryOwed(db, buildRow, now)) {
    const scheduledClass: Exclude<RetryFailureClass, 'permanent'> =
      failureClass === 'permanent' ? 'unknown' : failureClass;
    const nextRetryAt = buildRow.retryNextAt ?? automaticRetryDueAt(todoRow.phaseAt, buildRow);
    const windowStartedAt = buildRow.retryWindowStartedAt ?? todoRow.phaseAt;
    return {
      state: 'scheduled',
      failureClass: scheduledClass,
      reasonCode: classified.reasonCode,
      attempt: buildRow.retryAttempt + 1,
      maxAttempts: scheduledClass === 'unknown' ? UNKNOWN_RETRY_LIMIT : null,
      nextRetryAt,
      windowEndsAt: windowStartedAt + windowLimitMsFor(scheduledClass),
    };
  }
  const reasonCode = buildRow.retryParkReason ?? classified.reasonCode;
  const errorSlice = error.length <= ERROR_SCAN_LIMIT ? error : error.slice(0, ERROR_SCAN_LIMIT);
  const update = runtimeUpdateRequired(errorSlice);
  const modelDetail =
    reasonCode === 'model_unavailable'
      ? (/model unavailable \(([^)\r\n]{1,120})\)/i.exec(errorSlice)?.[1] ??
        /(?:model_not_found|unsupported[ _-]model)\s*:\s*([\w./:-]{1,80})/i.exec(errorSlice)?.[1] ??
        null)
      : null;
  const detail = sanitizeDetail(
    update !== null
      ? `${update.runtime ?? 'Agent'} ${update.required}`
      : (modelDetail ?? (reasonCode === 'missing_tool' ? buildRow.failureDetail?.tool : null)),
  );
  return {
    state: 'parked',
    failureClass,
    reasonCode,
    attemptsMade: buildRow.retryAttempt,
    detail,
  };
}
