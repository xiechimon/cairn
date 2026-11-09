import { describe, expect, test } from 'vitest';
import { mapTranscript, type TranscriptInput } from '../src/api/mappers.js';
import { todo } from './helpers.js';

const PLAN_STEP_AT = 1_000;
const BUILD_STEP_AT = 2_000;
const PAGE_START = 50_000;

const input = (hasEarlier: boolean): TranscriptInput => ({
  messages: [
    { id: 'newest-1', role: 'assistant', content: 'Still working', createdAt: PAGE_START },
    { id: 'newest-2', role: 'assistant', content: 'Done', createdAt: PAGE_START + 1_000 },
  ],
  steps: [
    {
      id: 'plan-step',
      buildId: 'build',
      kind: 'plan',
      machineId: null,
      createdAt: PLAN_STEP_AT,
      status: 'done',
      checkpointCommit: null,
      skillInjection: null,
    },
    {
      id: 'build-step',
      buildId: 'build',
      kind: 'build',
      machineId: null,
      createdAt: BUILD_STEP_AT,
      status: 'done',
      checkpointCommit: null,
      skillInjection: null,
    },
  ],
  plans: [{ id: 'plan-1', buildId: 'build', version: 1, createdAt: PLAN_STEP_AT, content: '# Plan' }],
  build: {
    id: 'build',
    todoId: 'todo',
    withPlan: true,
    prevPhase: null,
    triggerSource: 'user',
    planDocId: null,
    errorMessage: null,
    prUrl: null,
    prNumber: null,
    diffHash: null,
    createdAt: PLAN_STEP_AT,
  },
  todo: todo(12, 'done'),
  machineName: null,
  userName: 'User',
  liveText: '',
  hasEarlier,
});

const kinds = (hasEarlier: boolean) => mapTranscript(input(hasEarlier)).map((item) => item.kind);

describe('mapTranscript keeps synthetic rows inside the loaded page', () => {
  test('older plan and confirmation rows wait until their part of the history is loaded', () => {
    expect(kinds(true)).not.toContain('plan');
    expect(kinds(true)).not.toContain('user');
    expect(kinds(true)).not.toContain('run');
  });

  test('the full history keeps the run, plan and confirmation rows', () => {
    expect(kinds(false)).toEqual(expect.arrayContaining(['run', 'plan', 'user']));
  });
});
