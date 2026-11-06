import { redactSecrets } from './secret-redaction.js';

export type AttributeValue = string | number | boolean | readonly string[] | { double: number };
export type Attributes = Record<string, AttributeValue>;

export const GENAI_OPERATION = {
  invokeAgent: 'invoke_agent',
  chat: 'chat',
  executeTool: 'execute_tool',
} as const;

export const GENAI_ATTR = {
  operationName: 'gen_ai.operation.name',
  providerName: 'gen_ai.provider.name',
  requestModel: 'gen_ai.request.model',
  responseModel: 'gen_ai.response.model',
  responseFinishReasons: 'gen_ai.response.finish_reasons',
  agentId: 'gen_ai.agent.id',
  agentName: 'gen_ai.agent.name',
  usageInputTokens: 'gen_ai.usage.input_tokens',
  usageOutputTokens: 'gen_ai.usage.output_tokens',
  usageCacheReadInputTokens: 'gen_ai.usage.cache_read.input_tokens',
  usageCacheCreationInputTokens: 'gen_ai.usage.cache_creation.input_tokens',
  toolName: 'gen_ai.tool.name',
  toolCallId: 'gen_ai.tool.call.id',
  toolCallArguments: 'gen_ai.tool.call.arguments',
  toolCallResult: 'gen_ai.tool.call.result',
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
  traceName: 'langfuse.trace.name',
  traceTags: 'langfuse.trace.tags',
  sessionId: 'langfuse.session.id',
  genericSessionId: 'session.id',
  environment: 'langfuse.environment',
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
    [LANGFUSE_ATTR.genericSessionId]: trace.sessionId,
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
    [CAIRN_ATTR.costUsd]:
      build.outcome?.costTotal == null ? null : { double: build.outcome.costTotal },
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
    [CAIRN_ATTR.costUsd]: turn.costUsd === undefined ? null : { double: turn.costUsd },
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
