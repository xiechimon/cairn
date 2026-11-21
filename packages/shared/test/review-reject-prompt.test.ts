import { describe, expect, test } from 'vitest';
import { buildReplanPrompt, buildReviewRejectPrompt } from '../src/records/prompts.js';

const FEEDBACK = '关闭按钮挪到左边，文案改成「返回」';

describe('buildReviewRejectPrompt (#701 review-gate rejection continuation-round instruction)', () => {
  test('FM2: feedback embedded verbatim', () => {
    expect(buildReviewRejectPrompt(FEEDBACK)).toContain(FEEDBACK);
  });

  test('FM3: the instruction says existing changes stay on the session branch, not discarded', () => {
    const prompt = buildReviewRejectPrompt(FEEDBACK);
    expect(prompt).toContain('会话分支');
  });

  test('FM4: wording differs from the confirm-gate rejection template (different facts, different wording)', () => {
    expect(buildReviewRejectPrompt(FEEDBACK)).not.toBe(buildReplanPrompt(FEEDBACK));
  });
});
