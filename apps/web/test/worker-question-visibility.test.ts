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
    todo: todo(1, 'review', true),
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

function wire(awaiting?: boolean) {
  return {
    ...todo(1, 'review', awaiting),
    assignment: null,
    sourceKind: null,
    sourceRef: null,
    createdBy: null,
    ownerId: null,
    sourceBuildId: null,
    owner: null,
    output: 'code' as const,
  };
}

test('display todo keeps awaitingReply', () => {
  expect(toDisplayTodo(wire(true)).awaitingReply).toBe(true);
  expect(toDisplayTodo(wire()).awaitingReply).toBeUndefined();
});
