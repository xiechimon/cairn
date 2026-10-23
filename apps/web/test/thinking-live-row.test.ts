// #1308 思考增量的消费面：在飞思考文本投影成既有 kind:'thinking' 行，
// 空缓冲不产行，回合不在飞时不挂（与 text_delta 打字面同一道门）。
// 失败方式：
//   1. liveThinking 非空但 transcript / chief 不产 thinking 行 → 只有相位标签。
//   2. 空串也产行 → 空思考折页噪声。
//   3. 步已收仍挂在飞思考 → 与落库行叠成两份。
//   4. 思考行挤掉 streaming / 打字行 → 相位兜底或正文增量消失。

import type { BuildRecord, StepJournalRow } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { mapChief, mapTranscript } from '../src/api/mappers.js';
import { NOW, todo } from './helpers.js';

const BUILD: BuildRecord = {
  id: 'build-1',
  todoId: 'todo-1',
  withPlan: false,
  prevPhase: null,
  triggerSource: 'user',
  planDocId: null,
  errorMessage: null,
  prUrl: null,
  prNumber: null,
  diffHash: null,
  createdAt: NOW - 60_000,
};

function claimed(): StepJournalRow {
  return {
    id: 'step-plan-claimed',
    buildId: BUILD.id,
    kind: 'plan',
    machineId: null,
    createdAt: NOW - 30_000,
    status: 'claimed',
    checkpointCommit: null,
    skillInjection: null,
  };
}

function transcript(liveThinking: string, steps: StepJournalRow[]) {
  return mapTranscript({
    messages: [],
    steps,
    plans: [],
    build: BUILD,
    todo: todo(9, 'building'),
    machineName: null,
    userName: 'Xmon Dai',
    liveText: '',
    liveThinking,
  });
}

describe('mapTranscript 在飞思考（#1308）', () => {
  test('非空思考文本挂 thinking 行，streaming 相位行仍在', () => {
    const items = transcript('REASONING-MARKER-1308', [claimed()]);
    const thinking = items.filter((item) => item.kind === 'thinking');
    expect(thinking).toEqual([{ kind: 'thinking', text: 'REASONING-MARKER-1308' }]);
    expect(items.some((item) => item.kind === 'streaming')).toBe(true);
  });

  test('空思考不产 thinking 行', () => {
    const items = transcript('   ', [claimed()]);
    expect(items.some((item) => item.kind === 'thinking')).toBe(false);
    expect(items.some((item) => item.kind === 'streaming')).toBe(true);
  });

  test('步已收不挂在飞思考', () => {
    const items = transcript('REASONING-MARKER-1308', []);
    expect(items.some((item) => item.kind === 'thinking')).toBe(false);
  });
});

describe('mapChief 在飞思考（#1308）', () => {
  const ENV = {
    chief: {
      id: 'chief-u1-t1',
      userId: 'u1',
      teamId: 't1',
      agent: null,
      charter: null,
      lastTurnAt: null,
      createdAt: 0,
      tz: null,
      model: null,
    },
    agentActor: null,
    context: null,
    watches: [],
    wakes: [],
  } as unknown as Parameters<typeof mapChief>[0];

  const THREAD = {
    id: 'chief-bbb',
    chiefId: 'chief-u1-t1',
    userId: 'u1',
    teamId: 't1',
    title: '线程乙',
    createdAt: 2,
    updatedAt: 2,
    lastTurnAt: null,
    session: { runtime: 'pi', id: 's2', openedAt: 2 },
    pendingSessionResumeAt: null,
    toolDefHashes: {},
    toolResultHashes: {},
    activeRun: { phase: 'chief' },
  } as unknown as import('@cairn/shared').ChiefThread;

  const USER = {
    id: 'AbCdEfGhIjKlMnOpQrStU',
    role: 'user',
    content: '派一下',
    createdAt: NOW,
  } as unknown as import('../src/api/mappers.js').MessageRow;

  function chief(liveThinking: string, running = true) {
    const thread = running ? THREAD : { ...THREAD, activeRun: null };
    return mapChief(ENV, {
      threads: [thread],
      activeThreadId: 'chief-bbb',
      messages: [USER],
      liveThinking,
    });
  }

  test('回合在飞且思考非空：thinking 行在存在行之前', () => {
    const stream = chief('REASONING-MARKER-1308').stream ?? [];
    const thinkingAt = stream.findIndex((item) => item.kind === 'thinking');
    const streamingAt = stream.findIndex((item) => item.kind === 'streaming');
    expect(stream[thinkingAt]).toEqual({ kind: 'thinking', text: 'REASONING-MARKER-1308' });
    expect(streamingAt).toBeGreaterThan(thinkingAt);
  });

  test('空思考不产 thinking 行，存在行仍在', () => {
    const stream = chief('').stream ?? [];
    expect(stream.some((item) => item.kind === 'thinking')).toBe(false);
    expect(stream.at(-1)).toMatchObject({ kind: 'streaming' });
  });

  test('回合已收不挂在飞思考', () => {
    const stream = chief('REASONING-MARKER-1308', false).stream ?? [];
    expect(stream.some((item) => item.kind === 'thinking')).toBe(false);
  });
});
