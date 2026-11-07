import { join } from 'node:path';
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from '@earendil-works/pi-ai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../../scripts/test-tmpdir.mjs';
import { parseFlushOutput } from '../../src/coordinator/memory-flush.js';
import {
  compactionWindow,
  coordinatorCompactionExtension,
  coordinatorCompactionSettings,
} from '../../src/coordinator/runtime/compaction.js';
import {
  COMPACTION_FAILURE_LOG,
  compactionFailureCounts,
  resetCompactionFailureCounts,
  setFailureSink,
} from '../../src/coordinator/runtime/failure-report.js';
import { openCoordinatorHarness } from '../../src/coordinator/runtime/harness.js';
import { createCoordinatorModels } from '../../src/coordinator/runtime/models.js';
import { coordinatorToolsExtension, createStepGate } from '../../src/coordinator/runtime/tools.js';
import { runCoordinatorTurn } from '../../src/coordinator/runtime/turn.js';
import { step } from '../../src/db/schema.js';
import { chiefStep, fakeMachineApi } from './fake-machine-api.js';
import { boot, stub, world } from './runner-world.js';

const ctx = BACKGROUND_CONTEXT;
const SECRET = 'sk-live-0123456789abcdefSECRET';
const dirs: string[] = [];

interface Span {
  name: string;
  status?: { code: number; message: string };
  attributes: { key: string; value: { stringValue?: string; intValue?: string } }[];
}

let logs: { fields: Record<string, unknown>; message: string }[] = [];
let spans: Span[] = [];

beforeEach(() => {
  logs = [];
  spans = [];
  resetCompactionFailureCounts();
  setFailureSink({
    log: (fields, message) => logs.push({ fields: fields as Record<string, unknown>, message }),
    stepOf: () => null,
  });
  vi.stubEnv('CAIRN_OTEL_ENDPOINT', 'http://127.0.0.1:4318/v1/traces');
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as {
        resourceSpans: { scopeSpans: { spans: Span[] }[] }[];
      };
      for (const resource of body.resourceSpans) {
        for (const scope of resource.scopeSpans) spans.push(...scope.spans);
      }
      return new Response('{}', { status: 200 });
    }),
  );
});

afterEach(() => {
  setFailureSink(null);
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  for (const d of dirs.splice(0)) releaseTestTempDir(d);
});

const failureLogs = () => logs.filter((l) => l.message === COMPACTION_FAILURE_LOG);
const attr = (span: Span, key: string) =>
  span.attributes.find((a) => a.key === key)?.value.stringValue;

async function flushSpans(): Promise<void> {
  await vi.waitFor(() => expect(spans.length).toBeGreaterThan(0));
}

