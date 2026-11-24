import { describe, expect, test, vi } from 'vitest';
import { dockedQuestions, pendingQuestions } from '../src/board/needs-you.js';
import { questionOpenStep, type QuestionThreadView } from '../src/board/tasks-sections.js';
import { useDockedQuestion } from '../src/chief/chief-question.js';
import { originChiefQuestions } from '../src/chief/question-origin.js';
import type { ChiefStreamItem } from '../src/fixtures/records.js';

const root = vi.hoisted(() => ({ pendingQuestions: [] as ReturnType<typeof originChiefQuestions> }));
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  useContext: () => null,
  useSyncExternalStore: () => 0,
}));
vi.mock('../src/chief/chief-root.js', () => ({ useOptionalChiefRoot: () => root }));

type Question = Extract<ChiefStreamItem, { kind: 'question' }>;

const question = (requestId: string, over: Partial<Question> = {}): Question => ({
  kind: 'question',
  id: `row-${requestId}`,
  requestId,
  status: 'pending',
  questions: [
    {
      header: 'Scope',
      question: 'Which pages?',
      options: [{ label: 'Board only' }, { label: 'Everywhere' }],
    },
  ],
  answers: null,
  ...over,
});

const view = (stream: ChiefStreamItem[]): QuestionThreadView => ({
  threadId: 'thread-1',
  stream,
  hasEarlier: false,
  loadingEarlier: false,
  failedEarlier: false,
  dismissing: () => false,
});

describe('only a question the turn is still waiting on docks', () => {
  test('a pending question without parkedAt docks; a parked one does not but stays pending', () => {
    const parked = question('q-parked', { parkedAt: 1000 });
    const held = question('q-held');
    const stream: ChiefStreamItem[] = [parked, held];
    expect(pendingQuestions(stream)).toEqual([parked, held]);
    expect(dockedQuestions(stream)).toEqual([held]);
  });

  test('an older pending approval does not take the dock slot from a held question', () => {
    const approval = question('approval-pending', { parkedAt: 1000 });
    const held = question('q-held');
    const parked = question('q-parked', { parkedAt: 1000 });
    const stream = [approval, parked, held];
    root.pendingQuestions = originChiefQuestions(stream, {
      teamId: 'team-1',
      conversationId: 'thread-1',
      title: 'Dashboard export',
    });
    expect(useDockedQuestion()?.requestId).toBe(held.requestId);
    expect(dockedQuestions(stream)).toEqual([held]);
    expect(questionOpenStep({ requestId: approval.requestId, threadId: 'thread-1' }, view(stream))).toEqual({ kind: 'approval' });
    expect(questionOpenStep({ requestId: held.requestId, threadId: 'thread-1' }, view(stream))).toEqual({ kind: 'focus', at: 0 });
  });

  test('answered and cancelled questions never dock', () => {
    const stream: ChiefStreamItem[] = [
      question('q-answered', { status: 'answered' }),
      question('q-cancelled', { status: 'cancelled' }),
      question('q-parked', { parkedAt: 1 }),
      question('q-held'),
    ];
    expect(dockedQuestions(stream).map((item) => item.requestId)).toEqual(['q-held']);
  });
});

describe('opening a question from the tasks panel', () => {
  test('a docked question focuses its card by index', () => {
    const stream: ChiefStreamItem[] = [question('q-1'), question('q-2')];
    expect(questionOpenStep({ requestId: 'q-2', threadId: 'thread-1' }, view(stream))).toEqual({
      kind: 'focus',
      at: 1,
    });
  });

  test('a parked question scrolls to its inline card instead of claiming the dock', () => {
    const stream: ChiefStreamItem[] = [question('q-1'), question('q-2', { parkedAt: 9 })];
    expect(questionOpenStep({ requestId: 'q-2', threadId: 'thread-1' }, view(stream))).toEqual({
      kind: 'scroll',
      requestId: 'q-2',
    });
  });

  test('a parked question does not shift the focus index of docked ones', () => {
    const stream: ChiefStreamItem[] = [
      question('q-parked', { parkedAt: 9 }),
      question('q-1'),
      question('q-2'),
    ];
    expect(questionOpenStep({ requestId: 'q-2', threadId: 'thread-1' }, view(stream))).toEqual({
      kind: 'focus',
      at: 1,
    });
  });

  test('a settled question is missing when nothing earlier can load', () => {
    const stream: ChiefStreamItem[] = [question('q-1', { status: 'answered' })];
    expect(questionOpenStep({ requestId: 'q-1', threadId: 'thread-1' }, view(stream))).toEqual({
      kind: 'missing',
    });
  });
});
