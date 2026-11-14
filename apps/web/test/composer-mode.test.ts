import { describe, expect, test } from 'vitest';
import { composerMode } from '../src/chief/composer-mode.js';

const base = { questionPending: true, threadClaimed: false, quoteStaged: false };

describe('composerMode', () => {
  test('a pending question owns the composer by default', () => {
    expect(composerMode(base)).toBe('answer');
  });

  test('the thread owns it while the user claimed it or a quote is staged', () => {
    expect(composerMode({ ...base, threadClaimed: true })).toBe('thread');
    expect(composerMode({ ...base, quoteStaged: true })).toBe('thread');
    expect(composerMode({ ...base, threadClaimed: false, quoteStaged: true })).toBe('thread');
  });

  test('without a question here the thread always owns it', () => {
    expect(composerMode({ ...base, questionPending: false })).toBe('thread');
  });
});
