import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from '@earendil-works/pi-ai';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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
  reportCompactionFailure,
  resetCompactionFailureCounts,
  setFailureSink,
} from '../../src/coordinator/runtime/failure-report.js';
import { openCoordinatorHarness } from '../../src/coordinator/runtime/harness.js';
import { createCoordinatorModels } from '../../src/coordinator/runtime/models.js';
import { coordinatorToolsExtension, createStepGate } from '../../src/coordinator/runtime/tools.js';
import { runCoordinatorTurn } from '../../src/coordinator/runtime/turn.js';
import { step } from '../../src/db/schema.js';
import { flushRuntimeOtel, shutdownRuntimeOtel } from '../../src/runtime-otel.js';
import { chiefStep, fakeMachineApi } from './fake-machine-api.js';
import { boot, stub, world } from './runner-world.js';

const ctx = BACKGROUND_CONTEXT;
const SECRET = 'sk-live-0123456789abcdefSECRET';
const dirs: string[] = [];

interface Span {
  name: string;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
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
    scrub: (_threadId, message) => message,
    log: (fields, message) => logs.push({ fields: fields as Record<string, unknown>, message }),
    stepOf: () => null,
  });
  vi.stubEnv('CAIRN_OTEL_ENDPOINT', endpoint);
});

let collector: Server | undefined;
let endpoint = '';

beforeAll(async () => {
  collector = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
        resourceSpans: { scopeSpans: { spans: Span[] }[] }[];
      };
      for (const resource of body.resourceSpans) {
        for (const scope of resource.scopeSpans) spans.push(...scope.spans);
      }
      res.setHeader('content-type', 'application/json');
      res.end('{}');
    });
  });
  await new Promise<void>((done) => collector?.listen(0, '127.0.0.1', done));
  endpoint = `http://127.0.0.1:${(collector.address() as AddressInfo).port}/v1/traces`;
});

afterAll(async () => {
  await shutdownRuntimeOtel();
  collector?.close();
});

afterEach(() => {
  setFailureSink(null);
  vi.unstubAllEnvs();
  for (const d of dirs.splice(0)) releaseTestTempDir(d);
});

const failureLogs = () => logs.filter((l) => l.message === COMPACTION_FAILURE_LOG);
const attr = (span: Span, key: string) =>
  span.attributes.find((a) => a.key === key)?.value.stringValue;

async function flushSpans(): Promise<void> {
  await flushRuntimeOtel();
  expect(spans.length).toBeGreaterThan(0);
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
        async (
          c: { messages: { role: string }[] },
          _o: unknown,
          _s: unknown,
          model: { id: string },
        ) => {
          if (model.id === 'sum') {
            await delay(20);
            return fauxAssistantMessage('folded summary');
          }
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
                await delay(20);
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
    const folded = spans.find((s) => s.name === 'compaction summary-fold');
    expect(folded?.status?.code).not.toBe(2);
    for (const phase of [span, folded]) {
      expect(
        BigInt(phase!.endTimeUnixNano) - BigInt(phase!.startTimeUnixNano),
      ).toBeGreaterThanOrEqual(15_000_000n);
    }
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
        async (
          c: { messages: { role: string }[] },
          _o: unknown,
          _s: unknown,
          model: { id: string },
        ) => {
          if (model.id === 'sum') {
            await delay(20);
            return fauxAssistantMessage('', {
              stopReason: 'error',
              errorMessage: `'none' is not supported ${SECRET}`,
            });
          }
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
    await flushSpans();
    const failedFold = spans.find(
      (s) => s.name === 'compaction summary-fold' && s.status?.code === 2,
    )!;
    expect(
      BigInt(failedFold.endTimeUnixNano) - BigInt(failedFold.startTimeUnixNano),
    ).toBeGreaterThanOrEqual(15_000_000n);
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

  it.each([
    'memory-flush',
    'model-switch-fold',
    'summary-fold',
    'summary-model',
    'seed-summary',
    'background-compaction',
  ] as const)(
    'removes the resolved provider key from the %s report even when it has no known prefix',
    async (stage) => {
      const credential = 'custom-provider-credential-1234567890';
      const w = await world('hi', credential);
      const { faux } = stub('unused');
      boot(w, faux, {
        logger: {
          info: () => {},
          warn: () => {},
          error: (fields: object, message: string) =>
            logs.push({ fields: fields as Record<string, unknown>, message }),
        },
      });
      reportCompactionFailure(
        { threadId: w.threadId },
        stage,
        new Error(`401 incorrect API key provided: ${credential}`),
      );
      await flushSpans();
      expect(failureLogs()).toHaveLength(1);
      expect(JSON.stringify(logs)).not.toContain(credential);
      expect(JSON.stringify(spans)).not.toContain(credential);
    },
  );
});
