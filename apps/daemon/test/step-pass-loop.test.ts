import type {
  AgentSessionHandle,
  ClaimedStep,
  ProviderConfig,
  SessionOpts,
  StepEvent,
} from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import type { DaemonLogger } from '../src/log.js';
import { newStepPassState } from '../src/step-pass-events.js';
import { runStepPasses, type StepPassLoopInput } from '../src/step-pass-loop.js';
import type { StepSessionOpener } from '../src/step-session-opener.js';
import { StepStops } from '../src/step-stops.js';

const PROVIDER = { kind: 'api_key', providerId: 'p1' } as ProviderConfig;
const NETWORK = 'dial tcp 203.0.113.7:8783: connection refused';

function sessionHandle(id: string, events: StepEvent[]): AgentSessionHandle {
  return {
    sessionId: id,
    events: (async function* () {
      yield* events;
    })(),
    steer: async () => {},
    stop: async () => {},
    usage: () => [],
  } as unknown as AgentSessionHandle;
}

const done = { type: 'done', usage: [] } as unknown as StepEvent;
const failure = (message: string) =>
  ({ type: 'error', error: { message, retryable: true } }) as unknown as StepEvent;

function harness(
  opens: (AgentSessionHandle | Error)[],
  overrides: Partial<StepPassLoopInput> = {},
) {
  const lines: string[] = [];
  const opened: (string | null)[] = [];
  const journal: unknown[] = [];
  let flushed = 0;
  const log = (line: string) => lines.push(line);
  const opener = {
    continueId: null as string | null,
    imageSupport: true,
    promptImages: undefined,
    open: async () => {
      opened.push(opener.continueId);
      const next = opens.shift();
      if (next === undefined) throw new Error('no more sessions');
      if (next instanceof Error) throw next;
      return next;
    },
    setImageSupport: () => {},
    retryWithoutImages: async () => false,
  };
  const input: StepPassLoopInput = {
    stepId: 's1',
    client: {} as StepPassLoopInput['client'],
    logger: { raw: log, step: log } as unknown as DaemonLogger,
    modelKey: 'p1/m',
    retryStormMax: 3,
    now: () => 1,
    watchdog: {
      trippedArm: null,
      startPass: () => {},
      noteEvent: () => {},
      noteToolCall: () => {},
      clearTrip: () => {},
    } as unknown as StepPassLoopInput['watchdog'],
    activity: {
      setPhase: () => {},
      noteEvent: () => {},
    } as unknown as StepPassLoopInput['activity'],
    stream: {
      discardDeltas: () => {},
      flushDeltas: () => {
        flushed += 1;
      },
    } as unknown as StepPassLoopInput['stream'],
    transcript: {} as StepPassLoopInput['transcript'],
    agentTodo: {} as StepPassLoopInput['agentTodo'],
    toolStartedAt: new Map(),
    claimed: { answerIds: [] } as unknown as ClaimedStep,
    convId: 'conv-1',
    isChief: false,
    backend: {},
    sessionOpts: { provider: PROVIDER, modelId: 'm', cwd: '/ws' } as SessionOpts,
    provider: PROVIDER,
    opener: opener as unknown as StepSessionOpener,
    passState: newStepPassState(),
    session: { current: null },
    stop: new StepStops().enter('s1'),
    askChannel: {
      ackAnswers: async () => {},
      ackPollsReachedBy: async () => {},
    } as unknown as StepPassLoopInput['askChannel'],
    journal: {
      update: (_id: string, patch: unknown) => journal.push(patch),
    } as unknown as StepPassLoopInput['journal'],
    credentialValues: () => [],
    sessionHandles: new Map(),
    networkRetryDelays: [0],
    ...overrides,
  };
  return { input, lines, opened, journal, flushed: () => flushed };
}

describe('runStepPasses', () => {
  test('a session that cannot open fails with its error and flushes deltas', async () => {
    const h = harness([new Error('spawn failed')]);
    const result = await runStepPasses(h.input);
    expect(result.openError).toBe('spawn failed');
    expect(h.flushed()).toBe(1);
  });

  test('a completed pass runs once and records the running session', async () => {
    const h = harness([sessionHandle('sess-1', [done])]);
    const result = await runStepPasses(h.input);
    expect(result).toEqual({ openError: null, provider: PROVIDER });
    expect(h.opened).toEqual([null]);
    expect(h.journal).toEqual([{ state: 'running', sessionId: 'sess-1' }]);
    expect(h.input.session.current?.sessionId).toBe('sess-1');
    expect(h.input.passState.sawDone).toBe(true);
  });

  test('a network failure continues the same session once', async () => {
    const h = harness([
      sessionHandle('sess-1', [failure(NETWORK)]),
      sessionHandle('sess-1', [done]),
    ]);
    await runStepPasses(h.input);
    expect(h.opened).toEqual([null, 'sess-1']);
    expect(h.lines).toContain('provider network retry 1: waiting 0ms before final attempt');
  });

  test('a first pass protocol error retries once with the adapted provider', async () => {
    const amended = { ...PROVIDER, compat: { supportsStore: false } } as ProviderConfig;
    const h = harness(
      [
        sessionHandle('sess-1', [failure('invalid tool schema in request')]),
        sessionHandle('sess-2', [done]),
      ],
      { backend: { adaptProviderCompat: () => amended } },
    );
    const result = await runStepPasses(h.input);
    expect(result.provider).toBe(amended);
    expect(h.input.sessionOpts.provider).toBe(amended);
    expect(h.opened).toHaveLength(2);
  });
});
