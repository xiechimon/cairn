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

describe('mapTranscript in-flight thinking (#1308)', () => {
  test('non-empty thinking text hangs a thinking row, the streaming phase row stays', () => {
    const items = transcript('REASONING-MARKER-1308', [claimed()]);
    const thinking = items.filter((item) => item.kind === 'thinking');
    expect(thinking).toEqual([{ kind: 'thinking', text: 'REASONING-MARKER-1308' }]);
    expect(items.some((item) => item.kind === 'streaming')).toBe(true);
  });

  test('empty thinking produces no thinking row', () => {
    const items = transcript('   ', [claimed()]);
    expect(items.some((item) => item.kind === 'thinking')).toBe(false);
    expect(items.some((item) => item.kind === 'streaming')).toBe(true);
  });

  test('a settled step hangs no in-flight thinking', () => {
    const items = transcript('REASONING-MARKER-1308', []);
    expect(items.some((item) => item.kind === 'thinking')).toBe(false);
  });
});

describe('mapChief in-flight thinking (#1308)', () => {
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

  test('turn in flight and thinking non-empty: thinking row before the presence row', () => {
    const stream = chief('REASONING-MARKER-1308').stream ?? [];
    const thinkingAt = stream.findIndex((item) => item.kind === 'thinking');
    const streamingAt = stream.findIndex((item) => item.kind === 'streaming');
    expect(stream[thinkingAt]).toEqual({ kind: 'thinking', text: 'REASONING-MARKER-1308' });
    expect(streamingAt).toBeGreaterThan(thinkingAt);
  });

  test('empty thinking produces no thinking row, the presence row stays', () => {
    const stream = chief('').stream ?? [];
    expect(stream.some((item) => item.kind === 'thinking')).toBe(false);
    expect(stream.at(-1)).toMatchObject({ kind: 'streaming' });
  });

  test('a settled turn hangs no in-flight thinking', () => {
    const stream = chief('REASONING-MARKER-1308', false).stream ?? [];
    expect(stream.some((item) => item.kind === 'thinking')).toBe(false);
  });
});
