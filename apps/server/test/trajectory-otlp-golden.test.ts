import { trajectoryPackSchema } from '@cairn/shared';
import {
  otlpChildSpanIdOfBuild,
  otlpRootSpanIdOfBuild,
  otlpStepSpanIdOfBuild,
  otlpTraceIdOfBuild,
} from '@cairn/shared/otel';
import { expect, test } from 'vitest';
import { packToSpans } from '../src/trajectory-otlp.js';

const pack = trajectoryPackSchema.parse({
  buildId: 'build-golden',
  input: {
    spec: 'Golden',
    sourceRef: 'issue-7',
    baseSha: 'base-sha',
    persona: 'implementer',
    agentId: 'agent-1',
    model: 'relay/glm-5.3',
    skillInjection: null,
    blockerHandoff: null,
    harnessHash: 'harness-hash',
  },
  process: {
    steps: [
      {
        stepId: 'step-a',
        kind: 'build',
        checkpointCommit: 'head-sha',
        transcript: [
          {
            role: 'assistant',
            content: [{ type: 'toolCall', id: 'call-1', name: 'bash', arguments: { c: 'ls' } }],
            provider: 'relay',
            model: 'glm-5.3',
            stopReason: 'toolUse',
            usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, cost: { total: 1 } },
            timestamp: 1_000,
          },
          {
            role: 'system',
            toolCallId: 'call-1',
            toolName: 'bash',
            isError: false,
            content: [{ type: 'text', text: 'a.ts' }],
            timestamp: 1_400,
          },
        ],
      },
    ],
    plans: [],
    token_usage: [],
  },
  judgments: { plan: [], diff: [], gate_verdict: [], ciFixRounds: 3 },
  outcome: { merged: true, revertedWithin7d: null, fixedByLaterPr: false, costTotal: 2 },
  attribution: {
    where: 'prompt',
    why: 'premature_finish',
    evidence: [{ stepId: 'step-a', messageIndex: 0 }],
    labeler: 'ian',
    labeledAt: 1_700_000_000_000,
  },
});

test('the invoke_agent root keeps every outcome and attribution field with the same value', () => {
  const root = packToSpans(pack).find((span) => span.name === 'invoke_agent');
  expect(root?.attributes).toEqual({
    'gen_ai.operation.name': 'invoke_agent',
    'gen_ai.provider.name': 'relay',
    'gen_ai.request.model': 'glm-5.3',
    'gen_ai.agent.id': 'agent-1',
    'gen_ai.agent.name': 'implementer',
    'cairn.build_id': 'build-golden',
    'cairn.base_sha': 'base-sha',
    'cairn.harness_hash': 'harness-hash',
    'cairn.persona': 'implementer',
    'cairn.source_ref': 'issue-7',
    'cairn.ci_fix_rounds': 3,
    'cairn.outcome.merged': true,
    'cairn.outcome.fixed_by_later_pr': false,
    'cairn.cost_usd': 2,
    'cairn.attribution.where': 'prompt',
    'cairn.attribution.why': 'premature_finish',
  });
  expect(root?.attributes).not.toHaveProperty('cairn.outcome.reverted_within_7d');
});

test('every span keeps the id the old exporter derived and joins its parent', () => {
  const traceId = otlpTraceIdOfBuild('build-golden');
  const rootId = otlpRootSpanIdOfBuild('build-golden');
  const stepId = otlpStepSpanIdOfBuild('build-golden', 'step-a');
  expect(rootId).toBe('220d8e970d497c82');
  const ids = packToSpans(pack).map((span) => [
    span.name,
    span.traceId ?? span.parent?.traceId,
    span.spanId,
    span.parent?.spanId,
    span.startMs,
    span.endMs,
  ]);
  expect(ids).toEqual([
    ['invoke_agent', traceId, rootId, undefined, 1_000, 1_400],
    ['step build', traceId, stepId, rootId, 1_000, 1_400],
    [
      'chat glm-5.3',
      traceId,
      otlpChildSpanIdOfBuild('build-golden', 'step-a', 'chat', 0),
      stepId,
      1_000,
      1_000,
    ],
    [
      'execute_tool bash',
      traceId,
      otlpChildSpanIdOfBuild('build-golden', 'step-a', 'tool', 0, 0),
      stepId,
      1_000,
      1_400,
    ],
  ]);
});
