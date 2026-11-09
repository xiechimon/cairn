import type {
  AgentBackend,
  ClaimedStep,
  MachineAskBody,
  MachineAskResponse,
  SessionOpts,
  StepEvent,
} from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { PI_CAPABILITIES } from '../src/backend/pi.js';
import { boot, CLAIMED, FakeMachineApi, waitFor } from './machine-loop-harness.js';

const REQUEST_A = 'ask-aaaaaaaa-1111-2222-3333-666666666666';
const REQUEST_B = 'ask-bbbbbbbb-1111-2222-3333-666666666666';

function decision(requestId: string, answer: string) {
  return { requestId, question: 'Which wins?', answer, by: 'person' as const, at: 1 };
}

function scriptedBackend(script: {
  steer?: (text: string) => Promise<void>;
  onOpen?: (opts: SessionOpts) => Promise<StepEvent[] | undefined>;
  held?: boolean;
}) {
  const prompts: string[] = [];
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const open = async (opts: SessionOpts) => {
    prompts.push(opts.prompt ?? '');
    return {
      sessionId: 'sess-answers',
      events: (async function* () {
        yield { type: 'text_delta', text: 'working' } as StepEvent;
        for (const event of (await script.onOpen?.(opts)) ?? []) yield event;
        if (script.held !== false) await gate;
        yield { type: 'done', usage: [] } as StepEvent;
      })(),
      steer: script.steer ?? (async () => {}),
      async stop() {},
      usage: () => [],
    };
  };
  const backend: AgentBackend = {
    capabilities: PI_CAPABILITIES,
    createSession: open,
    continueSession: (_id, opts) => open(opts),
  };
  return { backend, prompts, release: () => release() };
}

async function run(api: FakeMachineApi, backend: AgentBackend, claimed: ClaimedStep) {
  const booted = await boot({ api, backend });
  await waitFor(() => api.parked !== null);
  api.parked?.(claimed);
  await waitFor(() => booted.lines.some((line) => line.includes('session conv-1')));
  return booted;
}

