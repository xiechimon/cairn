import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, test } from 'vitest';
import { mapChiefStream } from '../src/api/mappers.js';
import { ChiefStreamRow } from '../src/chief/chief-message-rows.js';
import {
  MessageScroller,
  MessageScrollerContent,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from '../src/components/ui/message-scroller.js';
import { I18nProvider } from '../src/i18n/provider.js';

const REPORT = {
  kind: 'thread-report',
  todoId: 't1',
  phase: 'review',
  seqNum: 3,
  title: 'Export',
};

const plain = (html: string) => html.replace(/<[^>]+>/g, '');

function render(item: Record<string, unknown>): string {
  const row = createElement(ChiefStreamRow, { item } as never);
  const scroller = createElement(MessageScroller, {
    children: createElement(MessageScrollerViewport, {
      children: createElement(MessageScrollerContent, { children: row }),
    }),
  });
  return renderToStaticMarkup(
    createElement(QueryClientProvider, {
      client: new QueryClient(),
      children: createElement(MemoryRouter, {
        children: createElement(I18nProvider, {
          initialLocale: 'en',
          children: createElement(MessageScrollerProvider, { children: scroller }),
        }),
      }),
    }),
  );
}

describe('thread report rows with the session line', () => {
  test('a report row renders the line next to the status', () => {
    const html = render({ ...REPORT, id: 'r1', line: 'Waiting on the export format' });
    expect(plain(html)).toContain('Export: In review');
    expect(html).toContain('Waiting on the export format');
  });

  test('a report line wraps instead of being clipped', () => {
    const html = render({ ...REPORT, phase: 'needs-you', id: 'r6', line: 'Which export format?' });
    expect(html).not.toContain('truncate');
  });

  test('an older row without a line renders as before', () => {
    const html = render({ ...REPORT, id: 'r2' });
    expect(plain(html)).toContain('Export: In review');
    expect(html).not.toContain('ml-1.5');
  });

  test('the stream mapper keeps the line on the report item', () => {
    const rows = [
      {
        id: 'a',
        role: 'system' as const,
        content: JSON.stringify({ ...REPORT, line: 'Short line' }),
        createdAt: 1,
      },
    ];
    expect(mapChiefStream(rows)).toEqual([{ ...REPORT, id: 'a', line: 'Short line' }]);
  });

  test('a needs-you report says the thread needs you and keeps its line', () => {
    const html = render({ ...REPORT, phase: 'needs-you', id: 'r3', line: 'Which export format?' });
    expect(plain(html)).toContain('Export: Needs you');
    expect(plain(html)).not.toContain('#3');
    expect(html).toContain('Which export format?');
    expect(html).toContain('data-phase="needs-you"');
    expect(html).not.toContain('thread-report-reply');
  });

  test('done and failed reports carry the same line next to their status', () => {
    const done = render({ ...REPORT, phase: 'done', id: 'r4', line: 'Shipped the export' });
    expect(plain(done)).toContain('Export: Done');
    expect(done).toContain('Shipped the export');
    const failed = render({ ...REPORT, phase: 'failed', id: 'r5', line: 'Tests would not pass' });
    expect(plain(failed)).toContain('Export: Failed');
    expect(failed).toContain('Tests would not pass');
  });

  test('the stream mapper keeps a needs-you report and its line', () => {
    const rows = [
      {
        id: 'a',
        role: 'system' as const,
        content: JSON.stringify({ ...REPORT, phase: 'needs-you', line: 'Which format?' }),
        createdAt: 1,
      },
    ];
    expect(mapChiefStream(rows)).toEqual([
      { ...REPORT, phase: 'needs-you', id: 'a', line: 'Which format?' },
    ]);
  });
});
