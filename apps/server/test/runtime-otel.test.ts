import {
  otlpRootSpanIdOfBuild,
  otlpStepSpanIdOfBuild,
  otlpTraceIdOfBuild,
} from '@cairn/shared/otel';
import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  build as buildTable,
  project as projectTable,
  step as stepTable,
  todo as todoTable,
} from '../src/db/schema.js';
import { emitRuntimeBuildSpan, emitRuntimeStepSpan } from '../src/runtime-otel.js';
import { bootServer, type TestServer } from './helpers.js';

interface CapturedOtlp {
  url: string;
  authorization: string | undefined;
  body: {
    resourceSpans: {
      resource: { attributes: { key: string; value: unknown }[] };
      scopeSpans: {
        scope: { name: string };
        spans: {
          traceId: string;
          spanId: string;
          parentSpanId?: string;
          name: string;
          status?: { code: number };
          attributes: { key: string; value: unknown }[];
        }[];
      }[];
    }[];
  };
}

function captureFetch() {
  const captured: CapturedOtlp[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      captured.push({
        url: String(url),
        authorization: (init.headers as Record<string, string>).authorization,
        body: JSON.parse(String(init.body)),
      });
      return new Response('{}', { status: 200 });
    }),
  );
  return captured;
}

const disposables: (() => void)[] = [];
afterEach(() => {
  for (const d of disposables.splice(0)) d();
  vi.unstubAllGlobals();
});

interface World {
  s: TestServer;
  buildId: string;
  stepId: string;
}

function makeWorld(stepRow: {
  status: string;
  claimedAt: number | null;
  finishedAt: number | null;
}): World {
  const s = bootServer();
  disposables.push(() => s.dispose());
  const suffix = Math.random().toString(36).slice(2);
  const todoId = `todo-${suffix}`;
  const buildId = `build-${suffix}`;
  const stepId = `step-${suffix}`;
  s.db
    .insert(projectTable)
    .values({ id: `proj-${suffix}`, name: 'probe', teamId: s.team.id })
    .run();
  s.db
    .insert(todoTable)
    .values({
      id: todoId,
      teamId: s.team.id,
      projectId: `proj-${suffix}`,
      seqNum: 1,
      title: 'runtime otel probe',
      phase: 'building',
      phaseAt: 1_700_000_000_000,
    })
    .run();
  s.db
    .insert(buildTable)
    .values({
      id: buildId,
      todoId,
      withPlan: false,
      triggerSource: 'user',
      baseSha: 'sha-base',
      harnessHash: 'hash-harness',
      createdAt: 1_700_000_000_000,
    })
    .run();
  s.db
    .insert(stepTable)
    .values({
      id: stepId,
      buildId,
      kind: 'build',
      status: stepRow.status as 'done',
      claimedAt: stepRow.claimedAt,
      finishedAt: stepRow.finishedAt,
      checkpointCommit: 'sha-checkpoint',
      createdAt: 1_700_000_000_000,
    })
    .run();
  return { s, buildId, stepId };
}

const env = {
  CAIRN_OTEL_ENDPOINT: 'http://pk:sk@127.0.0.1:3000/api/public/otel',
  CAIRN_OTEL_HEADERS: 'x-langfuse-ingestion-version=4',
};

