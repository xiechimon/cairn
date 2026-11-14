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

  test('a report reads source and separates its own choices from the owner decisions', () => {
    const prompt = researchPrompt({ tier: 1, title: 'Queue', question: 'Which queue fits?' });
    expect(prompt).toContain('读相关源码');
    expect(prompt).toContain('「我已自行决定」');
    expect(prompt).toContain('「需要你定的」');
  });

  test('an empty intake still requires checking dependency releases', () => {
    const question = researchIntakeQuestion({ openThreadTitles: [], previousItems: [] });
    expect(question).toContain('至少检查 5 个直接依赖');
    expect(question).toContain('只有完成上述检索后');
  });

  test('the source audit goes before the final intake JSON block', () => {
    const question = researchIntakeQuestion({ openThreadTitles: [], previousItems: [] });
    const prompt = researchPrompt({ tier: 2, title: 'Daily intake', question });
    expect(prompt).toContain('引用清单放在最终 JSON 代码块之前');
  });
});
