import { describe, expect, test } from 'vitest';
import {
  mapChiefStream,
  mapTranscript,
  type MessageRow,
  type TranscriptInput,
} from '../src/api/mappers.js';
import { chiefTurns, groupTurns, transcriptTurns } from '../src/lib/turn-fold.js';
import { todo } from './helpers.js';

const START = 1_000;
const FINISH = 241_000;
const OPENING: MessageRow = {
  id: 'opening',
  role: 'user',
  content: 'Investigate the timeout',
  createdAt: START,
};
const TOOL: MessageRow = {
  id: 'tool',
  role: 'assistant',
  content: {
    kind: 'toolcall',
    call: { id: 'call', name: 'bash', arguments: { command: 'true' }, result: 'done' },
  },
  createdAt: START + 1_000,
};
const BUILD = {
  id: 'build',
  todoId: 'todo',
  withPlan: false,
  prevPhase: null,
  triggerSource: 'user',
  planDocId: null,
  errorMessage: null,
  prUrl: null,
  prNumber: null,
  diffHash: null,
  createdAt: START,
} as const;

describe.each([false, true])('terminal timestamps with a preceding tool: %s', (withTool) => {
  test.each(['plan', 'review', 'verify', 'report', 'fail'] as const)(
    '%s completion supplies the full duration',
    (kind) => {
      const input: TranscriptInput = {
        messages: [OPENING, ...(withTool ? [TOOL] : [])],
        steps: [],
        plans: [],
        build: null,
        todo: { ...todo(12, 'done'), phaseAt: FINISH },
        machineName: null,
        userName: 'User',
        liveText: '',
      };
      if (kind === 'plan') {
        input.steps = [{
          id: 'plan-step', buildId: 'build', kind: 'plan', machineId: null,
          createdAt: START, status: 'done', checkpointCommit: null, skillInjection: null,
        }];
        input.plans = [{
          id: 'plan', buildId: 'build', version: 1, content: '# Plan', createdAt: FINISH,
        }];
      } else if (kind === 'fail') {
        input.build = { ...BUILD, errorMessage: 'Timed out' };
        input.todo = { ...input.todo, phase: 'failed' };
      } else {
        const content = kind === 'review'
          ? { kind: 'review_verdict', verdict: { conclusion: 'Ready', findings: [] } }
          : kind === 'verify'
            ? { kind: 'verify_verdict', verdict: { passed: true, conclusion: 'Passed', evidence: [] } }
            : { kind: 'info-report', attachmentId: 'report', attachmentToken: 'report.md', content: 'Done' };
        input.messages.push({
          id: 'terminal', role: 'system', content: JSON.stringify(content), createdAt: FINISH,
        });
      }
      const items = mapTranscript(input);
      expect(items.find((item) => item.kind === kind)).toMatchObject({ createdAt: FINISH });
      expect(groupTurns(items, transcriptTurns).find((segment) => segment.kind === 'turn'))
        .toMatchObject({ turn: { seconds: 240, status: kind === 'fail' ? 'failed' : 'done' } });
    },
  );
});

test('a synthetic confirmation supplies the real build-step start time', () => {
  const items = mapTranscript({
    messages: [{ id: 'reply', role: 'assistant', content: 'Finished', createdAt: FINISH }],
    steps: [{
      id: 'build-step', buildId: 'build', kind: 'build', machineId: null,
      createdAt: START, status: 'done', checkpointCommit: null, skillInjection: null,
    }],
    plans: [], build: { ...BUILD, withPlan: true }, todo: todo(12, 'done'),
    machineName: null, userName: 'User', liveText: '',
  });
  expect(groupTurns(items, transcriptTurns).find((segment) => segment.kind === 'turn'))
    .toMatchObject({ turn: { seconds: 240 } });
});

test.each(['error', 'stopped'] as const)('Coordinator %s completion retains its timestamp', (kind) => {
  const content = kind === 'error'
    ? { kind: 'chief_turn_error', message: 'Timed out' }
    : { kind: 'chief_turn_stopped', todos: [] };
  const items = mapChiefStream([
    OPENING,
    { id: 'terminal', role: 'system', content: JSON.stringify(content), createdAt: FINISH },
  ]);
  expect(items.find((item) => item.kind === kind)).toMatchObject({ createdAt: FINISH });
  const rows = items.map((item, i) => ({ item, i }));
  expect(groupTurns(rows, chiefTurns).find((segment) => segment.kind === 'turn'))
    .toMatchObject({ turn: { seconds: 240 } });
});
