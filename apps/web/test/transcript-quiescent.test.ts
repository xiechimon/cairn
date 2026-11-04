import type { BuildRecord, StepJournalRow } from '@cairn/shared';
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

function step(status: StepJournalRow['status'], kind: StepJournalRow['kind'] = 'build'): StepJournalRow {
  return {
    id: `step-${kind}-${status}`,
    buildId: BUILD.id,
    kind,
    machineId: null,
    createdAt: NOW - 30_000,
    status,
    checkpointCommit: null,
    skillInjection: null,
  };
}

function render(overrides: {
  todo: TodoRecord;
  steps?: StepJournalRow[];
  build?: BuildRecord | null;
  stopping?: boolean;
}): TranscriptItem[] {
  return mapTranscript({
    messages: [],
    steps: overrides.steps ?? [],
    plans: [],
    build: overrides.build === undefined ? BUILD : overrides.build,
    todo: overrides.todo,
    machineName: null,
    userName: 'Xmon Dai',
    liveText: '',
    ...(overrides.stopping !== undefined ? { stopping: overrides.stopping } : {}),
  });
}

function streamingRows(items: TranscriptItem[]) {
  return items.filter((i): i is Extract<TranscriptItem, { kind: 'streaming' }> => i.kind === 'streaming');
}

describe('mapTranscript quiescent live tail (#471)', () => {
  test('F8: building with only finished steps hangs the spinner + static label tail', () => {
    const items = render({ todo: todo(9, 'building'), steps: [step('done')] });
    const last = items[items.length - 1];
    expect(last).toMatchObject({ kind: 'streaming', label: '执行中...' });
    // F12: no seconds counter — the gap has no stream events to re-render
    // it, a frozen count would lie.
    if (last?.kind !== 'streaming') throw new Error('tail is not a streaming row');
    expect(last.seconds).toBeUndefined();
  });

  test('F8: building with an empty step queue hangs the tail too', () => {
    const items = render({ todo: todo(9, 'building'), steps: [] });
    expect(streamingRows(items)).toEqual([{ kind: 'streaming', label: '执行中...' }]);
  });

  test('F9: an active step keeps exactly one streaming tail (`处理中...`, with seconds)', () => {
    const items = render({ todo: todo(9, 'building'), steps: [step('done'), step('claimed')] });
    const rows = streamingRows(items);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.label).toBe('处理中...');
    // F18 (#873): the live row carries the step's START STAMP, not a number
    // computed at projection time — only the stamp keeps ticking.
    expect(rows[0]?.startedAt).toBe(step('claimed').createdAt);
    expect(rows[0]?.seconds).toBeUndefined();
  });

  test('F10: phases past building hang no live tail', () => {
    for (const phase of ['todo', 'queued', 'planning', 'confirm', 'review', 'done', 'failed'] as const) {
      const items = render({ todo: todo(9, phase), steps: [step('done')] });
      expect(streamingRows(items), `phase ${phase}`).toHaveLength(0);
    }
  });

  test('F11: no build, no tail', () => {
    const items = render({ todo: todo(9, 'building'), build: null, steps: [] });
    expect(streamingRows(items)).toHaveLength(0);
  });

  test('F14: stopping with an active step still reads `正在停止…`', () => {
    const items = render({ todo: todo(9, 'building'), steps: [step('claimed')], stopping: true });
    expect(streamingRows(items).map((r) => r.label)).toEqual(['正在停止…']);
  });

  test('F14b: stopping with no active step falls back to the quiescent tail', () => {
    const items = render({ todo: todo(9, 'building'), steps: [step('done')], stopping: true });
    expect(streamingRows(items).map((r) => r.label)).toEqual(['执行中...']);
  });

  test('F17: a stopped run hangs no `执行中...` tail', () => {
    const items = render({ todo: todo(9, 'building'), steps: [step('stopped')] });
    expect(streamingRows(items)).toHaveLength(0);
  });
});
