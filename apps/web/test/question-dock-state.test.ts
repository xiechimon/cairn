import { describe, expect, test, vi } from 'vitest';
import {
  answerKeyOf,
  draftKeyOfAnswer,
  questionDockState,
} from '../src/chief/question-dock-state.js';

describe('question dock state', () => {
  test('an answer key maps back to its request draft key, even when the draft key holds #', () => {
    const draftKey = JSON.stringify(['t1', 'chief#1', 'ask-1']);
    expect(draftKeyOfAnswer(answerKeyOf(draftKey, 2))).toBe(draftKey);
  });

  test('clearing a request closes it and drops its answers', () => {
    const draftKey = JSON.stringify(['t1', 'chief', 'ask-closed']);
    questionDockState.setAnswerText(answerKeyOf(draftKey, 0), 'typed');
    expect(questionDockState.isClosed(draftKey)).toBe(false);
    questionDockState.clearAnswers(draftKey);
    expect(questionDockState.isClosed(draftKey)).toBe(true);
    expect(questionDockState.answerText(answerKeyOf(draftKey, 0))).toBe('');
  });

  test('upload state follows its request through concurrent uploads and unrelated completions', () => {
    questionDockState.beginUpload('request-a');
    questionDockState.beginUpload('request-a');
    questionDockState.beginUpload('request-b');
    try {
      expect(questionDockState.uploading('request-a')).toBe(true);
      expect(questionDockState.uploading('request-b')).toBe(true);
      expect(questionDockState.uploading('request-c')).toBe(false);
      questionDockState.endUpload('request-c');
      questionDockState.endUpload('request-a');
      expect(questionDockState.uploading('request-a')).toBe(true);
      questionDockState.endUpload('request-a');
      expect(questionDockState.uploading('request-a')).toBe(false);
      expect(questionDockState.uploading()).toBe(true);
      questionDockState.endUpload('request-b');
      expect(questionDockState.uploading()).toBe(false);
    } finally {
      questionDockState.endUpload('request-a');
      questionDockState.endUpload('request-a');
      questionDockState.endUpload('request-b');
    }
  });

  test('uploading stays on until every started upload settles', () => {
    questionDockState.beginUpload('request');
    questionDockState.beginUpload('request');
    questionDockState.endUpload('request');
    expect(questionDockState.uploading()).toBe(true);
    questionDockState.endUpload('request');
    expect(questionDockState.uploading()).toBe(false);
    questionDockState.endUpload('request');
    expect(questionDockState.uploading()).toBe(false);
  });

  test('opening an approval does not move the question dock or expand its card', () => {
    questionDockState.collapse('held-question');
    const before = questionDockState.focus();
    const listener = vi.fn();
    const stop = questionDockState.subscribe(listener);
    questionDockState.revealApproval('approval-1');
    const first = questionDockState.approvalReveal();
    expect(first).toEqual({ requestId: 'approval-1' });
    expect(questionDockState.focus()).toBe(before);
    expect(questionDockState.isCollapsed('held-question')).toBe(true);
    questionDockState.revealApproval('approval-1');
    expect(questionDockState.approvalReveal()).not.toBe(first);
    expect(listener).toHaveBeenCalledTimes(2);
    stop();
  });

  test('focus does not move while an answer upload is in flight', () => {
    questionDockState.setFocus(0);
    questionDockState.beginUpload('request');
    questionDockState.setFocus(1);
    expect(questionDockState.focus()).toBe(0);
    questionDockState.endUpload('request');
    questionDockState.setFocus(1);
    expect(questionDockState.focus()).toBe(1);
    questionDockState.setFocus(0);
  });
});
