import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';
import { QuotaNotice } from '../src/board/quota-notice.js';
import { I18nProvider } from '../src/i18n/provider.js';
import { stripHtmlTags } from './strip-html-tags.js';

describe('QuotaNotice', () => {
  test('sums counts across multiple groups instead of reporting group count', () => {
    const html = renderToStaticMarkup(
      createElement(I18nProvider, {
        initialLocale: 'zh',
        children: createElement(QuotaNotice, {
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
    expect(stripHtmlTags(html)).toContain('5 个任务因额度/限流挂起');
  });
});
