import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';
import { QuotaBanner } from '../src/board/quota-banner.js';
import { I18nProvider } from '../src/i18n/provider.js';

describe('QuotaBanner', () => {
  test('sums counts across multiple groups instead of reporting group count', () => {
    const html = renderToStaticMarkup(
      createElement(I18nProvider, {
        initialLocale: 'zh',
        children: createElement(QuotaBanner, {
          infos: [
            {
              lane: 'anthropic',
              kind: 'quota',
              kindText: '额度空',
              count: 3,
              probe: '10:00',
              probeAt: 1000,
            },
            {
              lane: 'openai',
              kind: 'capacity',
              kindText: '限流',
              count: 2,
              probe: '10:05',
              probeAt: 2000,
            },
          ],
        }),
      }),
    );
    expect(html.replace(/<[^>]+>/g, '')).toContain('5 个任务因额度/限流挂起');
  });
});
