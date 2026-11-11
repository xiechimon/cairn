import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';
import {
  clampContextPercent,
  ContextMeterRing,
  type ContextMeterRingProps,
  contextMeterArcPath,
  contextPercentOf,
  contextResumeOf,
  contextResumeShortLabel,
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

describe('contextResumeOf', () => {
  test('reads optional context.resume when the value is a known short state', () => {
    expect(contextResumeOf(null)).toBeNull();
    expect(contextResumeOf({ tokens: 1, contextWindow: 2 })).toBeNull();
    expect(contextResumeOf({ resume: 'hot' })).toBeNull();
    expect(contextResumeOf({ resume: 'warm' })).toBe('warm');
    expect(contextResumeOf({ resume: 'cold' })).toBe('cold');
    expect(contextResumeOf({ resume: 'compacted' })).toBe('compacted');
    expect(contextResumeOf({ resume: 'idle' })).toBe('idle');
  });
});

describe('contextResumeShortLabel', () => {
  test('maps draft §0 short states', () => {
    expect(contextResumeShortLabel('warm')).toBe('暖');
    expect(contextResumeShortLabel('cold')).toBe('冷·将精简');
    expect(contextResumeShortLabel('compacted')).toBe('已压实');
    expect(contextResumeShortLabel('idle')).toBe('空闲');
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
  test('falls back to the mock fill when percent is omitted', () => {
    const html = renderRing();
    expect(html).toContain('data-testid="composer-context-meter"');
    expect(html).toContain('pointer-coarse:h-11');
    expect(html).toContain('class="size-3.5"');
    expect(html).toContain(`>${MOCK_CONTEXT_PERCENT}%</span>`);
    expect(html).not.toContain('size-5.5');
    expect(html).toContain('data-mock=""');
    expect(html).toContain(`data-percent="${MOCK_CONTEXT_PERCENT}"`);
    expect(html).not.toContain('data-resume');
    expect(html).not.toContain('stroke-dasharray');
    expect(html).toContain('示意');
    expect(html).toContain('<path ');
  });

  test('renders a prop-driven percent without the mock label', () => {
    const html = renderRing({ percent: 18, mock: false });
    expect(html).toContain('data-percent="18"');
    expect(html).not.toContain('data-mock');
    expect(html).not.toContain('data-resume');
    expect(html).toContain('aria-label="上下文 18%"');
    expect(html).not.toContain('示意');
    expect(html).not.toContain('stroke-dasharray');
  });

  test('shows the draft §0 short state with percent when resume is present', () => {
    const html = renderRing({ percent: 18, mock: false, resume: 'cold' });
    expect(html).toContain('data-resume="cold"');
    expect(html).toContain('aria-label="冷·将精简 · 18%"');
    expect(html).not.toContain('示意');
    expect(html).not.toContain('stroke-dasharray');
  });

  test('keeps the percent-only tooltip when resume is absent', () => {
    const html = renderRing({ percent: 12, mock: false, resume: null });
    expect(html).not.toContain('data-resume');
    expect(html).toContain('aria-label="上下文 12%"');
  });
});
