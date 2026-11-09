import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { transcriptPromptRowId } from '@cairn/shared';
import {
  otlpRootSpanIdOfBuild,
  otlpStepSpanIdOfBuild,
  otlpTraceIdOfBuild,
  otlpTraceIdOfTurn,
} from '@cairn/shared/otel';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import {
  build as buildTable,
  chiefMessage,
  chiefThread,
  machine as machineTable,
  message as messageTable,
  project as projectTable,
  schedule,
  step as stepTable,
  todo as todoTable,
} from '../src/db/schema.js';
import {
  emitRuntimeBuildSpan,
  emitRuntimeStepSpan,
  flushRuntimeOtel,
  shutdownRuntimeOtel,
} from '../src/runtime-otel.js';
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
          status?: { code: number; message: string };
          attributes: { key: string; value: unknown }[];
        }[];
      }[];
    }[];
  };
}

const received: CapturedOtlp[] = [];
let server: Server | undefined;
let silent: Server | undefined;

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      received.push({
        url: `http://127.0.0.1${req.url ?? ''}`,
        authorization: req.headers.authorization,
        body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
      });
      res.setHeader('content-type', 'application/json');
      res.end('{}');
    });
  });
  await new Promise<void>((done) => server?.listen(0, '127.0.0.1', done));
  env.CAIRN_OTEL_ENDPOINT = `http://pk:sk@127.0.0.1:${(server.address() as AddressInfo).port}/api/public/otel`;
  silent = createServer(() => {});
  await new Promise<void>((done) => silent?.listen(0, '127.0.0.1', done));
});

afterAll(async () => {
  await shutdownRuntimeOtel();
  server?.close();
  silent?.closeAllConnections();
  silent?.close();
});

function capture(): CapturedOtlp[] {
  received.splice(0);
  return received;
}

const disposables: (() => void)[] = [];
afterEach(() => {
  for (const d of disposables.splice(0)) d();
});

interface World {
  s: TestServer;
  buildId: string;
  stepId: string;
  todoId: string;
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
  return { s, buildId, stepId, todoId };
}

const env = {
  CAIRN_OTEL_ENDPOINT: '',
  CAIRN_OTEL_HEADERS: 'x-langfuse-ingestion-version=4',
};

