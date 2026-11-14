import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';
import {
  clampContextPercent,
  ContextMeterRing,
  type ContextMeterRingProps,
  contextMeterArcPath,
  contextPercentOf,
  MOCK_CONTEXT_PERCENT,
} from '../src/chief/context-meter-ring.js';
import { I18nProvider } from '../src/i18n/provider.js';

function renderRing(props: ContextMeterRingProps = {}): string {
  return renderToStaticMarkup(
    createElement(I18nProvider, {
      initialLocale: 'zh',
      children: createElement(ContextMeterRing, props),
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
    expect(contextPercentOf({ tokens: Number.NaN, contextWindow: 128_000 })).toBeNull();
    expect(contextPercentOf({ tokens: 10, contextWindow: Number.NaN })).toBeNull();
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
  test('falls back to the mock fill when there is no reading', () => {
    const html = renderRing();
    expect(html).toContain('data-testid="composer-context-meter"');
    expect(html).toContain('pointer-coarse:h-11');
    expect(html).toContain('class="size-3.5"');
    expect(html).not.toContain('size-5.5');
    expect(html).toContain('data-mock=""');
    expect(html).toContain(`data-percent="${MOCK_CONTEXT_PERCENT}"`);
    expect(html).not.toContain('stroke-dasharray');
    expect(html).toContain('aria-label="上下文（示意）"');
    expect(html).toContain('<path ');
  });

  test('fills the ring against the model window and names used, window and the compaction point', () => {
    const html = renderRing({
      context: { tokens: 49_376, contextWindow: 500_000, compactAt: 150_000 },
    });
    expect(html).toContain('data-percent="10"');
    expect(html).not.toContain('data-mock');
    expect(html).toContain('aria-label="已用 4.9万 / 50万, 15万时自动压缩"');
    expect(html).not.toContain('%');
  });

  test('omits the compaction line when the server sends no compaction point', () => {
    const html = renderRing({ context: { tokens: 18_885, contextWindow: 1_000_000 } });
    expect(html).toContain('aria-label="已用 1.9万 / 100万"');
  });

  test('names the initial usage fetch instead of claiming a mock reading', () => {
    const html = renderRing({ loading: true });
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('aria-label="正在加载用量…"');
    expect(html).not.toContain('上下文（示意）');
    expect(html).not.toContain('%');
  });
});
