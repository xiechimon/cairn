import {
  chatAttributes,
  chiefTurnErrorContentSchema,
  coordinatorTurnAttributes,
  dropMailFence,
  executeToolAttributes,
  GENAI_OPERATION,
  isMailWakeText,
  LANGFUSE_ATTR,
  langfuseEnvironmentAttributes,
  langfuseTraceAttributes,
  mailFenceBlock,
  type OtelObservation,
  observationAttributes,
  otelEnvironment,
  otelErrorMessage,
  otelResourceAttributes,
  redactSecrets,
  runtimeBuildAttributes,
  stepAttributes,
  type TokenCounts,
  transcriptPromptRowId,
} from '@cairn/shared';
import {
  type CairnSpan,
  type CairnTracing,
  createCairnTracing,
  type OtlpTarget,
  otlpRootSpanIdOfBuild,
  otlpStepSpanIdOfBuild,
  otlpTraceIdOfBuild,
  otlpTraceIdOfStep,
  parseOtlpTarget,
} from '@cairn/shared/otel';
import { and, asc, eq, or, sql } from 'drizzle-orm';
import type { Db } from './db/client.js';
import { build, chiefMessage, machine, message, schedule, step, todo } from './db/schema.js';
import { githubUnattributedCounts } from './lib/github-token.js';
import { parseChiefTrigger } from './services/chief.js';
import { stepRuntimeFor } from './services/dispatch-eligibility.js';
import { storedStepRoute } from './services/step-route.js';

const SCOPE = 'cairn.server';
const COORDINATOR_TURN_SPAN = 'coordinator turn';
const tracings = new Map<string, CairnTracing>();

function runtimeTarget(env: NodeJS.ProcessEnv): OtlpTarget | null {
  try {
    return parseOtlpTarget(env);
  } catch {
    return null;
  }
}

function push(target: OtlpTarget, env: NodeJS.ProcessEnv, spans: CairnSpan[]): void {
  if (spans.length === 0) return;
  const environment = otelEnvironment(env);
  const key = JSON.stringify([target.url.href, target.headers, environment]);
  let tracing = tracings.get(key);
  if (tracing === undefined) {
    tracing = createCairnTracing(target, otelResourceAttributes(environment), SCOPE);
    tracings.set(key, tracing);
  }
  tracing.record(spans);
}

export async function flushRuntimeOtel(): Promise<void> {
  await Promise.all([...tracings.values()].map((tracing) => tracing.forceFlush()));
}

export async function shutdownRuntimeOtel(): Promise<void> {
  const open = [...tracings.values()];
  tracings.clear();
  await Promise.all(open.map((tracing) => tracing.shutdown()));
}

function stepFailureReason(db: Db, row: typeof step.$inferSelect): string | undefined {
  if (row.kind === 'chief') {
    const recorded = db
      .select()
      .from(chiefMessage)
      .where(eq(chiefMessage.id, `chief-err-${row.id}`))
      .get();
    try {
      const content =
        typeof recorded?.content === 'string' ? JSON.parse(recorded.content) : recorded?.content;
      const parsed = chiefTurnErrorContentSchema.safeParse(content);
      return parsed.success ? otelErrorMessage(parsed.data.message) : undefined;
    } catch {
      return undefined;
    }
  }
  if (row.scheduleId === null) return undefined;
  const recorded = db
    .select()
    .from(schedule)
    .where(and(eq(schedule.id, row.scheduleId), eq(schedule.lastRunStepId, row.id)))
    .get();
  return otelErrorMessage(recorded?.lastRunError);
}

const MAIL_PROVENANCE = /provenance=(mail:[A-Za-z0-9_-]+)/;
const MAIL_IDS = /邮件事件 ([^，\s]+)，账户 ([^，\s]+)，外部编号 ([^，\s]+)，规则 ([^。\n]+)。/;

function decodeObservation(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed.startsWith('[') && !trimmed.startsWith('{')) return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function collectText(value: unknown, out: string[]): void {
  if (typeof value === 'string') {
    out.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectText(item, out);
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const item of Object.values(value as Record<string, unknown>)) collectText(item, out);
  }
}