describe('compaction failures are never silent', () => {
  it('a failing memory flush is logged, marked on a span and counted while compaction completes', async () => {
    const window = 80_000;
    const faux = fauxProvider({
      provider: 'stub',
      models: [
        { id: 'm', contextWindow: window },
        { id: 'sum', contextWindow: window },
      ],
    });
    faux.setResponses(
      Array(400).fill(
        (c: { messages: { role: string }[] }, _o: unknown, _s: unknown, model: { id: string }) => {
          if (model.id === 'sum') return fauxAssistantMessage('folded summary');
          const last = c.messages.at(-1);
          if (last?.role === 'toolResult')
            return fauxAssistantMessage(`answer ${'word '.repeat(1500)}`);
          return fauxAssistantMessage([fauxToolCall('todos', {})], { stopReason: 'toolUse' });
        },
      ),
    );
    const coordinatorModels = createCoordinatorModels([faux.provider]);
    const dir = makeTestTempDir('coord-fail-');
    dirs.push(dir);
    const api = fakeMachineApi();
    api.relayTool = async () => 'row '.repeat(6000);
    const gate = createStepGate();
    let flushRuns = 0;
    const harness = await openCoordinatorHarness(
      join(dir, 'c.sqlite'),
      coordinatorModels.models,
      ctx,
      {
        extensions: [
          coordinatorToolsExtension(api, gate),
          coordinatorCompactionExtension(
            () => ({ provider: 'stub', modelId: 'sum' }),
            () => ({
              run: async () => {
                flushRuns += 1;
                throw new Error(`'none' is not supported with the model ${SECRET}`);
              },
            }),
            'thread-1',
          ),
        ],
        settings: () => ({
          compaction: coordinatorCompactionSettings([
            { provider: 'stub', id: 'm', contextWindow: window },
          ]),
        }),
      },
    );
    for (let turn = 0; turn < 40; turn++) {
      await runCoordinatorTurn(
        {
          harness,
          models: coordinatorModels,
          api,
          context: ctx,
          heartbeatMs: 10_000,
          now: () => turn,
          gate,
        },
        chiefStep(`step-${turn}`, `turn ${turn}`),
      );
    }
    await harness.waitForIdle(ctx);
    await harness.close(ctx);
    expect(api.dones.every((d) => d.body.status === 'success')).toBe(true);
    expect(flushRuns).toBeGreaterThan(0);
    const [line] = failureLogs();
    expect(line?.fields).toMatchObject({
      stage: 'memory-flush',
      errorClass: 'Error',
      threadId: 'thread-1',
    });
    expect(JSON.stringify(logs)).not.toContain(SECRET);
    expect(compactionFailureCounts()['memory-flush']).toBe(flushRuns);
    await flushSpans();
    const span = spans.find((s) => s.name === 'compaction memory-flush');
    expect(span?.status?.code).toBe(2);
    expect(JSON.stringify(spans)).not.toContain(SECRET);
    expect(attr(span as Span, 'error.type')).toBe('Error');
  }, 60_000);

  it('a background compaction whose summary call fails is reported once per task and the turns finish', async () => {
    const window = 80_000;
    const faux = fauxProvider({
      provider: 'stub',
      models: [
        { id: 'm', contextWindow: window },
        { id: 'sum', contextWindow: window },
      ],
    });
    faux.setResponses(
      Array(400).fill(
        (c: { messages: { role: string }[] }, _o: unknown, _s: unknown, model: { id: string }) => {
          if (model.id === 'sum')
            return fauxAssistantMessage('', {
              stopReason: 'error',
              errorMessage: `'none' is not supported ${SECRET}`,
            });
          const last = c.messages.at(-1);
          if (last?.role === 'toolResult')
            return fauxAssistantMessage(`answer ${'word '.repeat(1500)}`);
          return fauxAssistantMessage([fauxToolCall('todos', {})], { stopReason: 'toolUse' });
        },
      ),
    );
    const coordinatorModels = createCoordinatorModels([faux.provider]);
    const dir = makeTestTempDir('coord-fail-');
    dirs.push(dir);
    const api = fakeMachineApi();
    api.relayTool = async () => 'row '.repeat(6000);
    const gate = createStepGate();
    const harness = await openCoordinatorHarness(
      join(dir, 'c.sqlite'),
      coordinatorModels.models,
      ctx,
      {
        extensions: [
          coordinatorToolsExtension(api, gate),
          coordinatorCompactionExtension(
            () => ({ provider: 'stub', modelId: 'sum' }),
            () => null,
            'thread-1',
          ),
        ],
        settings: () => ({
          compaction: coordinatorCompactionSettings([
            { provider: 'stub', id: 'm', contextWindow: window },
          ]),
        }),
      },
    );
    for (let turn = 0; turn < 40; turn++) {
      await runCoordinatorTurn(
        {
          harness,
          models: coordinatorModels,
          api,
          context: ctx,
          heartbeatMs: 10_000,
          now: () => turn,
          gate,
        },
        chiefStep(`step-${turn}`, `turn ${turn}`),
      );
    }
    await harness.close(ctx);
    const reported = failureLogs().filter((l) => l.fields.stage === 'background-compaction');
    expect(reported.length).toBeGreaterThan(0);
    expect(JSON.stringify(logs)).not.toContain(SECRET);
    expect(compactionFailureCounts()['background-compaction']).toBe(reported.length);
  }, 60_000);

  it('a failing fold before a model switch is reported and the turn still completes', async () => {
    const faux = fauxProvider({
      provider: 'stub',
      models: [
        { id: 'big', contextWindow: 200_000 },
        { id: 'small', contextWindow: 32_000 },
        { id: 'sum', contextWindow: 200_000 },
      ],
    });
    faux.setResponses(
      Array(40).fill((_c: unknown, _o: unknown, _s: unknown, model: { id: string }) =>
        model.id === 'sum'
          ? fauxAssistantMessage('', { stopReason: 'error', errorMessage: `down ${SECRET}` })
          : fauxAssistantMessage(`answer ${'word '.repeat(2500)}`),
      ),
    );
    const coordinatorModels = createCoordinatorModels([faux.provider]);
    const dir = makeTestTempDir('coord-fail-');
    dirs.push(dir);
    const harness = await openCoordinatorHarness(
      join(dir, 'c.sqlite'),
      coordinatorModels.models,
      ctx,
      {
        extensions: [coordinatorCompactionExtension(() => ({ provider: 'stub', modelId: 'sum' }))],
        settings: () => ({
          compaction: coordinatorCompactionSettings([
            { provider: 'stub', id: 'big', contextWindow: 200_000 },
            { provider: 'stub', id: 'small', contextWindow: 32_000 },
          ]),
        }),
      },
    );
    const api = fakeMachineApi();
    const turn = (id: string, modelId: string) =>
      runCoordinatorTurn(
        {
          harness,
          models: coordinatorModels,
          api,
          context: ctx,
          heartbeatMs: 10_000,
          now: () => 1,
        },
        chiefStep(id, `question ${id}`, 'You are the Coordinator.', modelId),
      );
    for (let i = 0; i < 12; i++) await turn(`b${i}`, 'big');
    const result = await turn('s1', 'small');
    expect(result.status).toBe('success');
    expect(compactionWindow(32_000).blockingAt).toBeGreaterThan(0);
    const switchLine = failureLogs().find((l) => l.fields.stage === 'summary-fold');
    expect(switchLine?.fields).toMatchObject({ errorClass: 'Error' });
    expect(JSON.stringify(logs)).not.toContain(SECRET);
    await flushSpans();
    expect(spans.some((s) => s.name === 'compaction summary-fold' && s.status?.code === 2)).toBe(
      true,
    );
    await harness.close(ctx);
  }, 60_000);

  it('a failing seed summary is logged without the key, marked on a span and counted', async () => {
    const w = await world('go on');
    w.s.db
      .insert((await import('../../src/db/schema.js')).chiefMessage)
      .values(
        Array.from({ length: 130 }, (_, i) => ({
          id: `old-${i}`,
          threadId: w.threadId,
          role: i % 2 === 0 ? ('user' as const) : ('assistant' as const),
          content: `earlier message ${i}`,
          createdAt: 1000 + i,
        })),
      )
      .run();
    const { faux } = stub('unused');
    faux.setResponses([
      fauxAssistantMessage([], { stopReason: 'error', errorMessage: `401 key ${SECRET}` }),
      fauxAssistantMessage('answered'),
    ]);
    const coordinator = boot(w, faux, {
      logger: {
        info: () => {},
        warn: () => {},
        error: (fields: object, message: string) =>
          logs.push({ fields: fields as Record<string, unknown>, message }),
      },
    });
    coordinator.wake(w.threadId);
    await coordinator.idle();
    expect(
      w.s.db
        .select()
        .from(step)
        .all()
        .map((r) => r.status),
    ).toEqual(['done']);
    expect(failureLogs().map((l) => l.fields.stage)).toContain('seed-summary');
    expect(JSON.stringify(logs)).not.toContain(SECRET);
    expect(compactionFailureCounts()['seed-summary']).toBeGreaterThan(0);
    await flushSpans();
    expect(spans.some((s) => s.name === 'compaction seed-summary' && s.status?.code === 2)).toBe(
      true,
    );
  }, 60_000);

  it('flush output that is not JSON is a failure, not an empty result', () => {
    expect(() => parseFlushOutput('I saved nothing.')).toThrow(/memory flush output/);
    expect(() => parseFlushOutput('{"memories":"x"}')).toThrow(/memory flush output/);
    expect(parseFlushOutput('{"memories":[]}')).toEqual([]);
  });
});
