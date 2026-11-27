import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, test } from 'vitest';
import { ChatMarkdown } from '../src/detail/chat-markdown.js';
import { I18nProvider } from '../src/i18n/provider.js';

function renderMarkdown(text: string): string {
  const tree: ReactNode = createElement(MemoryRouter, {
    children: createElement(I18nProvider, {
      initialLocale: 'zh',
      children: createElement(ChatMarkdown, { text }),
    }),
  });
  return renderToStaticMarkup(tree);
}

describe('MarkdownTable Option A layout (C46)', () => {
  test('wraps cells inside a w-max table with 16rem cell wrap limit and bubble-local horizontal scroll', () => {
    const html = renderMarkdown(
      [
        '| 作者 | 合计 | 说明 |',
        '| --- | ---: | --- |',
        '| xiechimon | 30 | 压测显示跨区链路超时最多，正在重跑对照 |',
      ].join('\n'),
    );

    expect(html).toContain('data-testid="md-table"');
    expect(html).not.toContain('role="region"');
    expect(html).not.toContain('aria-label=');
    expect(html).toContain('focus-visible:outline-2');
    expect(html).toContain('overflow-x-auto overscroll-x-contain');
    expect(html).toContain('<table class="w-max border-collapse');
    expect(html).not.toContain('whitespace-nowrap');
    expect(html).toContain('<div class="max-w-64 whitespace-normal wrap-break-word"><span>xiechimon</span></div>');
    expect(html).toContain('<th class="px-3 py-1.5 align-top font-semibold text-right">');
    expect(html).toContain('<td class="px-3 py-1.5 align-top text-right">');
  });
});