function observationTexts(value: unknown): string[] {
  const texts: string[] = [];
  collectText(decodeObservation(value), texts);
  return texts;
}

function mailTurnTelemetry(
  input: unknown,
  output: unknown,
): {
  provenance: string;
  eventId?: string;
  accountId?: string;
  externalId?: string;
  rule?: string;
  promptChars: number;
  excerptChars: number;
  replyChars: number;
} | null {
  const texts = observationTexts(input);
  const joined = texts.join('\n');
  const provenance = MAIL_PROVENANCE.exec(joined)?.[1];
  if (provenance === undefined && !texts.some((text) => isMailWakeText(text))) return null;
  const ids = MAIL_IDS.exec(joined);
  const fence =
    texts.map((text) => mailFenceBlock(text)).find((block) => block !== null) ??
    mailFenceBlock(joined);
  const reply = observationTexts(output).join('');
  return {
    provenance: provenance ?? 'mail:',
    ...(ids?.[1] === undefined ? {} : { eventId: ids[1] }),
    ...(ids?.[2] === undefined ? {} : { accountId: ids[2] }),
    ...(ids?.[3] === undefined ? {} : { externalId: ids[3] }),
    ...(ids?.[4] === undefined ? {} : { rule: ids[4] }),
    promptChars: dropMailFence(joined).length,
    excerptChars: fence?.length ?? 0,
    replyChars: reply.length,
  };
}

function redactMailObservation(observation: OtelObservation): OtelObservation {
  const mail = mailTurnTelemetry(observation.input, observation.output);
  if (mail === null) return observation;
  return { input: mail, output: { replyChars: mail.replyChars } };
}

export function emitRuntimeStepSpan(
  db: Db,
  stepId: string,
  env: NodeJS.ProcessEnv = process.env,
  observation: OtelObservation = {},
): void {
  const target = runtimeTarget(env);
  if (target === null) return;
  const row = db.select().from(step).where(eq(step.id, stepId)).get();
  if (!row || row.claimedAt == null) return;
  const environment = otelEnvironment(env);
  const attribution = Object.fromEntries(
    [...githubUnattributedCounts()].map(([reason, count]) => [
      `cairn.github.write_unattributed.${reason}`,
      count,
    ]),
  );
  const start = row.claimedAt;
  const end = Math.max(start, row.finishedAt ?? Date.now());
  const isTurn = row.kind === 'chief';
  const buildRow = isTurn
    ? undefined
    : db.select().from(build).where(eq(build.id, row.buildId)).get();
  const machineRow =
    !isTurn && row.machineId !== null
      ? db.select({ name: machine.name }).from(machine).where(eq(machine.id, row.machineId)).get()
      : undefined;
  const model = isTurn ? undefined : row.fallback?.model;
  const errorMessage =
    row.status === 'failed'
      ? (stepFailureReason(db, row) ?? otelErrorMessage(buildRow?.errorMessage))
      : undefined;
  const traceId = otlpTraceIdOfStep({ kind: row.kind, buildId: row.buildId, stepId: row.id });
  const prefix = `msg-${row.id}-`;
  const transcript = isTurn
    ? []
    : db
        .select({ role: message.role, content: message.content })
        .from(message)
        .where(
          and(
            eq(message.conversationId, row.buildId),
            or(
              eq(message.id, transcriptPromptRowId(row.id)),
              sql`substr(${message.id}, 1, ${prefix.length}) = ${prefix}`,
            ),
          ),
        )
        .orderBy(asc(message.createdAt))
        .all()
        .flatMap((entry) => {
          const content =
            typeof entry.content === 'string'
              ? entry.content
              : Array.isArray(entry.content)
                ? entry.content.filter(
                    (block: unknown) =>
                      typeof block === 'object' &&
                      block !== null &&
                      'type' in block &&
                      block.type === 'text',
                  )
                : [];
          return typeof content === 'string' || content.length > 0
            ? [{ role: entry.role, content }]
            : [];
        });
  const payload = isTurn
    ? redactMailObservation(observation)
    : {
        input: transcript.filter((entry) => entry.role === 'user'),
        output: transcript.filter((entry) => entry.role === 'assistant').slice(-1),
      };
  push(target, env, [
    {
      spanId: otlpStepSpanIdOfBuild(row.buildId, row.id),
      ...(isTurn
        ? { traceId }
        : { parent: { traceId, spanId: otlpRootSpanIdOfBuild(row.buildId) } }),
      name: isTurn ? COORDINATOR_TURN_SPAN : `step ${row.kind}`,
      kind: 'internal',
      startMs: start,
      endMs: end,
      attributes: {
        ...attribution,
        ...observationAttributes(payload),
        ...stepAttributes({
          stepId: row.id,
          kind: row.kind,
          checkpointCommit: row.checkpointCommit,
          errorMessage,
          route: storedStepRoute(db, row.id),
          ...(isTurn
            ? {}
            : {
                buildId: row.buildId,
                todoId: buildRow?.todoId,
                machineId: row.machineId,
                machineName: machineRow?.name,
                runtime: model ? stepRuntimeFor(model.provider) : undefined,
                provider: model?.provider,
                model: model?.modelId,
              }),
        }),
        ...(isTurn
          ? {
              ...coordinatorTurnAttributes({
                stepId: row.id,
                threadId: row.buildId,
                trigger: parseChiefTrigger(row.prompt),
              }),
              ...langfuseTraceAttributes({
                name: COORDINATOR_TURN_SPAN,
                sessionId: row.buildId,
                tags: ['cairn', 'coordinator'],
                environment,
              }),
            }
          : {
              ...langfuseEnvironmentAttributes(environment),
              ...(buildRow ? { [LANGFUSE_ATTR.sessionId]: buildRow.todoId } : {}),
            }),
      },
      ...(row.status === 'failed' ? { error: errorMessage ?? 'failed' } : {}),
    },
  ]);
}

