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

function render(item: Record<string, unknown>): string {
  const row = createElement(ChiefStreamRow, { item } as never);
  const scroller = createElement(MessageScroller, {
    children: createElement(MessageScrollerViewport, {
      children: createElement(MessageScrollerContent, { children: row }),
    }),
  });
  return renderToStaticMarkup(
    createElement(MemoryRouter, {
      children: createElement(I18nProvider, {
        initialLocale: 'en',
        children: createElement(MessageScrollerProvider, { children: scroller }),
      }),
    }),
  );
}

describe('thread report rows with the session line', () => {
  test('a report row renders the line next to the status', () => {
    const html = render({ ...REPORT, id: 'r1', line: 'Waiting on the export format' });
    expect(html).toContain('Task #3 Export');
    expect(html).toContain('Waiting on the export format');
  });

  test('an older row without a line renders as before', () => {
    const html = render({ ...REPORT, id: 'r2' });
    expect(html).toContain('Task #3 Export');
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
});
