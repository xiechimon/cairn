import { describe, expect, test } from 'vitest';
import { chartTableMarkdown } from '../src/records/chat-chart.js';

describe('chartTableMarkdown', () => {
  test('escapes backslashes before pipes and flattens newlines in cells', () => {
    const markdown = chartTableMarkdown({
      type: 'bar',
      title: 'A\\|B',
      categories: ['row\\|1\nnext'],
      series: [{ name: 'val\\|x', values: [42] }],
    });
    expect(markdown).toContain('**A\\\\\\|B**');
    expect(markdown).toContain('|  | val\\\\\\|x |');
    expect(markdown).toContain('| row\\\\\\|1 next | 42 |');
  });
});