describe('emitRuntimeStepSpan', () => {
  test('does nothing when no endpoint is configured', async () => {
    const { s, stepId } = makeWorld({ status: 'done', claimedAt: 1000, finishedAt: 2000 });
    const captured = capture();
    emitRuntimeStepSpan(s.db, stepId, {});
    await flushRuntimeOtel();
    expect(captured).toEqual([]);
  });

  test('does nothing on malformed config and never throws', async () => {
    const { s, stepId } = makeWorld({ status: 'done', claimedAt: 1000, finishedAt: 2000 });
    const captured = capture();
    expect(() => emitRuntimeStepSpan(s.db, stepId, { CAIRN_OTEL_ENDPOINT: '::bad' })).not.toThrow();
    expect(captured).toEqual([]);
  });

  test('pushes a step span on the derived trace, parented to the derived root span', async () => {
    const { s, buildId, stepId } = makeWorld({ status: 'done', claimedAt: 1000, finishedAt: 2000 });
    const captured = capture();
    emitRuntimeStepSpan(s.db, stepId, env);
    await flushRuntimeOtel();
    expect(captured).toHaveLength(1);
    const sent = captured[0]!;
    expect(new URL(sent.url).pathname).toBe('/api/public/otel/v1/traces');
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
    expect(span.status?.code ?? 0).toBe(0);
    const attrs = Object.fromEntries(span.attributes.map((a) => [a.key, a.value]));
    expect(attrs['cairn.error_message']).toBeUndefined();
    expect(attrs['cairn.step_id']).toEqual({ stringValue: stepId });
    expect(attrs['cairn.step_kind']).toEqual({ stringValue: 'build' });
    expect(attrs['cairn.checkpoint_commit']).toEqual({ stringValue: 'sha-checkpoint' });
  });

  test.each(['plan', 'build', 'verify', 'review', 'merge', 'session'] as const)(
    'exports the todo session on a %s step before the build root is emitted',
    async (kind) => {
      const { s, stepId, todoId } = makeWorld({
        status: 'done',
        claimedAt: 1000,
        finishedAt: 2000,
      });
      s.db.update(stepTable).set({ kind }).where(eq(stepTable.id, stepId)).run();
      const captured = capture();
      emitRuntimeStepSpan(s.db, stepId, env);
      await flushRuntimeOtel();
      expect(captured).toHaveLength(1);
      const span = captured[0]!.body.resourceSpans[0]!.scopeSpans[0]!.spans[0]!;
      const attrs = Object.fromEntries(span.attributes.map((a) => [a.key, a.value]));
      expect(attrs['langfuse.session.id']).toBeUndefined();
      expect(attrs['session.id']).toEqual({ stringValue: todoId });
      expect(attrs['langfuse.trace.name']).toBeUndefined();
      expect(attrs['langfuse.trace.tags']).toBeUndefined();
    },
  );

  test('does not invent a session when the step has no build row', async () => {
    const { s, stepId } = makeWorld({ status: 'done', claimedAt: 1000, finishedAt: 2000 });
    s.db.update(stepTable).set({ buildId: 'missing-build' }).where(eq(stepTable.id, stepId)).run();
    const captured = capture();
    emitRuntimeStepSpan(s.db, stepId, env);
    await flushRuntimeOtel();
    expect(captured).toHaveLength(1);
    const span = captured[0]!.body.resourceSpans[0]!.scopeSpans[0]!.spans[0]!;
    const attrs = Object.fromEntries(span.attributes.map((a) => [a.key, a.value]));
    expect(attrs['langfuse.session.id']).toBeUndefined();
    expect(attrs['session.id']).toBeUndefined();
  });

  test('marks failed steps as error and re-reads finishedAt after the terminal update', async () => {
    const { s, buildId, stepId } = makeWorld({
      status: 'failed',
      claimedAt: 1000,
      finishedAt: 2000,
    });
    const captured = capture();
    emitRuntimeStepSpan(s.db, stepId, env);
    await flushRuntimeOtel();
    const span = captured[0]!.body.resourceSpans[0]!.scopeSpans[0]!.spans[0]!;
    expect(span.status).toEqual({ code: 2, message: 'failed' });
    expect(span.traceId).toBe(otlpTraceIdOfBuild(buildId));
  });

  test.each([
    [
      'normalizes build failure reasons',
      '  OAuth token revoked\n  please log in  ',
      'OAuth token revoked please log in',
    ],
    ['caps failure reasons', 'x'.repeat(600), 'x'.repeat(500)],
    [
      'redacts failure reasons before export',
      'Bearer abc.def at https://192.0.2.1:443/v1?token=secret',
      '<redacted> at https://<ip>:443/v1?<redacted>',
    ],
    ['ignores blank reasons', ' \n ', undefined],
  ])('%s', async (_name, reason, expected) => {
    const { s, buildId, stepId } = makeWorld({
      status: 'failed',
      claimedAt: 1000,
      finishedAt: 2000,
    });
    s.db.update(buildTable).set({ errorMessage: reason }).where(eq(buildTable.id, buildId)).run();
    const captured = capture();
    emitRuntimeStepSpan(s.db, stepId, env);
    await flushRuntimeOtel();
    const span = captured[0]!.body.resourceSpans[0]!.scopeSpans[0]!.spans[0]!;
    const attrs = Object.fromEntries(span.attributes.map((a) => [a.key, a.value]));
    expect(span.status).toEqual({ code: 2, message: expected ?? 'failed' });
    expect(attrs['cairn.error_message']).toEqual(
      expected === undefined ? undefined : { stringValue: expected },
    );
  });

  test('exports persisted step identity and fallback model without guessing missing models', async () => {
    const { s, buildId, stepId, todoId } = makeWorld({
      status: 'done',
      claimedAt: 1000,
      finishedAt: 2000,
    });
    s.db
      .insert(machineTable)
      .values({ id: 'otel-machine', teamId: s.team.id, name: 'worker' })
      .run();
    s.db.update(stepTable).set({ machineId: 'otel-machine' }).where(eq(stepTable.id, stepId)).run();
    s.db
      .update(buildTable)
      .set({ errorMessage: 'stale failure' })
      .where(eq(buildTable.id, buildId))
      .run();
    const captured = capture();
    emitRuntimeStepSpan(s.db, stepId, env);
    await flushRuntimeOtel();
    let span = captured[0]!.body.resourceSpans[0]!.scopeSpans[0]!.spans[0]!;
    let attrs = Object.fromEntries(span.attributes.map((a) => [a.key, a.value]));
    expect(attrs['cairn.build_id']).toEqual({ stringValue: buildId });
    expect(attrs['cairn.todo_id']).toEqual({ stringValue: todoId });
    expect(attrs['cairn.machine_id']).toEqual({ stringValue: 'otel-machine' });
    expect(attrs['cairn.machine_name']).toEqual({ stringValue: 'worker' });
    expect(attrs['gen_ai.request.model']).toBeUndefined();
    expect(attrs['gen_ai.provider.name']).toBeUndefined();
    expect(attrs['cairn.runtime']).toBeUndefined();
    expect(attrs['cairn.error_message']).toBeUndefined();
    expect(span.status?.code ?? 0).toBe(0);
    s.db
      .update(stepTable)
      .set({
        fallback: {
          model: { provider: 'anthropic', modelId: 'fallback-model' },
          tried: [],
          zeroUsageRetried: false,
        },
      })
      .where(eq(stepTable.id, stepId))
      .run();
    emitRuntimeStepSpan(s.db, stepId, env);
    await flushRuntimeOtel();
    span = captured[1]!.body.resourceSpans[0]!.scopeSpans[0]!.spans[0]!;
    attrs = Object.fromEntries(span.attributes.map((a) => [a.key, a.value]));
    expect(attrs['gen_ai.provider.name']).toEqual({ stringValue: 'anthropic' });
    expect(attrs['gen_ai.request.model']).toEqual({ stringValue: 'fallback-model' });
    expect(attrs['cairn.runtime']).toEqual({ stringValue: 'pi' });
  });

  test('prefers a scheduled step reason and ignores a reason belonging to another step', async () => {
    const { s, buildId, stepId, todoId } = makeWorld({
      status: 'failed',
      claimedAt: 1000,
      finishedAt: 2000,
    });
    s.db
      .update(buildTable)
      .set({ errorMessage: 'build reason' })
      .where(eq(buildTable.id, buildId))
      .run();
    s.db
      .insert(schedule)
      .values({
        id: 'otel-schedule',
        teamId: s.team.id,
        projectId: 'project',
        todoId,
        kind: 'once',
        tz: 'UTC',
        createdBy: 'user',
        lastRunStepId: stepId,
        lastRunError: 'step reason',
      })
      .run();
    s.db
      .update(stepTable)
      .set({ scheduleId: 'otel-schedule' })
      .where(eq(stepTable.id, stepId))
      .run();
    const captured = capture();
    emitRuntimeStepSpan(s.db, stepId, env);
    await flushRuntimeOtel();
    expect(captured[0]!.body.resourceSpans[0]!.scopeSpans[0]!.spans[0]!.status?.message).toBe(
      'step reason',
    );
    s.db
      .update(schedule)
      .set({ lastRunStepId: 'other-step' })
      .where(eq(schedule.id, 'otel-schedule'))
      .run();
    emitRuntimeStepSpan(s.db, stepId, env);
    await flushRuntimeOtel();
    expect(captured[1]!.body.resourceSpans[0]!.scopeSpans[0]!.spans[0]!.status?.message).toBe(
      'build reason',
    );
  });

  test('skips steps that were never claimed', async () => {
    const { s, stepId } = makeWorld({ status: 'pending', claimedAt: null, finishedAt: null });
    const captured = capture();
    emitRuntimeStepSpan(s.db, stepId, env);
    await flushRuntimeOtel();
    expect(captured).toEqual([]);
  });
});

