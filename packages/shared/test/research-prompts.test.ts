import { describe, expect, test } from 'vitest';
import { researchPrompt } from '../src/records/research-prompts.js';

describe('research search requirements', () => {
  test.each([1, 2] as const)(
    'tier %i requires fetched sources and rejects a run with no retrieval',
    (tier) => {
      const prompt = researchPrompt({ tier, title: 'Queue', question: 'Which queue fits?' });
      expect(prompt).toContain('没有实际搜索或抓取页面就视为调研失败');
      expect(prompt).toContain('列出每个实际抓取的 URL 和抓取日期');
      expect(prompt).toContain(tier === 1 ? '至少 3 次搜索或抓取' : '至少 5 次子搜索');
    },
  );

  test('a report reads source and separates its own choices from the owner decisions', () => {
    const prompt = researchPrompt({ tier: 1, title: 'Queue', question: 'Which queue fits?' });
    expect(prompt).toContain('必须由人决定的问题');
    expect(prompt).toContain('ask_user');
  });
});
