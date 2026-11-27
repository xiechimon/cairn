import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { createMentionRegistry, registerMention } from '../src/overlay/mention-display.js';
import { MentionHighlight } from '../src/overlay/mention-highlight.js';

describe('MentionHighlight', () => {
  it('renders list markers and markdown syntax as plain text while keeping entity mention chips styled', () => {
    const registry = createMentionRegistry();
    registerMention(registry, { kind: 'project', id: 'p1', label: 'X' });
    const text = [
      '1. 你好',
      '2. 测试',
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
    expect(markers).toHaveLength(3);
    for (const tag of markers) {
      expect(tag).not.toMatch(/\bclass=/);
      expect(tag).not.toMatch(/bg-|text-\(--spot|inset-ring|rounded-/);
    }

    expect(html).toContain('<span> 列表项\n# 标题\n&gt; 引用\n`code` **粗体** </span>');

    const mention = /<span[^>]*data-mention-kind="project"[^>]*>/.exec(html)?.[0];
    expect(mention).toBeDefined();
    expect(mention).toContain('bg-secondary text-content-secondary');
  });
});