describe('the daemon acks an answer only after it reached the agent', () => {
  test('a steer pickup renders its answers into the steer text and acks them by request id via steer', async () => {
    const api = new FakeMachineApi();
    api.steerResponse = 'Also add a test.';
    api.steerAnswers = [
      { requestId: REQUEST_A, text: 'Answer for A.' },
      { requestId: REQUEST_B, text: 'Answer for B.' },
    ];
    const steered: string[] = [];
    const { backend, release } = scriptedBackend({
      steer: async (text) => {
        steered.push(text);
      },
    });
    const { handle } = await run(api, backend, CLAIMED);
    api.onStreamEvent?.({ type: 'steer', stepId: 's1' });
    await waitFor(() => api.calls.includes('steer-ack:s1'));
    expect(steered).toHaveLength(1);
    expect(steered[0]).toContain('Also add a test.');
    expect(steered[0]).toContain(`Answer to your question ${REQUEST_A}:\nAnswer for A.`);
    expect(steered[0]).toContain(`Answer to your question ${REQUEST_B}:\nAnswer for B.`);
    expect(api.steerAckBodies).toEqual([{ answerIds: [REQUEST_A, REQUEST_B], via: 'steer' }]);
    release();
    await handle.stop();
    await handle.done;
  });

  test('live.steer fails: the answers are never acked', async () => {
    const api = new FakeMachineApi();
    api.steerAnswers = [{ requestId: REQUEST_A, text: 'Answer for A.' }];
    const { backend, release } = scriptedBackend({
      steer: async () => {
        throw new Error('session closed mid-steer');
      },
    });
    const { handle, lines } = await run(api, backend, CLAIMED);
    api.onStreamEvent?.({ type: 'steer', stepId: 's1' });
    await waitFor(() => lines.some((line) => line.includes('steer delivery failed')));
    expect(api.calls).not.toContain('steer-ack:s1');
    release();
    await handle.stop();
    await handle.done;
  });

  test('a continued session renders the claimed answers from the decisions and acks them via session-start', async () => {
    const api = new FakeMachineApi();
    const { backend, prompts, release } = scriptedBackend({});
    const claimed: ClaimedStep = {
      ...CLAIMED,
      step: { ...CLAIMED.step, kind: 'session' },
      session: { action: 'continue', sessionId: 'sess-prev' },
      instruction: 'Continue with the answers.',
      answerIds: [REQUEST_A, REQUEST_B],
      todo: {
        ...CLAIMED.todo!,
        decisions: [
          decision('ask-older', 'Already delivered.'),
          decision(REQUEST_A, 'Answer for A.'),
          decision(REQUEST_B, 'Answer for B.'),
        ],
      },
    };
    const { handle } = await run(api, backend, claimed);
    await waitFor(() => api.calls.includes('steer-ack:s1'));
    expect(prompts[0]).toContain('Continue with the answers.');
    expect(prompts[0]).toContain(`Answer to your question ${REQUEST_A}:\nAnswer for A.`);
    expect(prompts[0]).toContain(`Answer to your question ${REQUEST_B}:\nAnswer for B.`);
    expect(prompts[0]).not.toContain('Already delivered.');
    expect(api.steerAckBodies).toEqual([
      { answerIds: [REQUEST_A, REQUEST_B], via: 'session-start' },
    ]);
    release();
    await handle.stop();
    await handle.done;
  });

  async function askOnce(api: FakeMachineApi, resultReachesAgent: boolean) {
    const asked: string[] = [];
    Object.assign(api, {
      askUser: async (_stepId: string, body: MachineAskBody): Promise<MachineAskResponse> => {
        asked.push(body.requestId);
        return {
          status: 'answered',
          requestId: body.requestId,
          answers: [{ header: 'Conflict', text: 'Repo rule wins.' }],
          reason: null,
        };
      },
    });
    let toolResult = '';
    const { backend } = scriptedBackend({
      held: false,
      onOpen: async (opts) => {
        toolResult = (await opts.executeRemoteTool?.('ask_user', {
          questions: [{ header: 'Conflict', question: 'Which wins?', options: [] }],
        })) as string;
        if (!resultReachesAgent) return [];
        return [
          {
            type: 'toolcall_end',
            call: { id: 'call-1', name: 'ask_user', arguments: {}, result: toolResult },
          } as StepEvent,
        ];
      },
    });
    const claimed: ClaimedStep = {
      ...CLAIMED,
      remoteTools: [{ name: 'ask_user', description: 'Ask the person' }],
    };
    const { handle } = await run(api, backend, claimed);
    await waitFor(() => api.doneBodies.length === 1);
    expect(JSON.parse(toolResult)).toMatchObject({ status: 'answered' });
    expect(asked).toHaveLength(1);
    await handle.stop();
    await handle.done;
    return asked;
  }

  test('an answered ask_user poll is acked via poll once its tool result reached the agent', async () => {
    const api = new FakeMachineApi();
    const asked = await askOnce(api, true);
    expect(api.steerAckBodies).toEqual([{ answerIds: asked, via: 'poll' }]);
  });

  test('an answered ask_user poll whose tool result never reached the agent is not acked', async () => {
    const api = new FakeMachineApi();
    await askOnce(api, false);
    expect(api.steerAckBodies).toEqual([]);
  });

  function lazyPromptBackend(api: FakeMachineApi, events: StepEvent[]) {
    const backend: AgentBackend = {
      capabilities: PI_CAPABILITIES,
      async createSession() {
        throw new Error('unused');
      },
      async continueSession() {
        return {
          sessionId: 'sess-lazy',
          events: (async function* () {
            api.calls.push('prompt-sent');
            for (const event of events) {
              api.calls.push(`event:${event.type}`);
              yield event;
            }
          })(),
          async steer() {},
          async stop() {},
          usage: () => [],
        };
      },
    };
    return backend;
  }

  const continued: ClaimedStep = {
    ...CLAIMED,
    step: { ...CLAIMED.step, kind: 'session' },
    session: { action: 'continue', sessionId: 'sess-prev' },
    answerIds: [REQUEST_A],
    todo: { ...CLAIMED.todo!, decisions: [decision(REQUEST_A, 'Answer for A.')] },
  };

  test('a backend that sends its prompt on first iteration is acked via session-start only after its first event', async () => {
    const api = new FakeMachineApi();
    const backend = lazyPromptBackend(api, [
      { type: 'text_delta', text: 'working' } as StepEvent,
      { type: 'done', usage: [] } as StepEvent,
    ]);
    const { handle } = await run(api, backend, continued);
    await waitFor(() => api.doneBodies.length === 1);
    const ackAt = api.calls.indexOf('steer-ack:s1');
    expect(ackAt).toBeGreaterThan(api.calls.indexOf('event:text_delta'));
    expect(api.steerAckBodies).toEqual([{ answerIds: [REQUEST_A], via: 'session-start' }]);
    await handle.stop();
    await handle.done;
  });

  test('a session that ends without emitting any event never acks its answers', async () => {
    const api = new FakeMachineApi();
    const backend = lazyPromptBackend(api, []);
    const booted = await boot({ api, backend });
    await waitFor(() => api.parked !== null);
    api.parked?.(continued);
    await waitFor(() => api.doneBodies.length === 1);
    expect(api.calls).toContain('prompt-sent');
    expect(api.steerAckBodies).toEqual([]);
    await booted.handle.stop();
    await booted.handle.done;
  });

  test('the session-start ack completes before the step reports done', async () => {
    const api = new FakeMachineApi();
    const ack = api.steerAck.bind(api);
    api.steerAck = async (stepId, body) => {
      await new Promise((resolve) => setTimeout(resolve, 150));
      await ack(stepId, body);
      api.calls.push('ack-finished');
    };
    const { backend } = scriptedBackend({ held: false });
    const claimed: ClaimedStep = {
      ...CLAIMED,
      answerIds: [REQUEST_A],
      todo: { ...CLAIMED.todo!, decisions: [decision(REQUEST_A, 'Answer for A.')] },
    };
    const { handle } = await run(api, backend, claimed);
    await waitFor(() => api.doneBodies.length === 1);
    const done = api.calls.findIndex((call) => call.startsWith('done:s1'));
    expect(api.calls.indexOf('ack-finished')).toBeGreaterThanOrEqual(0);
    expect(api.calls.indexOf('ack-finished')).toBeLessThan(done);
    await handle.stop();
    await handle.done;
  });
});
