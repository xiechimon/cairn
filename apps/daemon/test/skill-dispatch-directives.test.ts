import { describe, expect, test } from 'vitest';
import { withSkillDispatchDirectives } from '../src/backend/skills.js';

function dispatch(prompt: string, visible: string[]) {
  const logs: string[] = [];
  const out = withSkillDispatchDirectives(prompt, new Set(visible), (msg) => logs.push(msg));
  return { out, logs };
}

describe('withSkillDispatchDirectives', () => {
  test('a prompt naming visible skills gets one load directive per skill, in order', () => {
    const prompt = '/review-pr first, then run /deploy and /review-pr again';
    const { out, logs } = dispatch(prompt, ['deploy', 'review-pr']);
    expect(out).toBe(
      [
        'Before proceeding, use the Skill tool to load "review-pr".',
        'Before proceeding, use the Skill tool to load "deploy".',
        '',
        prompt,
      ].join('\n'),
    );
    expect(logs).toEqual(['dispatch: /review-pr, /deploy']);
  });

  test('an unknown slash name is logged and the prompt is left alone', () => {
    const prompt = 'please /nonexistent this';
    const { out, logs } = dispatch(prompt, ['deploy']);
    expect(out).toBe(prompt);
    expect(logs).toEqual(['unknown-dispatch: nonexistent']);
  });

  test('path segments and URLs are not slash names', () => {
    const prompt = 'see docs/deploy, /usr/deploy/bin, src/deploy.ts and https://example.com/deploy';
    const { out, logs } = dispatch(prompt, ['deploy']);
    expect(out).toBe(prompt);
    expect(logs).toEqual([]);
  });

  test('a prompt with no slash name is returned unchanged and logs nothing', () => {
    const { out, logs } = dispatch('plain text', ['deploy']);
    expect(out).toBe('plain text');
    expect(logs).toEqual([]);
  });
});
