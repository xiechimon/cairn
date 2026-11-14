import { otelErrorMessage } from '@cairn/shared';
import { emitCompactionSpan } from '../../runtime-otel.js';

export type CompactionStage =
  | 'memory-flush'
  | 'model-switch-fold'
  | 'seed-summary'
  | 'summary-model'
  | 'summary-fold'
  | 'background-compaction';

export interface FailureScope {
  threadId?: string;
  stepId?: string;
}

export interface FailureSink {
  log(fields: object, message: string): void;
  stepOf(threadId: string): string | null;
  scrub(threadId: string, message: string): string;
}

const stderrSink: FailureSink = {
  log: (fields, message) =>
    process.stderr.write(`${JSON.stringify({ ...fields, msg: message })}\n`),
  stepOf: () => null,
  scrub: (_threadId, message) => message,
};

let sink: FailureSink = stderrSink;
const counts = new Map<CompactionStage, number>();
const reportedTasks = new Set<string>();
const REPORTED_TASKS_MAX = 1_000;

export function setFailureSink(next: FailureSink | null): void {
  sink = next ?? stderrSink;
}

export function compactionFailureCounts(): Record<string, number> {
  return Object.fromEntries(counts);
}

export function resetCompactionFailureCounts(): void {
  counts.clear();
  reportedTasks.clear();
}

export const COMPACTION_FAILURE_LOG = 'coordinator compaction step failed';

export function recordCompactionSuccess(
  scope: FailureScope,
  stage: CompactionStage,
  startAt: number,
): void {
  const stepId =
    scope.stepId ?? (scope.threadId === undefined ? null : sink.stepOf(scope.threadId));
  emitCompactionSpan({ ...scope, stepId: stepId ?? undefined, stage, startAt });
}

export function reportCompactionFailure(
  scope: FailureScope,
  stage: CompactionStage,
  error: unknown,
  startAt?: number,
): void {
  const count = (counts.get(stage) ?? 0) + 1;
  counts.set(stage, count);
  const errorClass = error instanceof Error ? error.name : typeof error;
  const raw = error instanceof Error ? error.message : String(error);
  const message = otelErrorMessage(
    scope.threadId === undefined ? raw : sink.scrub(scope.threadId, raw),
  );
  const stepId =
    scope.stepId ?? (scope.threadId === undefined ? null : sink.stepOf(scope.threadId));
  try {
    sink.log(
      {
        stage,
        errorClass,
        error: message ?? '',
        failureCount: count,
        ...(scope.threadId === undefined ? {} : { threadId: scope.threadId }),
        ...(stepId === null ? {} : { stepId }),
      },
      COMPACTION_FAILURE_LOG,
    );
  } finally {
    emitCompactionSpan({
      stage,
      startAt,
      errorClass,
      message: message ?? 'failed',
      count,
      threadId: scope.threadId,
      stepId: stepId ?? undefined,
    });
  }
}

export function taskFailure(reason: string): Error {
  const error = new Error(reason);
  error.name = 'CompactionTaskFailed';
  return error;
}

export function reportLiveCompactionFailure(scope: FailureScope, live: unknown): void {
  const failure = (
    live as { compactionFailure?: { taskId?: unknown; error?: unknown } } | undefined
  )?.compactionFailure;
  if (failure === undefined) return;
  const key = `${scope.threadId ?? ''}:${String(failure.taskId)}`;
  if (reportedTasks.has(key)) return;
  if (reportedTasks.size >= REPORTED_TASKS_MAX) reportedTasks.clear();
  reportedTasks.add(key);
  reportCompactionFailure(scope, 'background-compaction', taskFailure(String(failure.error)));
}
