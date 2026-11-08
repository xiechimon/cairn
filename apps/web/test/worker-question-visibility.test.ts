import { expect, test } from 'vitest';
import { mapTranscript, toDisplayTodo } from '../src/api/mappers.js';
import { NOW, todo } from './helpers.js';

const QUESTION = {
  kind: 'ask_user_question',
  requestId: 'ask-12345678',
  status: 'pending',
  questions: [
    {
      header: 'Format',
      question: 'Which export format?',
      options: [{ label: 'CSV' }, { label: 'JSON', description: 'machine readable' }],
    },
  ],
  answers: null,
};

test('worker question rows reach the task transcript', () => {
  const items = mapTranscript({
    messages: [{ id: 'ask-12345678', role: 'assistant', content: QUESTION, createdAt: NOW }],
    steps: [],
    plans: [],
    build: null,
    todo: todo(1, 'needs_input'),
    machineName: null,
    userName: 'u',
    liveText: '',
  });
  expect(items).toContainEqual(
    expect.objectContaining({
      kind: 'question',
      requestId: 'ask-12345678',
      status: 'pending',
    }),
  );
});

test('an escalated worker question carries its class, the full default answer and the apply time to the card', () => {
  const longDefault = `Keep the free plan. ${'Explain the limits to the team. '.repeat(10)}`;
  const items = mapTranscript({
    messages: [
      {
        id: 'ask-12345678',
        role: 'assistant',
        content: {
          ...QUESTION,
          escalation: {
            class: 'other',
            defaultAnswer: longDefault,
            at: NOW,
            applyAt: NOW + 1_800_000,
          },
        },
        createdAt: NOW,
      },
    ],
    steps: [],
    plans: [],
    build: null,
    todo: todo(1, 'needs_input'),
    machineName: null,
    userName: 'u',
    liveText: '',
  });
  expect(items).toContainEqual(
    expect.objectContaining({
      kind: 'question',
      escalation: { class: 'other', defaultAnswer: longDefault, applyAt: NOW + 1_800_000 },
    }),
  );
});

function wire() {
  return {
    ...todo(1, 'needs_input'),
    assignment: null,
    sourceKind: null,
    sourceRef: null,
    createdBy: null,
    ownerId: null,
    sourceBuildId: null,
    output: 'code' as const,
  };
}

test('display todo keeps the needs_input phase', () => {
  expect(toDisplayTodo(wire()).phase).toBe('needs_input');
});