describe('emitRuntimeStepSpan', () => {
  test('does nothing when no endpoint is configured', () => {
    const { s, stepId } = makeWorld({ status: 'done', claimedAt: 1000, finishedAt: 2000 });
    const captured = captureFetch();
    emitRuntimeStepSpan(s.db, stepId, {});
    expect(captured).toEqual([]);
  });

  test('does nothing on malformed config and never throws', () => {
    const { s, stepId } = makeWorld({ status: 'done', claimedAt: 1000, finishedAt: 2000 });
    const captured = captureFetch();
    expect(() => emitRuntimeStepSpan(s.db, stepId, { CAIRN_OTEL_ENDPOINT: '::bad' })).not.toThrow();
    expect(captured).toEqual([]);
  });

  test('pushes a step span on the derived trace, parented to the derived root span', () => {
    const { s, buildId, stepId } = makeWorld({ status: 'done', claimedAt: 1000, finishedAt: 2000 });
    const captured = captureFetch();
    emitRuntimeStepSpan(s.db, stepId, env);
    expect(captured).toHaveLength(1);
    const sent = captured[0]!;
    expect(sent.url).toBe('http://127.0.0.1:3000/api/public/otel/v1/traces');
    expect(sent.authorization).toBe(`Basic ${Buffer.from('pk:sk').toString('base64')}`);
    const scope = sent.body.resourceSpans[0]?.scopeSpans[0];
    expect(sent.body.resourceSpans[0]?.resource.attributes).toEqual([
      { key: 'service.name', value: { stringValue: 'cairn' } },
    ]);
    expect(scope?.scope.name).toBe('cairn.server');
    expect(scope?.spans).toHaveLength(1);
    const span = scope?.spans[0];
    if (span === undefined) throw new Error('no span pushed');
    expect(span.traceId).toBe(otlpTraceIdOfBuild(buildId));
    expect(span.spanId).toBe(otlpStepSpanIdOfBuild(buildId, stepId));
    expect(span.parentSpanId).toBe(otlpRootSpanIdOfBuild(buildId));
    expect(span.name).toBe('step build');
    expect(span.status).toBeUndefined();
    const attrs = Object.fromEntries(span.attributes.map((a) => [a.key, a.value]));
    expect(attrs['cairn.step_id']).toEqual({ stringValue: stepId });
    expect(attrs['cairn.step_kind']).toEqual({ stringValue: 'build' });
    expect(attrs['cairn.checkpoint_commit']).toEqual({ stringValue: 'sha-checkpoint' });
  });

  test('marks failed steps as error and re-reads finishedAt after the terminal update', () => {
    const { s, buildId, stepId } = makeWorld({
      status: 'failed',
      claimedAt: 1000,
      finishedAt: 2000,
    });
    const captured = captureFetch();
    emitRuntimeStepSpan(s.db, stepId, env);
    const span = captured[0]!.body.resourceSpans[0]!.scopeSpans[0]!.spans[0]!;
    expect(span.status).toEqual({ code: 2, message: 'failed' });
    expect(span.traceId).toBe(otlpTraceIdOfBuild(buildId));
  });

  test('skips steps that were never claimed', () => {
    const { s, stepId } = makeWorld({ status: 'pending', claimedAt: null, finishedAt: null });
    const captured = captureFetch();
    emitRuntimeStepSpan(s.db, stepId, env);
    expect(captured).toEqual([]);
  });
});

describe('emitRuntimeBuildSpan', () => {
  test('pushes the invoke_agent root span covering the build lifetime', () => {
    const { s, buildId } = makeWorld({ status: 'done', claimedAt: 1000, finishedAt: 2000 });
    const captured = captureFetch();
    emitRuntimeBuildSpan(s.db, buildId, 'done', env);
    expect(captured).toHaveLength(1);
    const span = captured[0]!.body.resourceSpans[0]!.scopeSpans[0]!.spans[0]!;
    expect(span.traceId).toBe(otlpTraceIdOfBuild(buildId));
    expect(span.spanId).toBe(otlpRootSpanIdOfBuild(buildId));
    expect(span.name).toBe('invoke_agent');
    expect(span.parentSpanId).toBeUndefined();
    const attrs = Object.fromEntries(span.attributes.map((a) => [a.key, a.value]));
    expect(attrs['gen_ai.operation.name']).toEqual({ stringValue: 'invoke_agent' });
    expect(attrs['cairn.build_id']).toEqual({ stringValue: buildId });
    expect(attrs['cairn.base_sha']).toEqual({ stringValue: 'sha-base' });
    expect(attrs['cairn.harness_hash']).toEqual({ stringValue: 'hash-harness' });
  });

  test('marks failed and cancelled builds as error', () => {
    const { s, buildId } = makeWorld({ status: 'failed', claimedAt: 1000, finishedAt: 2000 });
    const captured = captureFetch();
    emitRuntimeBuildSpan(s.db, buildId, 'failed', env);
    emitRuntimeBuildSpan(s.db, buildId, 'cancelled', env);
    expect(captured).toHaveLength(2);
    expect(captured[0]!.body.resourceSpans[0]!.scopeSpans[0]!.spans[0]!.status).toEqual({
      code: 2,
      message: 'failed',
    });
    expect(captured[1]!.body.resourceSpans[0]!.scopeSpans[0]!.spans[0]!.status).toEqual({
      code: 2,
      message: 'cancelled',
    });
  });

  test('does nothing when no endpoint is configured', () => {
    const { s, buildId } = makeWorld({ status: 'done', claimedAt: 1000, finishedAt: 2000 });
    const captured = captureFetch();
    emitRuntimeBuildSpan(s.db, buildId, 'done', {});
    expect(captured).toEqual([]);
  });
});
