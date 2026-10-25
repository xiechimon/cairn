import type { AgentTodo, BuildRecord, StepJournalRow } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { mapTranscript } from '../src/api/mappers.js';
import type { TodoRecord, TranscriptItem } from '../src/fixtures/records.js';
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

function runningStep(id: string): StepJournalRow {
  return {
    id,
    buildId: BUILD.id,
    kind: 'build',
    machineId: null,
    createdAt: NOW - 30_000,
    status: 'claimed',
    checkpointCommit: null,
    skillInjection: null,
  };
}

function todoUpdate(stepId: string, items: { text: string; state: 'todo' | 'doing' | 'done' }[]) {
  return { stepId, at: NOW - 1_000, items } as AgentTodo;
}

function render(overrides: {
  steps?: StepJournalRow[];
  agentTodo?: AgentTodo | null;
  build?: BuildRecord | null;
}): TranscriptItem[] {
  return mapTranscript({
    messages: [],
    steps: overrides.steps ?? [],
    plans: [],
    build: overrides.build === undefined ? BUILD : overrides.build,
    todo: todo(9, 'building') as TodoRecord,
    machineName: null,
    userName: 'Xmon Dai',
    liveText: '',
    ...(overrides.agentTodo !== undefined ? { agentTodo: overrides.agentTodo } : {}),
  });
}

function todoItems(items: TranscriptItem[]) {
  return items.filter(
    (i): i is Extract<TranscriptItem, { kind: 'agent-todo' }> => i.kind === 'agent-todo',
  );
}

describe('mapTranscript agent todo list (#1524)', () => {
  test('running todo list → agent-todo row, before the streaming row', () => {
    const items = render({
      steps: [runningStep('s1')],
      agentTodo: todoUpdate('s1', [
        { text: '通读 poteto 的推文观点', state: 'todo' },
        { text: '开票沉淀注释规则', state: 'doing' },
        { text: '查 pi 模型上下文是不是都 1M', state: 'done' },
      ]),
    });
    const rows = todoItems(items);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.items).toEqual([
      { text: '通读 poteto 的推文观点', state: 'todo' },
      { text: '开票沉淀注释规则', state: 'doing' },
      { text: '查 pi 模型上下文是不是都 1M', state: 'done' },
    ]);
    const cardIndex = items.findIndex((i) => i.kind === 'agent-todo');
    const streamingIndex = items.findIndex((i) => i.kind === 'streaming');
    expect(streamingIndex).toBeGreaterThan(cardIndex);
  });

  test('stepId mismatch (stale step list) → no row produced', () => {
    const items = render({
      steps: [runningStep('s1')],
      agentTodo: todoUpdate('s-old', [{ text: '旧清单', state: 'todo' }]),
    });
    expect(todoItems(items)).toHaveLength(0);
  });

  test('not running → no row (the list only appears at the live tail)', () => {
    const items = render({
      steps: [{ ...runningStep('s1'), status: 'done' }],
      agentTodo: todoUpdate('s1', [{ text: '收尾清单', state: 'done' }]),
    });
    expect(todoItems(items)).toHaveLength(0);
  });

  test('no signal (old server / fixture capture) → no row, zero noise', () => {
    expect(todoItems(render({ steps: [runningStep('s1')], agentTodo: null }))).toHaveLength(0);
    expect(todoItems(render({ steps: [runningStep('s1')] }))).toHaveLength(0);
  });

  test('empty list produces no row', () => {
    const items = render({
      steps: [runningStep('s1')],
      agentTodo: todoUpdate('s1', []),
    });
    expect(todoItems(items)).toHaveLength(0);
  });
});