export function emitRuntimeBuildSpan(
  db: Db,
  buildId: string,
  outcome: 'done' | 'failed' | 'cancelled',
  env: NodeJS.ProcessEnv = process.env,
): void {
  const target = runtimeTarget(env);
  if (target === null) return;
  const row = db.select().from(build).where(eq(build.id, buildId)).get();
  if (!row) return;
  const todoRow = db.select().from(todo).where(eq(todo.id, row.todoId)).get();
  const errorMessage = outcome === 'done' ? undefined : otelErrorMessage(row.errorMessage);
  const start = row.createdAt;
  const end = Math.max(start, Date.now());
  push(target, env, [
    {
      traceId: otlpTraceIdOfBuild(row.id),
      spanId: otlpRootSpanIdOfBuild(row.id),
      name: GENAI_OPERATION.invokeAgent,
      kind: 'internal',
      startMs: start,
      endMs: end,
      attributes: {
        ...runtimeBuildAttributes({
          buildId: row.id,
          todoId: row.todoId,
          errorMessage,
          baseSha: row.baseSha,
          harnessHash: row.harnessHash,
          agentName: todoRow?.title,
        }),
        ...langfuseTraceAttributes({
          name: 'build',
          sessionId: row.todoId,
          tags: ['cairn', 'build'],
          environment: otelEnvironment(env),
        }),
      },
      ...(outcome === 'done' ? {} : { error: errorMessage ?? outcome }),
    },
  ]);
}

export type CoordinatorTurnSpanRecord =
  | {
      kind: 'chat';
      input?: unknown;
      output?: unknown;
      at: number;
      provider: string;
      model: string;
      responseModel?: string;
      finishReason?: string;
      rawFinishReason?: string;
      usage: TokenCounts;
      costUsd?: number;
      errorMessage?: string;
    }
  | {
      kind: 'tool';
      id: string;
      name: string;
      arguments: unknown;
      result: unknown;
      isError: boolean;
      startAt: number;
      endAt: number;
    };

function jsonText(value: unknown): string {
  return typeof value === 'string' ? value : (JSON.stringify(value) ?? '');
}

