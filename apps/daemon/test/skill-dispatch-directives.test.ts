import { describe, expect, test } from 'vitest';
import { withSkillDispatchDirectives } from '../src/backend/skills.js';

describe('withSkillDispatchDirectives', () => {
  test('a prompt with no slash name is returned unchanged and logs nothing', () => {
    const logs: string[] = [];
    expect(
      withSkillDispatchDirectives('plain text', new Set(['deploy']), (msg) => logs.push(msg)),
    ).toBe('plain text');
    expect(logs).toEqual([]);
  });
});
