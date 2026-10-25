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
} as const;

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
  baseSha: string | null;
  harnessHash: string | null;
  agentName?: string;
}): Attributes {
  return compact({
    [GENAI_ATTR.operationName]: GENAI_OPERATION.invokeAgent,
    [GENAI_ATTR.agentName]: build.agentName,
    [CAIRN_ATTR.buildId]: build.buildId,
    [CAIRN_ATTR.baseSha]: build.baseSha,
    [CAIRN_ATTR.harnessHash]: build.harnessHash,
  });
}

export function stepAttributes(step: {
  stepId: string;
  kind: string;
  checkpointCommit: string | null;
}): Attributes {
  return compact({
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
