import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { createMentionRegistry, registerMention } from '../src/overlay/mention-display.js';
import { MentionHighlight } from '../src/overlay/mention-highlight.js';

describe('MentionHighlight', () => {
  it('renders list markers as subtle neutral grey markers while keeping other markdown syntax plain and mention chips styled', () => {
    const registry = createMentionRegistry();
    registerMention(registry, { kind: 'project', id: 'p1', label: 'X' });
    const text = [
      '1. 你好',
      '2. 测试',
      '10. 第十',
      '- 列表项',
      '# 标题',
      '> 引用',
      '`code` **粗体** @X',
    ].join('\n');

    const html = renderToStaticMarkup(
      createElement(MentionHighlight, {
        text,
        registry,
        textareaRef: { current: null },
      }),
    );

    const markers = [...html.matchAll(/<span[^>]*data-list-marker="(?:ordered|bullet)"[^>]*>/g)].map(
      (match) => match[0],
    );
    expect(markers).toHaveLength(4);
    for (const tag of markers) {
      expect(tag).toContain('text-content-secondary');
      expect(tag).toContain('bg-(--prose-code-fill)');
      expect(tag).toContain('rounded-(--cds-radius-xs)');
      expect(tag).not.toMatch(/--spot-soft|--spot-text-on-tint|inset-ring/);
    }

    expect(html).toContain('<span> 列表项\n# 标题\n&gt; 引用\n`code` **粗体** </span>');

    const mention = /<span[^>]*data-mention-kind="project"[^>]*>/.exec(html)?.[0];
    expect(mention).toBeDefined();
    expect(mention).toContain('bg-secondary text-content-secondary');
  });

  it('does not mark empty text, unspaced prefixes, or mid-line tokens as list markers', () => {
    const registry = createMentionRegistry();
    for (const text of ['', '1.无空格', '-无空格', '正文 1. 中间\n正文 - 中间']) {
      const html = renderToStaticMarkup(
        createElement(MentionHighlight, {
          text,
          registry,
          textareaRef: { current: null },
        }),
      );
      expect(html).not.toContain('data-list-marker=');
    }
  });
});
