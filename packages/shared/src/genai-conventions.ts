import { LangfuseOtelSpanAttributes } from '@langfuse/core';
import type { Attributes, AttributeValue } from '@opentelemetry/api';
import {
  ATTR_GEN_AI_AGENT_ID,
  ATTR_GEN_AI_AGENT_NAME,
  ATTR_GEN_AI_OPERATION_NAME,
  ATTR_GEN_AI_PROVIDER_NAME,
  ATTR_GEN_AI_REQUEST_MODEL,
  ATTR_GEN_AI_RESPONSE_FINISH_REASONS,
  ATTR_GEN_AI_RESPONSE_MODEL,
  ATTR_GEN_AI_TOOL_CALL_ARGUMENTS,
  ATTR_GEN_AI_TOOL_CALL_ID,
  ATTR_GEN_AI_TOOL_CALL_RESULT,
  ATTR_GEN_AI_TOOL_NAME,
  ATTR_GEN_AI_USAGE_CACHE_CREATION_INPUT_TOKENS,
  ATTR_GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS,
  ATTR_GEN_AI_USAGE_INPUT_TOKENS,
  ATTR_GEN_AI_USAGE_OUTPUT_TOKENS,
  GEN_AI_OPERATION_NAME_VALUE_CHAT,
  GEN_AI_OPERATION_NAME_VALUE_EXECUTE_TOOL,
  GEN_AI_OPERATION_NAME_VALUE_INVOKE_AGENT,
} from '@opentelemetry/semantic-conventions/incubating';
import { redactSecrets } from './secret-redaction.js';

export type { Attributes, AttributeValue };

export const GENAI_OPERATION = {
  invokeAgent: GEN_AI_OPERATION_NAME_VALUE_INVOKE_AGENT,
  chat: GEN_AI_OPERATION_NAME_VALUE_CHAT,
  executeTool: GEN_AI_OPERATION_NAME_VALUE_EXECUTE_TOOL,
} as const;

export const GENAI_ATTR = {
  operationName: ATTR_GEN_AI_OPERATION_NAME,
  providerName: ATTR_GEN_AI_PROVIDER_NAME,
  requestModel: ATTR_GEN_AI_REQUEST_MODEL,
  responseModel: ATTR_GEN_AI_RESPONSE_MODEL,
  responseFinishReasons: ATTR_GEN_AI_RESPONSE_FINISH_REASONS,
  agentId: ATTR_GEN_AI_AGENT_ID,
  agentName: ATTR_GEN_AI_AGENT_NAME,
  usageInputTokens: ATTR_GEN_AI_USAGE_INPUT_TOKENS,
  usageOutputTokens: ATTR_GEN_AI_USAGE_OUTPUT_TOKENS,
  usageCacheReadInputTokens: ATTR_GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS,
  usageCacheCreationInputTokens: ATTR_GEN_AI_USAGE_CACHE_CREATION_INPUT_TOKENS,
  toolName: ATTR_GEN_AI_TOOL_NAME,
  toolCallId: ATTR_GEN_AI_TOOL_CALL_ID,
  toolCallArguments: ATTR_GEN_AI_TOOL_CALL_ARGUMENTS,
  toolCallResult: ATTR_GEN_AI_TOOL_CALL_RESULT,
} as const;

export const CAIRN_ATTR = {
  buildId: 'cairn.build_id',
  todoId: 'cairn.todo_id',
  machineId: 'cairn.machine_id',
  machineName: 'cairn.machine_name',
  runtime: 'cairn.runtime',
  errorMessage: 'cairn.error_message',
  baseSha: 'cairn.base_sha',
  harnessHash: 'cairn.harness_hash',
  persona: 'cairn.persona',
  sourceRef: 'cairn.source_ref',
  ciFixRounds: 'cairn.ci_fix_rounds',
  costUsd: 'cairn.cost_usd',
  outcomeMerged: 'cairn.outcome.merged',
  outcomeRevertedWithin7d: 'cairn.outcome.reverted_within_7d',
  outcomeFixedByLaterPr: 'cairn.outcome.fixed_by_later_pr',
  attributionWhere: 'cairn.attribution.where',
  attributionWhy: 'cairn.attribution.why',
  stepId: 'cairn.step_id',
  stepKind: 'cairn.step_kind',
  checkpointCommit: 'cairn.checkpoint_commit',
  rawStopReason: 'cairn.raw_stop_reason',
  threadId: 'cairn.thread_id',
  chiefTrigger: 'cairn.chief_trigger',
  routeHarness: 'cairn.route.harness',
  routeProvider: 'cairn.route.provider',
  routeModel: 'cairn.route.model',
  routeDifficulty: 'cairn.route.difficulty',
  routeReason: 'cairn.route.reason',
  routeRejected: 'cairn.route.rejected',
} as const;

