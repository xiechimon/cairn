import { type ChiefThread, orchestrateThreadTitle } from '@cairn/shared';
import { expect, test } from 'vitest';
import { inflightOrchestrationFor } from '../src/chief/orchestration-inflight.js';
import type { TodoRecord } from '../src/fixtures/records.js';

const reason = '400 context_length_exceeded: maximum context length is 200000 tokens';
const failed: ChiefThread = {
  id: 'chief-failed', title: orchestrateThreadTitle(1586), createdAt: 2,
  chiefId: 'chief-u-t', userId: 'u', teamId: 't', updatedAt: 2, lastTurnAt: 2,
  session: { runtime: 'pi', id: '', openedAt: 2 }, pendingSessionResumeAt: null,
  toolDefHashes: {}, toolResultHashes: {},
  activeRun: null, turnQueue: null, lastTurnError: reason,
};
const todo: TodoRecord = {
  id: 'todo-1586', seqNum: 1586, title: '修复编排', phase: 'todo', phaseAt: 0,
  hasPlan: false, hasChanges: false,
  teamId: 't', projectId: 'p', spec: '', orderIndex: 0, tagIds: [], assignment: null,
  agent: null, latestBuildId: null, lastRunAt: null, buildHistory: [], sourceTodo: null, v: 1,
};

test('a failed round is no longer in flight, and a newer round is', () => {
  expect(inflightOrchestrationFor([failed], todo)).toBeNull();
  const retry = { ...failed, id: 'chief-retry', createdAt: 3, activeRun: { phase: 'chief' as const }, lastTurnError: undefined };
  expect(inflightOrchestrationFor([failed, retry], todo)?.id).toBe('chief-retry');
  expect(inflightOrchestrationFor([failed, retry], { id: 'todo-1587', seqNum: 1587 })).toBeNull();
});

const global = { ...failed, id: 'chief-global', title: 'Coordinator', lastTurnError: null };

test('a thread that reports its orchestration is matched by todo id, not by title', () => {
  const running = { ...global, activeRun: { phase: 'chief' as const }, orchestration: { todoId: todo.id, state: 'running' as const, error: null } };
  expect(inflightOrchestrationFor([running], todo)?.id).toBe('chief-global');
  expect(inflightOrchestrationFor([running], { id: 'todo-other', seqNum: 1586 })).toBeNull();
});

test('a reported failed orchestration is not in flight', () => {
  const broken = { ...global, orchestration: { todoId: todo.id, state: 'failed' as const, error: reason } };
  expect(inflightOrchestrationFor([broken], todo)).toBeNull();
});

test('without the orchestration field the title match still decides, as before the global thread', () => {
  const titled = { ...failed, id: 'chief-titled', createdAt: 5, activeRun: { phase: 'chief' as const }, lastTurnError: undefined };
  expect(inflightOrchestrationFor([titled], todo)?.id).toBe('chief-titled');
});
