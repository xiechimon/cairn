import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';
import {
  clampContextPercent,
  ContextMeterRing,
  contextMeterArcPath,
  contextPercentOf,
  MOCK_CONTEXT_PERCENT,
} from '../src/chief/context-meter-ring.js';
import { I18nProvider } from '../src/i18n/provider.js';

function renderRing(node: ReactNode): string {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return renderToStaticMarkup(
    createElement(QueryClientProvider, {
      client,
      children: createElement(I18nProvider, {
        initialLocale: 'zh',
        children: node,
      }),
    }),
  );
}

describe('clampContextPercent', () => {
  test('clamps to 0..100 and rounds', () => {
    expect(clampContextPercent(-3)).toBe(0);
    expect(clampContextPercent(5.4)).toBe(5);
    expect(clampContextPercent(100.9)).toBe(100);
    expect(clampContextPercent(Number.NaN)).toBe(0);
  });
});

describe('contextPercentOf', () => {
  test('returns null when usage is missing or the window is invalid', () => {
    expect(contextPercentOf(null)).toBeNull();
    expect(contextPercentOf(undefined)).toBeNull();
    expect(contextPercentOf({ tokens: 10, contextWindow: 0 })).toBeNull();
  });

  test('rounds tokens against the context window', () => {
    expect(contextPercentOf({ tokens: 6400, contextWindow: 128_000 })).toBe(5);
    expect(contextPercentOf({ tokens: 23_456, contextWindow: 128_000 })).toBe(18);
  });
});

describe('contextMeterArcPath', () => {
  test('returns an arc path without stroke-dasharray semantics', () => {
    expect(contextMeterArcPath(0)).toBe('');
    expect(contextMeterArcPath(5)).toMatch(/^M /);
    expect(contextMeterArcPath(5)).toContain(' A ');
    expect(contextMeterArcPath(100)).toContain(' A ');
  });
});

describe('ContextMeterRing', () => {
  test('falls back to the mock fill when chief context is unknown', () => {
    const html = renderRing(createElement(ContextMeterRing, {}));
    expect(html).toContain('data-testid="composer-context-meter"');
    expect(html).toContain('data-mock=""');
    expect(html).toContain(`data-percent="${MOCK_CONTEXT_PERCENT}"`);
    expect(html).not.toContain('stroke-dasharray');
    expect(html).toContain('示意');
    expect(html).toContain('<path ');
  });

  test('renders a real percent without the mock label when props say so', () => {
    const html = renderRing(createElement(ContextMeterRing, { percent: 18, mock: false }));
    expect(html).toContain('data-percent="18"');
    expect(html).not.toContain('data-mock');
    expect(html).toContain('aria-label="上下文 18%"');
    expect(html).not.toContain('示意');
    expect(html).not.toContain('stroke-dasharray');
  });
});
