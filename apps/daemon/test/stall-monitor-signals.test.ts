import type { StepActivityReport } from '@cairn/shared';
import { describe, expect, test, vi } from 'vitest';
import { createActivityTracker } from '../src/activity.js';
import { MachineApiError } from '../src/machine-client.js';
import { consumeStepPassEvent, newStepPassState } from '../src/step-pass-events.js';
import { deliverStopRequest, StepStops } from '../src/step-stops.js';
import type { StepTranscriptStream } from '../src/step-transcript-stream.js';

describe('stall-monitor daemon signals', () => {
  test('ActivityTracker forwards stallSignal and detail and dedupes identical reports', () => {
    const sent: StepActivityReport[] = [];
    let t = 1_000;
    const tracker = createActivityTracker({
      send: (report) => sent.push(report),
      now: () => t,
      repeatMs: 5_000,
    });

    tracker.setPhase('retrying', {
      attempt: 1,
      resetLive: true,
      stallSignal: 'quota',
      detail: 'HTTP 429 quota exceeded',
    });
    tracker.setPhase('retrying', {
      attempt: 1,
      stallSignal: 'quota',
      detail: 'HTTP 429 quota exceeded',
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      phase: 'retrying',
      attempt: 1,
      stallSignal: 'quota',
      detail: 'HTTP 429 quota exceeded',
    });

    t += 5_000;
    tracker.setPhase('tool', {
      stallSignal: 'missing_tools',
      detail: 'Cairn host tools did not attach',
    });
    expect(sent).toHaveLength(2);
    expect(sent[1]).toMatchObject({
      phase: 'tool',
      stallSignal: 'missing_tools',
      detail: 'Cairn host tools did not attach',
    });
  });

  test('consumeStepPassEvent emits quota/capacity stallSignal on auto_retry_start and missing_tools on host tool failure', async () => {
    const phases: { phase: string; extra?: Record<string, unknown> }[] = [];
    const ctx = {
      stepId: 's-1',
      client: {
        tool: async () => {},
        transcriptDelta: async () => {},
        thinkingDelta: async () => {},
        transcriptRow: async () => {},
      },
      logger: { step: () => {}, raw: () => {} },
      modelKey: 'anthropic/claude-opus',
      provider: { kind: 'api_key', providerId: 'anthropic' },
      handle: { stop: async () => {} },
      promptImages: undefined,
      retryStormMax: 5,
      now: () => 2_000,
      watchdog: { noteProgress: () => {} },
      activity: {
        setPhase: (phase: string, extra?: Record<string, unknown>) => phases.push({ phase, extra }),
        noteEvent: () => {},
        toolStarted: () => {},
        toolEnded: () => {},
        noteSkill: () => {},
        noteUsage: () => {},
      },
      stream: {
        segments: { append: async () => {}, replace: async () => {}, seal: async () => {} },
        pushText: () => {},
        pushThinking: () => {},
        discardAttempt: () => {},
        rowCreatedAt: () => 2_000,
      } as unknown as StepTranscriptStream,
      transcript: { upsert: () => {} },
      agentTodo: { report: () => {} },
      toolStartedAt: new Map<string, number>(),
    };

    const state = newStepPassState();
    await consumeStepPassEvent(
      { type: 'error', error: { message: 'HTTP 429 too many requests', retryable: true } },
      ctx as never,
      state,
    );
    await consumeStepPassEvent({ type: 'auto_retry_start', attempt: 1 }, ctx as never, state);

    const retryEmit = phases.find((p) => p.phase === 'retrying');
    expect(retryEmit?.extra).toMatchObject({
      attempt: 1,
      stallSignal: 'capacity',
    });

    await consumeStepPassEvent(
      {
        type: 'toolcall_end',
        call: {
          id: 'tc-1',
          name: 'mcp__cairn__todos',
          arguments: {},
          result: 'unknown tool mcp__cairn__todos',
          isError: true,
        },
      },
      ctx as never,
      state,
    );
    expect(phases.some((p) => p.extra?.stallSignal === 'missing_tools')).toBe(true);
  });

  test('deliverStopRequest stops the live session when server returns 404/409/410 for released claim', async () => {
    for (const status of [404, 409, 410]) {
      const stops = new StepStops();
      const run = stops.enter('step-stop');
      const stopSession = vi.fn(async () => {});
      await run.attach({
        sessionId: 'sess-1',
        events: (async function* () {})(),
        steer: async () => {},
        stop: stopSession,
        usage: () => [],
      });
      const delivered = new Set<string>();
      await deliverStopRequest({
        stepId: 'step-stop',
        generation: 100,
        fetchStop: async () => {
          throw new MachineApiError(status, 'released');
        },
        stops,
        deliveredStops: delivered,
        log: () => {},
      });
      expect(stopSession).toHaveBeenCalledTimes(1);
      expect(delivered.has('step-stop:100')).toBe(true);
    }

    const stops = new StepStops();
    const oldRun = stops.enter('step-race');
    const stopOld = vi.fn(async () => {});
    const stopNew = vi.fn(async () => {});
    await oldRun.attach({
      sessionId: 'sess-old',
      events: (async function* () {})(),
      steer: async () => {},
      stop: stopOld,
      usage: () => [],
    });
    const delivered = new Set<string>();
    let releaseFetch!: () => void;
    const inflight = deliverStopRequest({
      stepId: 'step-race',
      generation: 100,
      fetchStop: () =>
        new Promise<boolean>((resolve) => {
          releaseFetch = () => resolve(false);
        }),
      stops,
      deliveredStops: delivered,
      log: () => {},
    });
    oldRun.settle();
    const newRun = stops.enter('step-race');
    await newRun.attach({
      sessionId: 'sess-new',
      events: (async function* () {})(),
      steer: async () => {},
      stop: stopNew,
      usage: () => [],
    });
    releaseFetch();
    await inflight;
    expect(stopOld).not.toHaveBeenCalled();
    expect(stopNew).not.toHaveBeenCalled();

    await deliverStopRequest({
      stepId: 'step-race',
      generation: 200,
      fetchStop: async () => false,
      stops,
      deliveredStops: delivered,
      log: () => {},
    });
    expect(stopNew).toHaveBeenCalledTimes(1);
  });
});
