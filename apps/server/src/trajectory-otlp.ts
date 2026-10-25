import { createHash } from 'node:crypto';
import type { TrajectoryPack } from '@cairn/shared';
import {
  chatAttributes,
  executeToolAttributes,
  GENAI_OPERATION,
  invokeAgentAttributes,
  OTLP_SPAN_KIND,
  OTLP_STATUS_ERROR,
  type OtlpSpan,
  type OtlpTracesRequest,
  otlpAttributes,
  otlpNanos,
  otlpTraceIdOfBuild,
  type ProviderModelRef,
  splitModelId,
  stepAttributes,
} from '@cairn/shared';
import {
  costUsd,
  isRecord,
  num,
  str,
  tokenCounts,
  toolCallsOf,
  toolOutcomesOf,
} from './trajectory-transcript.js';

const SPAN_KIND_INTERNAL = OTLP_SPAN_KIND.internal;
const SPAN_KIND_CLIENT = OTLP_SPAN_KIND.client;
const STATUS_ERROR = OTLP_STATUS_ERROR;

const nanos = otlpNanos;

function derivedId(bytes: number, ...parts: (string | number)[]): string {
  return createHash('sha256')
    .update(JSON.stringify(parts))
    .digest('hex')
    .slice(0, bytes * 2);
}

const spanIdOf = (buildId: string, ...path: (string | number)[]) =>
  derivedId(8, 'span', buildId, ...path);

function jsonText(value: unknown): string {
  return typeof value === 'string' ? value : (JSON.stringify(value) ?? '');
}

export function packToOtlp(pack: TrajectoryPack): OtlpTracesRequest {
  const { buildId } = pack;
  const traceId = otlpTraceIdOfBuild(buildId);
  const fallbackModel: ProviderModelRef = splitModelId(pack.input.model);
  const spans: OtlpSpan[] = [];
  let clock = 0;
  let earliest: number | undefined;
  let latest = 0;

  const advance = (at: number | undefined) => {
    if (at !== undefined) clock = at;
    earliest = earliest === undefined ? clock : Math.min(earliest, clock);
    latest = Math.max(latest, clock);
    return clock;
  };

  const rootId = spanIdOf(buildId, 'root');
  for (const step of pack.process.steps) {
    const stepSpanId = spanIdOf(buildId, 'step', step.stepId);
    const rows = step.transcript.filter(isRecord);
    const outcomes = toolOutcomesOf(rows);
    const children: OtlpSpan[] = [];
    let stepStart: number | undefined;
    rows.forEach((row, rowIndex) => {
      const at = advance(num(row.timestamp));
      stepStart ??= at;
      if (row.role !== 'assistant') return;
      const finishReason = str(row.stopReason) ?? str(row.stop_reason);
      const failedTurn = finishReason === 'error';
      const model = str(row.model);
      children.push({
        traceId,
        spanId: spanIdOf(buildId, 'step', step.stepId, 'chat', rowIndex),
        parentSpanId: stepSpanId,
        name: `${GENAI_OPERATION.chat} ${model ?? fallbackModel.model ?? ''}`.trim(),
        kind: SPAN_KIND_CLIENT,
        startTimeUnixNano: nanos(at),
        endTimeUnixNano: nanos(at),
        attributes: otlpAttributes(
          chatAttributes(
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
        ),
        ...(failedTurn
          ? { status: { code: STATUS_ERROR, message: str(row.errorMessage) ?? 'error' } }
          : {}),
      });
      toolCallsOf(row.content).forEach((call, callIndex) => {
        const outcome = call.id === undefined ? undefined : outcomes.get(call.id);
        const end = Math.max(at, outcome?.at ?? at);
        advance(end);
        children.push({
          traceId,
          spanId: spanIdOf(buildId, 'step', step.stepId, 'tool', rowIndex, callIndex),
          parentSpanId: stepSpanId,
          name: `${GENAI_OPERATION.executeTool} ${call.name}`,
          kind: SPAN_KIND_INTERNAL,
          startTimeUnixNano: nanos(at),
          endTimeUnixNano: nanos(end),
          attributes: otlpAttributes(
            executeToolAttributes({
              name: call.name,
              callId: call.id,
              arguments: call.arguments === undefined ? undefined : jsonText(call.arguments),
              result: outcome === undefined ? undefined : jsonText(outcome.result),
            }),
          ),
          ...(outcome?.failed ? { status: { code: STATUS_ERROR, message: 'tool error' } } : {}),
        });
      });
    });
    const start = stepStart ?? advance(undefined);
    const stepSpan: OtlpSpan = {
      traceId,
      spanId: stepSpanId,
      parentSpanId: rootId,
      name: `step ${step.kind}`,
      kind: SPAN_KIND_INTERNAL,
      startTimeUnixNano: nanos(start),
      endTimeUnixNano: nanos(Math.max(start, clock)),
      attributes: otlpAttributes(stepAttributes(step)),
    };
    spans.push(stepSpan, ...children);
  }

  const rootStart = earliest ?? 0;
  const root: OtlpSpan = {
    traceId,
    spanId: rootId,
    name: GENAI_OPERATION.invokeAgent,
    kind: SPAN_KIND_INTERNAL,
    startTimeUnixNano: nanos(rootStart),
    endTimeUnixNano: nanos(Math.max(rootStart, latest)),
    attributes: otlpAttributes(
      invokeAgentAttributes({
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
    ),
  };

  return {
    resourceSpans: [
      {
        resource: { attributes: otlpAttributes({ 'service.name': 'cairn' }) },
        scopeSpans: [{ scope: { name: 'cairn.trajectory-push' }, spans: [root, ...spans] }],
      },
    ],
  };
}
