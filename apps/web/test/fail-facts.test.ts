import { describe, expect, test } from 'vitest';
import { failFactsText } from '../src/detail/fail-facts.js';

const t = (key: string, vars?: Record<string, string | number>) =>
  key.replace(/\{(\w+)\}/g, (_m, name: string) => String(vars?.[name]));

describe('failed step facts', () => {
  test('an info-card step that never opens a PR does not announce the missing PR', () => {
    expect(failFactsText({ files: null, commits: [], pr: null }, t)).toBe('');
    expect(failFactsText({ files: 2, commits: ['a1cfe71e8'], pr: null }, t)).not.toMatch(/PR/);
    expect(failFactsText({ files: null, commits: [], pr: 7 }, t)).toBe('PR #7');
  });
});
