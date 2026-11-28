import type { ChiefGetResponse, ChiefThread } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { mapChief, type MessageRow } from '../src/api/mappers.js';

const ENV = {
  chief: {
    id: 'chief-u1-t1',
    userId: 'u1',
    teamId: 't1',
    agent: { agentId: 'agent-1' },
    lastTurnAt: null,
    createdAt: 0,
    tz: null,
    model: null,
  },
  agentActor: null,
  context: null,
  watches: [],
  wakes: [],
} as unknown as ChiefGetResponse;

function thread(stepId: string): ChiefThread {
  return {
    id: 'chief-ttt',
    chiefId: 'chief-u1-t1',
    userId: 'u1',
    teamId: 't1',
    title: 'Coordinator',
    createdAt: 1,
    updatedAt: 1,
    lastTurnAt: null,
    session: { runtime: 'pi', id: 's1', openedAt: 1 },
    pendingSessionResumeAt: null,
    toolDefHashes: {},
    toolResultHashes: {},
    activeRun: { phase: 'chief' },
    turnQueue: {
      stepId,
      position: 1,
      waitingFor: { machineId: 'mac-1', name: 'mac' },
    },
  };
}

const MESSAGES: MessageRow[] = [
  { id: 'u-old', role: 'user', content: '先前那句', createdAt: 1 },
  { id: 'a-old', role: 'assistant', content: '答过了', createdAt: 2 },
  { id: 'u-wait', role: 'user', content: '停止', createdAt: 3 },
];

describe('stop on a turn waiting for a machine targets that turn', () => {
  test('a waiting user turn can be withdrawn by its own message id', () => {
    const chief = mapChief(ENV, {
      threads: [thread('u-wait')],
      activeThreadId: 'chief-ttt',
      messages: MESSAGES,
    });
    expect(chief.waitingTurn).toEqual({ messageId: 'u-wait' });
  });

  test('a waiting turn with no user message of its own offers nothing to withdraw', () => {
    const chief = mapChief(ENV, {
      threads: [thread('resume-after-question')],
      activeThreadId: 'chief-ttt',
      messages: MESSAGES.slice(0, 2),
    });
    expect(chief.waitingTurn).toBeUndefined();
  });

  test('a waiting turn is found even when the newest stream row is a reply', () => {
    const chief = mapChief(ENV, {
      threads: [thread('u-asked')],
      activeThreadId: 'chief-ttt',
      messages: [
        { id: 'u-asked', role: 'user', content: '插一句', createdAt: 1 },
        { id: 'a-new', role: 'assistant', content: '答完了', createdAt: 2 },
      ],
    });
    expect(chief.waitingTurn).toEqual({ messageId: 'u-asked' });
  });
});

test('a Runner-offline outage names the machine it waits on so the transcript card owns the event', () => {
  const chief = mapChief(
    {
      ...ENV,
      outage: { reason: 'runner-offline', model: null, retryAt: null },
    } as unknown as ChiefGetResponse,
    {
      threads: [
        {
          ...thread('u-wait'),
          turnQueue: {
            stepId: 'u-wait',
            position: 1,
            waitingFor: { machineId: 'mac-1', name: 'mac-mini' },
            blocked: { kind: 'machine-offline', missing: [] },
          },
        },
      ],
      activeThreadId: 'chief-ttt',
      messages: [],
    },
  );
  expect(chief.outageMachines).toEqual(['mac-mini']);
});

test.each([
  ['ready', true],
  ['held', undefined],
] as const)('a started turn waiting to run again (%s) can be stopped', (waitingRerun, running) => {
  const chief = mapChief(ENV, {
    threads: [{ ...thread('u-wait'), turnRunning: false, waitingRerun, turnQueue: null }],
    activeThreadId: 'chief-ttt',
    messages: MESSAGES,
  });
  expect(chief.waitingRerun).toBe(true);
  expect(chief.running).toBe(running);
});
