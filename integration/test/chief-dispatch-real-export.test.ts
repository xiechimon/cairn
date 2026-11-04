import { describe, expect, test } from 'vitest';
import { selectTriggeringUserPrompt } from '../eval/chief-dispatch-real/export.mts';

describe('chief-dispatch-real export triggering request', () => {
  test('associates a dispatch with the latest user message at or before dispatch time', () => {
    const prompt = selectTriggeringUserPrompt(
      [
        { role: 'user', content: 'first unrelated request', createdAt: 100 },
        { role: 'assistant', content: 'ok', createdAt: 150 },
        { role: 'user', content: 'please fix the settings page dark mode', createdAt: 200 },
        { role: 'assistant', content: 'dispatching', createdAt: 250 },
        { role: 'user', content: 'later unrelated request', createdAt: 400 },
      ],
      300,
    );
    expect(prompt).toBe('please fix the settings page dark mode');
  });

  test('excludes cases when no triggering user message can be recovered', () => {
    expect(
      selectTriggeringUserPrompt(
        [
          { role: 'assistant', content: 'only assistant', createdAt: 100 },
          { role: 'user', content: 'arrives after dispatch', createdAt: 500 },
        ],
        300,
      ),
    ).toBeNull();
    expect(selectTriggeringUserPrompt([], 300)).toBeNull();
  });
});