export function emitCoordinatorTurnSpans(
  turn: {
    threadId: string;
    stepId: string;
    provider: string;
    model: string;
    redactText?: boolean;
  },
  records: readonly CoordinatorTurnSpanRecord[],
  env: NodeJS.ProcessEnv = process.env,
): void {
  const target = runtimeTarget(env);
  if (target === null || records.length === 0) return;
  const environment = otelEnvironment(env);
  const mail =
    turn.redactText === true ||
    records.some(
      (record) => record.kind === 'chat' && mailTurnTelemetry(record.input, record.output) !== null,
    );
  const parent = {
    traceId: otlpTraceIdOfStep({ kind: 'chief', buildId: turn.threadId, stepId: turn.stepId }),
    spanId: otlpStepSpanIdOfBuild(turn.threadId, turn.stepId),
  };
  const spans: CairnSpan[] = records.map((record): CairnSpan => {
    if (record.kind === 'chat') {
      const observation = mail
        ? redactMailObservation({ input: record.input, output: record.output })
        : record;
      return {
        parent,
        name: `chat ${record.model}`.trim(),
        kind: 'client',
        startMs: record.at,
        endMs: record.at,
        attributes: {
          ...observationAttributes(observation),
          ...chatAttributes(
            {
              provider: record.provider,
              model: record.model,
              ...(record.responseModel !== undefined
                ? { responseModel: record.responseModel }
                : {}),
              ...(record.finishReason !== undefined ? { finishReason: record.finishReason } : {}),
              ...(record.rawFinishReason !== undefined
                ? { rawFinishReason: record.rawFinishReason }
                : {}),
              usage: record.usage,
              ...(record.costUsd !== undefined ? { costUsd: record.costUsd } : {}),
            },
            { provider: turn.provider, model: turn.model },
          ),
          ...langfuseEnvironmentAttributes(environment),
        },
        ...(record.finishReason === 'error'
          ? {
              error: mail ? 'mail turn error' : (otelErrorMessage(record.errorMessage) ?? 'error'),
            }
          : {}),
      };
    }
    const argumentText = jsonText(record.arguments);
    const resultText = jsonText(record.result);
    return {
      parent,
      name: `execute_tool ${record.name}`,
      kind: 'internal',
      startMs: record.startAt,
      endMs: Math.max(record.startAt, record.endAt),
      attributes: {
        ...executeToolAttributes({
          name: record.name,
          callId: record.id,
          arguments: mail ? JSON.stringify({ chars: argumentText.length }) : argumentText,
          result: mail ? JSON.stringify({ chars: resultText.length }) : resultText,
        }),
        ...langfuseEnvironmentAttributes(environment),
      },
      ...(record.isError ? { error: 'tool error' } : {}),
    };
  });
  push(target, env, redactSecrets(spans).value as CairnSpan[]);
}

export function emitCompactionFailureSpan(
  failure: {
    stage: string;
    errorClass: string;
    message: string;
    count: number;
    threadId?: string | undefined;
    stepId?: string | undefined;
  },
  env: NodeJS.ProcessEnv = process.env,
): void {
  const target = runtimeTarget(env);
  if (target === null) return;
  const environment = otelEnvironment(env);
  const now = Date.now();
  const inTurn = failure.threadId !== undefined && failure.stepId !== undefined;
  const traceId = inTurn
    ? otlpTraceIdOfStep({
        kind: 'chief',
        buildId: failure.threadId ?? '',
        stepId: failure.stepId ?? '',
      })
    : otlpTraceIdOfBuild(failure.threadId ?? 'coordinator');
  const span: CairnSpan = {
    ...(inTurn
      ? {
          parent: {
            traceId,
            spanId: otlpStepSpanIdOfBuild(failure.threadId ?? '', failure.stepId ?? ''),
          },
        }
      : { traceId }),
    name: `compaction ${failure.stage}`,
    kind: 'internal',
    startMs: now,
    endMs: now,
    attributes: {
      'cairn.compaction.stage': failure.stage,
      'cairn.compaction.failure_count': failure.count,
      'error.type': failure.errorClass,
      ...langfuseEnvironmentAttributes(environment),
    },
    error: failure.message,
  };
  push(target, env, redactSecrets([span]).value as CairnSpan[]);
}
