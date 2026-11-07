import { afterEach, describe, expect, test } from 'vitest';
import {
  applyQuestionPick,
  emptyQuestionDrafts,
  questionActionThread,
  questionDraftKey,
  questionDraftStore,
  questionSubmitStore,
} from '../src/chief/question-drafts.js';
import { originChiefQuestions } from '../src/chief/question-origin.js';

afterEach(() => {
  questionDraftStore.clearAll();
  questionSubmitStore.clearAll();
});

const questions = [
  {
    options: [{ label: 'Active only' }, { label: 'Include archived' }],
  },
  {
    multiSelect: true,
    options: [{ label: 'CSV' }, { label: 'JSON' }],
  },
  { options: [] },
];

describe('Coordinator question drafts stay on their own request', () => {
  test('a key keeps team, conversation and request apart when ids contain separators', () => {
    const first = questionDraftKey({
      teamId: 'team:a',
      conversationId: 'conv',
      requestId: 'q1',
    });
    const second = questionDraftKey({
      teamId: 'team',
      conversationId: 'a:conv',
      requestId: 'q1',
    });
    expect(first).not.toBe(second);
  });

  test('another team or request cannot read a filled draft', () => {
    const key = questionDraftKey({ teamId: 't1', conversationId: 'c1', requestId: 'q1' });
    const drafts = applyQuestionPick(emptyQuestionDrafts(questions), 0, questions[0]!, 0);
    questionDraftStore.set(key, { drafts, step: 1 });
    expect(
      questionDraftStore.get(
        questionDraftKey({ teamId: 't2', conversationId: 'c1', requestId: 'q1' }),
      ),
    ).toBeUndefined();
    expect(
      questionDraftStore.get(
        questionDraftKey({ teamId: 't1', conversationId: 'c1', requestId: 'q2' }),
      ),
    ).toBeUndefined();
    expect(questionDraftStore.get(key)?.step).toBe(1);
    expect(questionDraftStore.get(key)?.drafts[0]).toEqual({
      kind: 'choices',
      picked: ['Active only'],
      other: false,
      otherText: '',
    });
  });

  test('a failed submit keeps the draft and only clears the in-flight flag', () => {
    const key = questionDraftKey({ teamId: 't1', conversationId: 'c1', requestId: 'q1' });
    const drafts = emptyQuestionDrafts(questions);
    drafts[2] = { kind: 'text', value: 'also the changelog' };
    questionDraftStore.set(key, { drafts, step: 2 });
    questionSubmitStore.patch(key, { submitting: true });
    questionSubmitStore.patch(key, {
      submitting: false,
      error: 'Could not send your answer. Your draft is still here. Try Submit again.',
    });
    const stored = questionDraftStore.get(key);
    expect(questionSubmitStore.get(key).submitting).toBe(false);
    expect(stored?.step).toBe(2);
    expect(stored?.drafts[2]).toEqual({ kind: 'text', value: 'also the changelog' });
    expect(questionSubmitStore.get(key).error).toContain('draft is still here');
  });

  test('submission state exists without any draft record', () => {
    const key = questionDraftKey({ teamId: 't1', conversationId: 'c1', requestId: 'q9' });
    expect(questionDraftStore.get(key)).toBeUndefined();
    questionSubmitStore.patch(key, { submitting: true });
    expect(questionSubmitStore.get(key).submitting).toBe(true);
    expect(questionDraftStore.get(key)).toBeUndefined();
  });

  test('clearing one request leaves the other', () => {
    const first = questionDraftKey({ teamId: 't1', conversationId: 'c1', requestId: 'q1' });
    const second = questionDraftKey({ teamId: 't1', conversationId: 'c1', requestId: 'q2' });
    questionDraftStore.set(first, {
      drafts: emptyQuestionDrafts(questions),
      step: 1,
    });
    questionDraftStore.set(second, {
      drafts: emptyQuestionDrafts(questions.slice(0, 1)),
      step: 0,
    });
    questionDraftStore.clear(first);
    expect(questionDraftStore.get(first)).toBeUndefined();
    expect(questionDraftStore.get(second)?.step).toBe(0);
  });
});

describe('answer and cancel bind to the originating conversation', () => {
  test('an explicit origin thread wins over whichever thread is active', () => {
    expect(questionActionThread('chief-origin', 'chief-active')).toBe('chief-origin');
  });

  test('a missing origin falls back to the active thread', () => {
    expect(questionActionThread(undefined, 'chief-active')).toBe('chief-active');
    expect(questionActionThread(undefined, null)).toBeNull();
  });
});

describe('the pending set is request status, not presentation', () => {
  test('only pending questions become header entries', () => {
    const pending = originChiefQuestions(
      [
        {
          kind: 'question',
          id: 'a',
          requestId: 'q-pending',
          status: 'pending',
          answers: null,
          questions: [{ header: 'h', question: 'Which first?', options: [{ label: 'A' }] }],
        },
        {
          kind: 'question',
          id: 'b',
          requestId: 'q-done',
          status: 'answered',
          answers: [{ header: 'h', choices: ['A'] }],
          questions: [{ header: 'h', question: 'Which first?', options: [{ label: 'A' }] }],
        },
        {
          kind: 'question',
          id: 'c',
          requestId: 'q-cancel',
          status: 'cancelled',
          answers: null,
          questions: [{ header: 'h', question: 'Which first?', options: [{ label: 'A' }] }],
        },
      ],
      { teamId: 't1', conversationId: 'chief-origin', title: 'Coordinator' },
    );
    expect(pending).toEqual([
      expect.objectContaining({
        teamId: 't1',
        conversationId: 'chief-origin',
        origin: 'Coordinator',
        item: expect.objectContaining({ requestId: 'q-pending', status: 'pending' }),
      }),
    ]);
  });
});
