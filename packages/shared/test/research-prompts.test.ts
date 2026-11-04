import { describe, expect, test } from 'vitest';
import { researchIntakeQuestion, researchPrompt } from '../src/records/research-prompts.js';

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

  test('an empty intake still requires checking dependency releases', () => {
    const question = researchIntakeQuestion({ openThreadTitles: [], previousItems: [] });
    expect(question).toContain('至少检查 5 个直接依赖');
    expect(question).toContain('只有完成上述检索后');
  });
});