describe('emitRuntimeBuildSpan', () => {
  test('pushes the invoke_agent root span covering the build lifetime', async () => {
    const { s, buildId } = makeWorld({ status: 'done', claimedAt: 1000, finishedAt: 2000 });
    const captured = capture();
    emitRuntimeBuildSpan(s.db, buildId, 'done', env);
    await flushRuntimeOtel();
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

  test.each(['failed', 'cancelled'] as const)(
    'exports the todo and sanitized reason on a %s build root',
    async (outcome) => {
      const { s, buildId, todoId } = makeWorld({
        status: 'failed',
        claimedAt: 1000,
        finishedAt: 2000,
      });
      s.db
        .update(buildTable)
        .set({ errorMessage: 'OAuth failed\nBearer secret at http://192.0.2.1' })
        .where(eq(buildTable.id, buildId))
        .run();
      const captured = capture();
      emitRuntimeBuildSpan(s.db, buildId, outcome, env);
      await flushRuntimeOtel();
      const span = captured[0]!.body.resourceSpans[0]!.scopeSpans[0]!.spans[0]!;
      const attrs = Object.fromEntries(span.attributes.map((a) => [a.key, a.value]));
      expect(span.status).toEqual({ code: 2, message: 'OAuth failed <redacted> at http://<ip>' });
      expect(attrs['cairn.error_message']).toEqual({ stringValue: span.status?.message });
      expect(attrs['cairn.todo_id']).toEqual({ stringValue: todoId });
    },
  );

  test('marks failed and cancelled builds as error', async () => {
    const { s, buildId } = makeWorld({ status: 'failed', claimedAt: 1000, finishedAt: 2000 });
    const captured = capture();
    emitRuntimeBuildSpan(s.db, buildId, 'failed', env);
    await flushRuntimeOtel();
    emitRuntimeBuildSpan(s.db, buildId, 'cancelled', env);
    await flushRuntimeOtel();
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

  test('does nothing when no endpoint is configured', async () => {
    const { s, buildId } = makeWorld({ status: 'done', claimedAt: 1000, finishedAt: 2000 });
    const captured = capture();
    emitRuntimeBuildSpan(s.db, buildId, 'done', {});
    await flushRuntimeOtel();
    expect(captured).toEqual([]);
  });
});

describe('Coordinator turn export', () => {
  function chiefTurn(prompt: string | null) {
    const s = bootServer();
    disposables.push(() => s.dispose());
    const stepId = `step-${Math.random().toString(36).slice(2)}`;
    s.db
      .insert(stepTable)
      .values({
        id: stepId,
        buildId: 'chief-thread-9',
        kind: 'chief',
        status: 'done',
        prompt,
        claimedAt: 1000,
        finishedAt: 2000,
        createdAt: 900,
      })
      .run();
    return { s, stepId };
  }

  function attrsOf(span: { attributes: { key: string; value: unknown }[] }) {
    return Object.fromEntries(span.attributes.map((a) => [a.key, a.value]));
  }

  test('exports the turn as the root of its own trace grouped by thread session', async () => {
    const { s, stepId } = chiefTurn(null);
    const captured = capture();
    emitRuntimeStepSpan(s.db, stepId, { ...env, CAIRN_OTEL_ENVIRONMENT: 'prod' });
    await flushRuntimeOtel();
    expect(captured).toHaveLength(1);
    const request = captured[0]!.body.resourceSpans[0]!;
    expect(request.resource.attributes).toEqual([
      { key: 'service.name', value: { stringValue: 'cairn' } },
      { key: 'deployment.environment', value: { stringValue: 'prod' } },
    ]);
    const span = request.scopeSpans[0]!.spans[0]!;
    expect(span.traceId).toBe(otlpTraceIdOfTurn(stepId));
    expect(span.spanId).toBe(otlpStepSpanIdOfBuild('chief-thread-9', stepId));
    expect(span.parentSpanId).toBeUndefined();
    expect(span.name).toBe('coordinator turn');
    const attrs = attrsOf(span);
    expect(attrs['langfuse.trace.name']).toEqual({ stringValue: 'coordinator turn' });
    expect(attrs['langfuse.session.id']).toBeUndefined();
    expect(attrs['session.id']).toEqual({ stringValue: 'chief-thread-9' });
    expect(attrs['langfuse.trace.tags']).toEqual({
      arrayValue: { values: [{ stringValue: 'cairn' }, { stringValue: 'coordinator' }] },
    });
    expect(attrs['langfuse.environment']).toEqual({ stringValue: 'prod' });
    expect(attrs['deployment.environment']).toEqual({ stringValue: 'prod' });
    for (const key of [
      'cairn.build_id',
      'cairn.todo_id',
      'cairn.machine_id',
      'cairn.machine_name',
      'cairn.runtime',
      'gen_ai.provider.name',
      'gen_ai.request.model',
      'cairn.error_message',
    ])
      expect(attrs[key]).toBeUndefined();
    expect(attrs['cairn.thread_id']).toEqual({ stringValue: 'chief-thread-9' });
    expect(attrs['cairn.chief_trigger']).toEqual({ stringValue: 'user' });
  });

  test('exports the chief step error record without adding build identity attributes', async () => {
    const { s, stepId } = chiefTurn(null);
    s.db
      .insert(chiefThread)
      .values({
        id: 'chief-thread-9',
        chiefId: 'chief',
        userId: 'user',
        teamId: s.team.id,
        title: 'thread',
        sessionId: 'session',
        sessionOpenedAt: 900,
        createdAt: 900,
        updatedAt: 900,
      })
      .run();
    s.db
      .insert(chiefMessage)
      .values({
        id: `chief-err-${stepId}`,
        threadId: 'chief-thread-9',
        role: 'system',
        content: JSON.stringify({
          kind: 'chief_turn_error',
          message: 'OAuth revoked\nBearer secret',
        }),
        createdAt: 2000,
      })
      .run();
    s.db.update(stepTable).set({ status: 'failed' }).where(eq(stepTable.id, stepId)).run();
    const captured = capture();
    emitRuntimeStepSpan(s.db, stepId, env);
    await flushRuntimeOtel();
    const span = captured[0]!.body.resourceSpans[0]!.scopeSpans[0]!.spans[0]!;
    expect(span.status).toEqual({ code: 2, message: 'OAuth revoked <redacted>' });
    expect(attrsOf(span)['cairn.error_message']).toEqual({
      stringValue: 'OAuth revoked <redacted>',
    });
    expect(attrsOf(span)['cairn.build_id']).toBeUndefined();
  });

  test('never exports the turn prompt', async () => {
    const { s, stepId } = chiefTurn('please use token sk-ant-api03-supersecretvalue');
    const captured = capture();
    emitRuntimeStepSpan(s.db, stepId, env);
    await flushRuntimeOtel();
    expect(JSON.stringify(captured[0]!.body)).not.toContain('supersecretvalue');
  });

  test('omits environment attributes when CAIRN_OTEL_ENVIRONMENT is unset', async () => {
    const { s, stepId } = chiefTurn(null);
    const captured = capture();
    emitRuntimeStepSpan(s.db, stepId, env);
    await flushRuntimeOtel();
    const request = captured[0]!.body.resourceSpans[0]!;
    expect(request.resource.attributes).toEqual([
      { key: 'service.name', value: { stringValue: 'cairn' } },
    ]);
    const attrs = attrsOf(request.scopeSpans[0]!.spans[0]!);
    expect(attrs['langfuse.environment']).toBeUndefined();
    expect(attrs['deployment.environment']).toBeUndefined();
  });

  test('exports nothing when the endpoint is unset', async () => {
    const { s, stepId } = chiefTurn(null);
    const captured = capture();
    emitRuntimeStepSpan(s.db, stepId, { CAIRN_OTEL_ENVIRONMENT: 'prod' });
    await flushRuntimeOtel();
    expect(captured).toEqual([]);
  });

  test('a collector that never answers neither blocks nor throws', async () => {
    const { s, stepId } = chiefTurn(null);
    const port = (silent as Server).address() as AddressInfo;
    const started = Date.now();
    expect(() =>
      emitRuntimeStepSpan(s.db, stepId, {
        CAIRN_OTEL_ENDPOINT: `http://127.0.0.1:${port.port}/otel`,
      }),
    ).not.toThrow();
    expect(Date.now() - started).toBeLessThan(200);
  });

  test('a collector that refuses the connection does not surface an unhandled error', async () => {
    const { s, stepId } = chiefTurn(null);
    expect(() =>
      emitRuntimeStepSpan(s.db, stepId, { CAIRN_OTEL_ENDPOINT: 'http://127.0.0.1:1/otel' }),
    ).not.toThrow();
    await flushRuntimeOtel();
  }, 15_000);

  test('shutdown delivers a span emitted just before it', async () => {
    const { s, stepId } = chiefTurn(null);
    const captured = capture();
    emitRuntimeStepSpan(s.db, stepId, env);
    await shutdownRuntimeOtel();
    expect(captured).toHaveLength(1);
    expect(captured[0]?.body.resourceSpans[0]?.scopeSpans[0]?.spans[0]?.name).toBe(
      'coordinator turn',
    );
  });

  test('build root and steps carry the session and environment', async () => {
    const { s, buildId, stepId } = makeWorld({ status: 'done', claimedAt: 1000, finishedAt: 2000 });
    const captured = capture();
    const withEnv = { ...env, CAIRN_OTEL_ENVIRONMENT: 'prod' };
    emitRuntimeBuildSpan(s.db, buildId, 'done', withEnv);
    await flushRuntimeOtel();
    emitRuntimeStepSpan(s.db, stepId, withEnv);
    await flushRuntimeOtel();
    const root = attrsOf(captured[0]!.body.resourceSpans[0]!.scopeSpans[0]!.spans[0]!);
    expect(root['langfuse.trace.name']).toEqual({ stringValue: 'build' });
    expect(root['session.id']).toEqual({ stringValue: expect.stringMatching(/^todo-/) });
    expect(root['langfuse.environment']).toEqual({ stringValue: 'prod' });
    const stepAttrs = attrsOf(captured[1]!.body.resourceSpans[0]!.scopeSpans[0]!.spans[0]!);
    expect(stepAttrs['session.id']).toEqual(root['session.id']);
    expect(stepAttrs['langfuse.environment']).toEqual({ stringValue: 'prod' });
    expect(stepAttrs['langfuse.trace.name']).toBeUndefined();
  });
});

test('worker step roots export their own transcript input and final reply only', async () => {
  const { s, buildId, stepId } = makeWorld({ status: 'done', claimedAt: 1000, finishedAt: 2000 });
  s.db
    .insert(messageTable)
    .values([
      {
        id: transcriptPromptRowId(stepId),
        conversationId: buildId,
        role: 'user',
        content: 'implement the owner request',
        createdAt: 1100,
      },
      {
        id: `msg-${stepId}-1`,
        conversationId: buildId,
        role: 'assistant',
        content: [{ type: 'text', text: 'implementation is complete' }],
        createdAt: 1900,
      },
      {
        id: 'msg-other-step-1',
        conversationId: buildId,
        role: 'assistant',
        content: 'unrelated reply',
        createdAt: 1901,
      },
    ])
    .run();
  const captured = capture();
  emitRuntimeStepSpan(s.db, stepId, env);
  await flushRuntimeOtel();
  const attrs = Object.fromEntries(
    captured[0]!.body.resourceSpans[0]!.scopeSpans[0]!.spans[0]!.attributes.map((attribute) => [
      attribute.key,
      attribute.value,
    ]),
  );
  expect(JSON.stringify(attrs['langfuse.observation.input'])).toContain(
    'implement the owner request',
  );
  expect(JSON.stringify(attrs['langfuse.observation.output'])).toContain(
    'implementation is complete',
  );
  expect(JSON.stringify(attrs)).not.toContain('unrelated reply');
});