export function otelErrorMessage(reason: string | null | undefined): string | undefined {
  if (reason == null) return undefined;
  const redacted = String(redactSecrets(reason).value)
    .replaceAll('[REDACTED]', '<redacted>')
    .replace(
      /(?:Bearer\s+[^\s"'<>,;]+|(?:token|key)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s&"'<>,;]+)|(?:sk-|oat01|gh[pousr]_|github_pat_)[A-Za-z0-9_-]+)/gi,
      '<redacted>',
    )
    .replace(
      /(\b[a-z][a-z0-9+.-]*:\/\/(?:[^\s/@]+@)?)(?:\d{1,3}\.){3}\d{1,3}(?=[:/\s?#"'<>),;\]]|$)/gi,
      '$1<ip>',
    )
    .replace(/\s+/g, ' ')
    .trim();
  return redacted === '' ? undefined : redacted.slice(0, 500);
}

export const LANGFUSE_ATTR = {
  input: LangfuseOtelSpanAttributes.OBSERVATION_INPUT,
  output: LangfuseOtelSpanAttributes.OBSERVATION_OUTPUT,
  traceName: LangfuseOtelSpanAttributes.TRACE_NAME,
  traceTags: LangfuseOtelSpanAttributes.TRACE_TAGS,
  sessionId: LangfuseOtelSpanAttributes.TRACE_SESSION_ID,
  environment: LangfuseOtelSpanAttributes.ENVIRONMENT,
  costDetails: LangfuseOtelSpanAttributes.OBSERVATION_COST_DETAILS,
  completionStartTime: LangfuseOtelSpanAttributes.OBSERVATION_COMPLETION_START_TIME,
  deploymentEnvironment: 'deployment.environment',
} as const;

const OTEL_ENVIRONMENT_PATTERN = /^[a-z0-9][a-z0-9_-]{0,39}$/;

export function otelEnvironment(env: { CAIRN_OTEL_ENVIRONMENT?: string }): string | null {
  const value = env.CAIRN_OTEL_ENVIRONMENT?.trim().toLowerCase();
  if (value === undefined || !OTEL_ENVIRONMENT_PATTERN.test(value)) return null;
  return value.startsWith('langfuse') ? null : value;
}

export function otelResourceAttributes(environment: string | null | undefined): Attributes {
  return compact({
    'service.name': 'cairn',
    [LANGFUSE_ATTR.deploymentEnvironment]: environment,
  });
}

export function langfuseEnvironmentAttributes(environment: string | null | undefined): Attributes {
  return compact({
    [LANGFUSE_ATTR.environment]: environment,
    [LANGFUSE_ATTR.deploymentEnvironment]: environment,
  });
}

export function langfuseTraceAttributes(trace: {
  name: string;
  sessionId: string | null;
  tags: readonly string[];
  environment: string | null | undefined;
}): Attributes {
  return compact({
    [LANGFUSE_ATTR.traceName]: trace.name,
    [LANGFUSE_ATTR.traceTags]: trace.tags,
    [LANGFUSE_ATTR.sessionId]: trace.sessionId,
    ...langfuseEnvironmentAttributes(trace.environment),
  });
}

export function coordinatorTurnAttributes(turn: {
  stepId: string;
  threadId: string;
  trigger: string;
}): Attributes {
  return compact({
    [GENAI_ATTR.operationName]: GENAI_OPERATION.invokeAgent,
    [GENAI_ATTR.agentName]: 'coordinator',
    [CAIRN_ATTR.stepId]: turn.stepId,
    [CAIRN_ATTR.stepKind]: 'chief',
    [CAIRN_ATTR.threadId]: turn.threadId,
    [CAIRN_ATTR.chiefTrigger]: turn.trigger,
  });
}

export interface TokenCounts {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
}

export interface ProviderModelRef {
  provider?: string;
  model?: string;
}

function compact(entries: Record<string, AttributeValue | null | undefined>): Attributes {
  return Object.fromEntries(
    Object.entries(entries).filter((entry): entry is [string, AttributeValue] => entry[1] != null),
  );
}

export function splitModelId(qualified: string): ProviderModelRef {
  const slash = qualified.indexOf('/');
  return slash < 0
    ? { model: qualified }
    : { provider: qualified.slice(0, slash), model: qualified.slice(slash + 1) };
}

export function invokeAgentAttributes(build: {
  buildId: string;
  baseSha: string;
  harnessHash: string;
  persona: string | null;
  agentId: string;
  provider?: string;
  model?: string;
  ciFixRounds: number;
  sourceRef: string | null;
  outcome: {
    merged: boolean | null;
    revertedWithin7d: boolean | null;
    fixedByLaterPr: boolean | null;
    costTotal: number | null;
  } | null;
  attribution: { where: string; why: string } | null;
}): Attributes {
  return compact({
    [GENAI_ATTR.operationName]: GENAI_OPERATION.invokeAgent,
    [GENAI_ATTR.providerName]: build.provider,
    [GENAI_ATTR.requestModel]: build.model,
    [GENAI_ATTR.agentId]: build.agentId,
    [GENAI_ATTR.agentName]: build.persona,
    [CAIRN_ATTR.buildId]: build.buildId,
    [CAIRN_ATTR.baseSha]: build.baseSha,
    [CAIRN_ATTR.harnessHash]: build.harnessHash,
    [CAIRN_ATTR.persona]: build.persona,
    [CAIRN_ATTR.sourceRef]: build.sourceRef,
    [CAIRN_ATTR.ciFixRounds]: build.ciFixRounds,
    [CAIRN_ATTR.outcomeMerged]: build.outcome?.merged,
    [CAIRN_ATTR.outcomeRevertedWithin7d]: build.outcome?.revertedWithin7d,
    [CAIRN_ATTR.outcomeFixedByLaterPr]: build.outcome?.fixedByLaterPr,
    [CAIRN_ATTR.costUsd]: build.outcome?.costTotal,
    [CAIRN_ATTR.attributionWhere]: build.attribution?.where,
    [CAIRN_ATTR.attributionWhy]: build.attribution?.why,
  });
}

export function runtimeBuildAttributes(build: {
  buildId: string;
  todoId?: string;
  errorMessage?: string;
  baseSha: string | null;
  harnessHash: string | null;
  agentName?: string;
}): Attributes {
  return compact({
    [GENAI_ATTR.operationName]: GENAI_OPERATION.invokeAgent,
    [GENAI_ATTR.agentName]: build.agentName,
    [CAIRN_ATTR.todoId]: build.todoId,
    [CAIRN_ATTR.errorMessage]: build.errorMessage,
    [CAIRN_ATTR.buildId]: build.buildId,
    [CAIRN_ATTR.baseSha]: build.baseSha,
    [CAIRN_ATTR.harnessHash]: build.harnessHash,
  });
}

export function stepAttributes(step: {
  buildId?: string;
  todoId?: string;
  machineId?: string | null;
  machineName?: string;
  runtime?: string;
  provider?: string;
  model?: string;
  errorMessage?: string;
  stepId: string;
  kind: string;
  checkpointCommit: string | null;
  route?: {
    harness: string | null;
    provider: string | null;
    modelId: string | null;
    difficulty: string;
    reason: string;
    rejected: readonly unknown[];
  } | null;
}): Attributes {
  return compact({
    [CAIRN_ATTR.buildId]: step.buildId,
    [CAIRN_ATTR.todoId]: step.todoId,
    [CAIRN_ATTR.machineId]: step.machineId,
    [CAIRN_ATTR.machineName]: step.machineName,
    [CAIRN_ATTR.runtime]: step.runtime,
    [GENAI_ATTR.providerName]: step.provider,
    [GENAI_ATTR.requestModel]: step.model,
    [CAIRN_ATTR.errorMessage]: step.errorMessage,
    [CAIRN_ATTR.stepId]: step.stepId,
    [CAIRN_ATTR.stepKind]: step.kind,
    [CAIRN_ATTR.checkpointCommit]: step.checkpointCommit,
    [CAIRN_ATTR.routeHarness]: step.route?.harness,
    [CAIRN_ATTR.routeProvider]: step.route?.provider,
    [CAIRN_ATTR.routeModel]: step.route?.modelId,
    [CAIRN_ATTR.routeDifficulty]: step.route?.difficulty,
    [CAIRN_ATTR.routeReason]: step.route?.reason,
    [CAIRN_ATTR.routeRejected]:
      step.route === undefined || step.route === null
        ? undefined
        : JSON.stringify(step.route.rejected),
  });
}

export function chatAttributes(
  turn: {
    provider?: string;
    model?: string;
    responseModel?: string;
    finishReason?: string;
    rawFinishReason?: string;
    usage?: TokenCounts;
    costUsd?: number;
  },
  fallback: ProviderModelRef,
): Attributes {
  const { usage } = turn;
  const hasInput =
    usage?.input !== undefined || usage?.cacheRead !== undefined || usage?.cacheWrite !== undefined;
  return compact({
    [GENAI_ATTR.operationName]: GENAI_OPERATION.chat,
    [GENAI_ATTR.providerName]: turn.provider ?? fallback.provider,
    [GENAI_ATTR.requestModel]: turn.model ?? fallback.model,
    [GENAI_ATTR.responseModel]: turn.responseModel,
    [GENAI_ATTR.responseFinishReasons]:
      turn.finishReason === undefined ? null : [turn.finishReason],
    [GENAI_ATTR.usageInputTokens]: hasInput
      ? (usage?.input ?? 0) + (usage?.cacheRead ?? 0) + (usage?.cacheWrite ?? 0)
      : null,
    [GENAI_ATTR.usageOutputTokens]: usage?.output,
    [GENAI_ATTR.usageCacheReadInputTokens]: usage?.cacheRead,
    [GENAI_ATTR.usageCacheCreationInputTokens]: usage?.cacheWrite,
    [CAIRN_ATTR.rawStopReason]: turn.rawFinishReason,
    [LANGFUSE_ATTR.costDetails]:
      turn.costUsd === undefined || turn.costUsd <= 0
        ? null
        : JSON.stringify({ total: turn.costUsd }),
  });
}

export function executeToolAttributes(call: {
  name: string;
  callId?: string;
  arguments?: string;
  result?: string;
}): Attributes {
  return compact({
    [GENAI_ATTR.operationName]: GENAI_OPERATION.executeTool,
    [GENAI_ATTR.toolName]: call.name,
    [GENAI_ATTR.toolCallId]: call.callId,
    [GENAI_ATTR.toolCallArguments]: call.arguments,
    [GENAI_ATTR.toolCallResult]: call.result,
  });
}

export interface OtelObservation {
  input?: unknown;
  output?: unknown;
}

export function observationAttributes(observation: OtelObservation): Attributes {
  const entries: Attributes = {};
  for (const [field, key] of [
    ['input', LANGFUSE_ATTR.input],
    ['output', LANGFUSE_ATTR.output],
  ] as const) {
    const value = observation[field];
    if (value === undefined) continue;
    const redacted = redactSecrets(value).value;
    const text = typeof redacted === 'string' ? redacted : JSON.stringify(redacted);
    if (text === undefined) continue;
    if (Buffer.byteLength(text, 'utf8') <= 32_768) {
      entries[key] = text;
    } else if (Array.isArray(redacted)) {
      entries[key] = JSON.stringify(
        redacted.slice(-16).map((entry: unknown) => {
          if (typeof entry !== 'object' || entry === null)
            return `${JSON.stringify(entry)?.slice(0, 256)} [truncated]`;
          const message = entry as Record<string, unknown>;
          return {
            role: String(message.role ?? 'user').slice(0, 32),
            content: `${(typeof message.content === 'string' ? message.content : (JSON.stringify(message.content) ?? '')).slice(0, 256)} [truncated]`,
          };
        }),
      );
    } else {
      entries[key] = JSON.stringify(`${text.slice(0, 4_000)} [truncated]`);
    }
  }
  return entries;
}
