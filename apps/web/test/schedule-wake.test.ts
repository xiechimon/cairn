import { transcriptPromptRowId, type BuildRecord } from '@cairn/shared';
import { expect, test } from 'vitest';
import { mapTranscript } from '../src/api/mappers.js';
import { NOW, todo } from './helpers.js';

const build: BuildRecord = {
  id: 'existing-build',
  todoId: 'todo-1',
  withPlan: false,
  prevPhase: 'done',
  triggerSource: 'user',
  planDocId: null,
  errorMessage: null,
  prUrl: null,
  prNumber: null,
  diffHash: null,
  createdAt: NOW - 10_000,
};

function render(status: 'done' | 'claimed' | 'failed') {
  return mapTranscript({
    build,
    todo: todo(1, status === 'claimed' ? 'building' : status === 'failed' ? 'failed' : 'review'),
    steps: [
      {
        id: 'wake-step',
        buildId: build.id,
        kind: 'build',
        status,
        machineId: null,
        checkpointCommit: null,
        skillInjection: null,
        createdAt: NOW,
      },
    ],
    messages: [
      { id: 'previous', role: 'assistant', content: 'Previous result', createdAt: NOW - 5000 },
      {
        id: 'wake',
        role: 'system',
        content: JSON.stringify({ kind: 'schedule-wake', stepId: 'wake-step' }),
        createdAt: NOW,
      },
      {
        id: transcriptPromptRowId('wake-step'),
        role: 'user',
        content: 'Scheduled follow-up you set earlier:\n\nCheck again',
        createdAt: NOW + 1,
      },
      { id: 'result', role: 'assistant', content: 'Scheduled result', createdAt: NOW + 1000 },
    ],
    plans: [],
    machineName: null,
    userName: 'Owner',
    liveText: '',
  });
}

test('a completed scheduled turn has a wake marker, folded turn and completion without a user bubble', () => {
  const items = render('done');
  expect(items.map((item) => item.kind)).toEqual([
    'run',
    'robot',
    'scheduled',
    'scheduled-turn',
    'automation-completed',
  ]);
  expect(items.filter((item) => item.kind === 'user')).toEqual([]);
  expect(JSON.stringify(items)).toContain('Previous result');
  expect(JSON.stringify(items)).toContain('Scheduled result');
});

test.each(['claimed', 'failed'] as const)(
  '%s scheduled turns do not report completion',
  (status) => {
    const items = render(status);
    expect(items.some((item) => item.kind === 'scheduled')).toBe(true);
    expect(items.some((item) => String(item.kind) === 'automation-completed')).toBe(false);
    expect(items.filter((item) => item.kind === 'user')).toEqual([]);
  },
);
