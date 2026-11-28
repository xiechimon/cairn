import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { expect, test, vi } from 'vitest';
import { ChiefStreamRow } from '../src/chief/chief-message-rows.js';
import { MessageScroller, MessageScrollerProvider } from '../src/components/ui/message-scroller.js';
import { I18nProvider } from '../src/i18n/provider.js';

vi.mock('../src/chief/report-route.js', () => ({
  channelHref: (projectId: string) => `/app?project=${projectId}&chat=1`,
  useChannelOf: () => () => ({
    projectId: 'proj-long',
    name: 'no-deliverable-verify-1795835635071',
  }),
}));

const LONG_NAME = 'no-deliverable-verify-1795835635071';
const LONG_TITLE = 'Repair board counts across every column and the empty state';

function mirrorRowHtml(): string {
  return renderToStaticMarkup(
    createElement(MemoryRouter, {
      children: createElement(I18nProvider, {
        initialLocale: 'zh',
        children: createElement(MessageScrollerProvider, {
          children: createElement(MessageScroller, {
            children: createElement(ChiefStreamRow, {
              item: {
                kind: 'channel-mirror',
                id: 'mirror-1',
                todoId: 'todo-1',
                title: LONG_TITLE,
                phase: 'done',
                fromThreadId: 'chief-long',
              },
            }),
          }),
        }),
      }),
    }),
  );
}

test('a mirrored task row bounds its channel name and task title, never its status word or Open link', () => {
  const html = mirrorRowHtml();
  expect(html, 'the mirrored row renders at all').toContain('data-testid="chief-channel-mirror"');

  const bounded = [...html.matchAll(/<span class="([^"]+)" title="([^"]+)"/g)].map((match) => ({
    cls: match[1] ?? '',
    full: match[2] ?? '',
  }));
  expect(bounded.map((part) => part.full), 'both long parts carry their full text in title').toEqual([
    `${LONG_NAME} 频道`,
    LONG_TITLE,
  ]);
  for (const part of bounded) {
    expect(part.cls, 'a long part may shrink below its content width').toMatch(/\bmin-w-0\b/);
    expect(part.cls, 'a long part ends in an ellipsis').toMatch(/\btruncate\b/);
    expect(part.cls, 'no long part is pinned at its full width').not.toMatch(/\bflex-none\b/);
  }

  const action = /<a[^>]+class="([^"]+)"/.exec(html)?.[1] ?? '';
  expect(action, 'the Open link never shrinks').toMatch(/\bflex-none\b/);
  expect(html, 'the status word still has room').toContain('已完成');
  expect(html, 'the Open link still has room').toContain('去看');
});
