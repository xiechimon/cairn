import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';
import {
  clampContextPercent,
  ContextMeterRing,
  MOCK_CONTEXT_PERCENT,
} from '../src/chief/context-meter-ring.js';
import { I18nProvider } from '../src/i18n/provider.js';

describe('clampContextPercent', () => {
  test('clamps to 0..100 and rounds', () => {
    expect(clampContextPercent(-3)).toBe(0);
    expect(clampContextPercent(5.4)).toBe(5);
    expect(clampContextPercent(100.9)).toBe(100);
    expect(clampContextPercent(Number.NaN)).toBe(0);
  });
});

describe('ContextMeterRing', () => {
  test('renders a mock meter at the prototype fill', () => {
    const html = renderToStaticMarkup(
      createElement(I18nProvider, {
        initialLocale: 'zh',
        children: createElement(ContextMeterRing, null),
      }),
    );
    expect(html).toContain('data-testid="composer-context-meter"');
    expect(html).toContain('data-mock=""');
    expect(html).toContain(`data-percent="${MOCK_CONTEXT_PERCENT}"`);
    expect(html).not.toContain('aria-valuenow');
    expect(html).not.toContain('aria-valuemin');
    expect(html).not.toContain('aria-valuemax');
    expect(html).toContain('示意');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('size-5.5');
  });
});
