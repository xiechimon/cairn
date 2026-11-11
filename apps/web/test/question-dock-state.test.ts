import { describe, expect, test } from 'vitest';
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

  test('uploading stays on until every started upload settles', () => {
    questionDockState.beginUpload();
    questionDockState.beginUpload();
    questionDockState.endUpload();
    expect(questionDockState.uploading()).toBe(true);
    questionDockState.endUpload();
    expect(questionDockState.uploading()).toBe(false);
    questionDockState.endUpload();
    expect(questionDockState.uploading()).toBe(false);
  });

  test('a reveal bumps the reveal count and notifies subscribers', () => {
    let heard = 0;
    const stop = questionDockState.subscribe(() => {
      heard += 1;
    });
    const before = questionDockState.reveals();
    questionDockState.reveal();
    expect(questionDockState.reveals()).toBe(before + 1);
    expect(heard).toBe(1);
    stop();
  });
});
