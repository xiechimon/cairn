import type { TrajectoryPack } from '@cairn/shared';
import {
  chatAttributes,
  executeToolAttributes,
  GENAI_OPERATION,
  invokeAgentAttributes,
  type ProviderModelRef,
  splitModelId,
  stepAttributes,
} from '@cairn/shared';
import {
  type CairnSpan,
  otlpChildSpanIdOfBuild,
  otlpRootSpanIdOfBuild,
  otlpStepSpanIdOfBuild,
  otlpTraceIdOfBuild,
} from '@cairn/shared/otel';
import {
  costUsd,
  isRecord,
  num,
  str,
  tokenCounts,
  toolCallsOf,
  toolOutcomesOf,
} from './trajectory-transcript.js';

function jsonText(value: unknown): string {
  return typeof value === 'string' ? value : (JSON.stringify(value) ?? '');
}

export const TRAJECTORY_PUSH_SCOPE = 'cairn.trajectory-push';

export function packToSpans(pack: TrajectoryPack): CairnSpan[] {
  const { buildId } = pack;
  const traceId = otlpTraceIdOfBuild(buildId);
  const fallbackModel: ProviderModelRef = splitModelId(pack.input.model);
  const spans: CairnSpan[] = [];
  let clock = 0;
  let earliest: number | undefined;
  let latest = 0;

  const advance = (at: number | undefined) => {
    if (at !== undefined) clock = at;
    earliest = earliest === undefined ? clock : Math.min(earliest, clock);
    latest = Math.max(latest, clock);
    return clock;
  };

  const rootId = otlpRootSpanIdOfBuild(buildId);
  for (const step of pack.process.steps) {
    const stepSpanId = otlpStepSpanIdOfBuild(buildId, step.stepId);
    const parent = { traceId, spanId: stepSpanId };
    const rows = step.transcript.filter(isRecord);
    const outcomes = toolOutcomesOf(rows);
    const children: CairnSpan[] = [];
    let stepStart: number | undefined;
    rows.forEach((row, rowIndex) => {
      const at = advance(num(row.timestamp));
      stepStart ??= at;
      if (row.role !== 'assistant') return;
      const finishReason = str(row.stopReason) ?? str(row.stop_reason);
      const failedTurn = finishReason === 'error';
      const model = str(row.model);
      children.push({
        spanId: otlpChildSpanIdOfBuild(buildId, step.stepId, 'chat', rowIndex),
        parent,
        name: `${GENAI_OPERATION.chat} ${model ?? fallbackModel.model ?? ''}`.trim(),
        kind: 'client',
        startMs: at,
        endMs: at,
        attributes: chatAttributes(
          {
            provider: str(row.provider),
            model,
            responseModel: str(row.responseModel),
            finishReason,
            rawFinishReason: str(row.rawStopReason),
            usage: tokenCounts(row.usage),
            costUsd: costUsd(row.usage),
          },
          fallbackModel,
        ),
        ...(failedTurn ? { error: str(row.errorMessage) ?? 'error' } : {}),
      });
      toolCallsOf(row.content).forEach((call, callIndex) => {
        const outcome = call.id === undefined ? undefined : outcomes.get(call.id);
        const end = Math.max(at, outcome?.at ?? at);
        advance(end);
        children.push({
          spanId: otlpChildSpanIdOfBuild(buildId, step.stepId, 'tool', rowIndex, callIndex),
          parent,
          name: `${GENAI_OPERATION.executeTool} ${call.name}`,
          kind: 'internal',
          startMs: at,
          endMs: end,
          attributes: executeToolAttributes({
            name: call.name,
            callId: call.id,
            arguments: call.arguments === undefined ? undefined : jsonText(call.arguments),
            result: outcome === undefined ? undefined : jsonText(outcome.result),
          }),
          ...(outcome?.failed ? { error: 'tool error' } : {}),
        });
      });
    });
    const start = stepStart ?? advance(undefined);
    const stepSpan: CairnSpan = {
      spanId: stepSpanId,
      parent: { traceId, spanId: rootId },
      name: `step ${step.kind}`,
      kind: 'internal',
      startMs: start,
      endMs: Math.max(start, clock),
      attributes: stepAttributes(step),
    };
    spans.push(stepSpan, ...children);
  }

  const rootStart = earliest ?? 0;
  const root: CairnSpan = {
    traceId,
    spanId: rootId,
    name: GENAI_OPERATION.invokeAgent,
    kind: 'internal',
    startMs: rootStart,
    endMs: Math.max(rootStart, latest),
    attributes: invokeAgentAttributes({
      buildId,
      baseSha: pack.input.baseSha,
      harnessHash: pack.input.harnessHash,
      persona: pack.input.persona,
      agentId: pack.input.agentId,
      provider: fallbackModel.provider,
      model: fallbackModel.model,
      ciFixRounds: pack.judgments.ciFixRounds,
      sourceRef: pack.input.sourceRef,
      outcome: pack.outcome,
      attribution: pack.attribution,
    }),
  };

  return [root, ...spans];
}
