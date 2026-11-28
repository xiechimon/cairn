import { otelErrorMessage } from '@cairn/shared';
import type { AssistantMessage } from '@earendil-works/pi-ai';
import { emitCompactionSpan, emitSummaryCallSpan } from '../../runtime-otel.js';

export type CompactionStage =
  | 'memory-flush'
  | 'idle-memory-flush'
  | 'summary-fold'
  | 'background-compaction'
  | 'idle-compaction'
  | 'cache-expiry-compaction';

export interface FailureScope {
  threadId?: string;
  stepId?: string;
  scrub?: (message: string) => string;
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

export function startSummaryCall(
  scope: FailureScope,
  stage: string,
  model: { provider: string; id: string },
) {
  const startMs = Date.now();
  const stepId =
    scope.stepId ?? (scope.threadId === undefined ? null : sink.stepOf(scope.threadId));
  return (reply: AssistantMessage | undefined, error: unknown, httpStatus: number | undefined) => {
    try {
      const scrubSecrets = (text: string) =>
        scope.threadId === undefined
          ? (scope.scrub?.(text) ?? text)
          : sink.scrub(scope.threadId, scope.scrub?.(text) ?? text);
      const scrub = (text: string) =>
        otelErrorMessage(
          scrubSecrets(text).replace(/(?<![a-z0-9+.-])[a-z0-9+.-]+:\/\/[^\s"'<>]+/gi, '<url>'),
        );
      const diagnostics = reply?.diagnostics?.slice(-8).map((item) => ({
        type: item.type,
        name: item.error?.name,
        message: item.error?.message,
        code: item.error?.code,
        configuredTransport: item.details?.configuredTransport,
        fallbackTransport: item.details?.fallbackTransport,
      }));
      const message =
        error === undefined
          ? undefined
          : scrub(error instanceof Error ? error.message : String(error));
      emitSummaryCallSpan({
        ...scope,
        ...(stepId === null ? {} : { stepId }),
        stage,
        provider: model.provider,
        model: model.id,
        startMs,
        endMs: Date.now(),
        ...(reply === undefined
          ? {}
          : {
              finishReason: reply.stopReason,
              usage: reply.usage,
              costUsd: reply.usage?.cost?.total,
            }),
        ...(message === undefined
          ? {}
          : {
              errorMessage: message,
              errorClass: scrub(error instanceof Error ? error.name : typeof error),
            }),
        ...(diagnostics === undefined
          ? {}
          : {
              diagnostics: scrub(
                JSON.stringify(diagnostics, (_key, value: unknown) =>
                  typeof value === 'string' ? scrubSecrets(value) : value,
                ),
              ),
            }),
        ...(httpStatus === undefined ? {} : { httpStatus }),
      });
    } catch {}
  };
}

export function reportCompactionFailure(
  scope: FailureScope,
  stage: CompactionStage,
  error: unknown,
  startAt?: number,
): void {
  const count = (counts.get(stage) ?? 0) + 1;
  counts.set(stage, count);
  const rawClass = error instanceof Error ? error.name : typeof error;
  const errorClass = scope.scrub?.(rawClass) ?? rawClass;
  const original = error instanceof Error ? error.message : String(error);
  const raw = scope.scrub?.(original) ?? original;
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
