import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';
import {
  clampContextPercent,
  ContextMeterLine,
  ContextMeterPanel,
  ContextMeterRing,
  type ContextMeterRingProps,
  contextCacheState,
  contextMeterLines,
  contextPercentOf,
  formatContextTokens,
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

describe('ContextMeterRing', () => {
  test('falls back to the mock fill when there is no reading', () => {
    const html = renderRing();
    expect(html).toContain('data-testid="composer-context-meter"');
    expect(html).toContain('pointer-coarse:h-11');
    expect(html).toContain('class="size-3.5"');
    expect(html).not.toContain('size-5.5');
    expect(html).toContain('data-mock=""');
    expect(html).toContain(`data-percent="${MOCK_CONTEXT_PERCENT}"`);
        expect(html).toContain('aria-label="上下文（示意）"');
    expect(html).toContain('data-slot="context-arc"');
  });

  test('fills the ring against the model window and names used, window and the compaction point in K', () => {
    const html = renderRing({
      context: { tokens: 49_376, contextWindow: 500_000, compactAt: 150_000 },
    });
    expect(html).toContain('data-percent="10"');
    expect(html).not.toContain('data-mock');
    expect(html).toContain('aria-label="上下文 49K / 500K, 150K 时自动压缩"');
    expect(html).toContain('data-compact-tick');
    expect(html).not.toContain('%');
  });

  test('omits the compaction line and tick when the server sends no compaction point', () => {
    const html = renderRing({ context: { tokens: 18_885, contextWindow: 1_000_000 } });
    expect(html).toContain('aria-label="上下文 19K / 1M"');
    expect(html).not.toContain('data-compact-tick');
  });

  test('names the initial usage fetch instead of claiming a mock reading', () => {
    const html = renderRing({ loading: true });
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('aria-label="正在加载用量…"');
    expect(html).not.toContain('上下文（示意）');
    expect(html).not.toContain('data-slot="context-arc"');
  });

  test('stays still with its reading while a turn runs', () => {
    const html = renderRing({
      running: true,
      context: { tokens: 24_000, contextWindow: 200_000, resumeExpiresAt: Date.now() + 60_000 },
    });
    expect(html).toContain('aria-busy="false"');
    expect(html).not.toContain('animate-spin');
    expect(html).toContain('data-slot="context-arc"');
    expect(html).toContain('缓存回复中保持有效');
  });
});

describe('formatContextTokens', () => {
  test('writes thousands as K and keeps one decimal only under ten thousand', () => {
    expect(formatContextTokens(640)).toBe('640');
    expect(formatContextTokens(3_640)).toBe('3.6K');
    expect(formatContextTokens(76_000)).toBe('76K');
    expect(formatContextTokens(92_499)).toBe('92K');
    expect(formatContextTokens(1_000_000)).toBe('1M');
  });
});

describe('contextCacheState and the tooltip cache line', () => {
  const t = (source: string, vars?: Record<string, string | number>) =>
    source.replace(/\{(\w+)\}/g, (_, name: string) => String(vars?.[name] ?? ''));
  const base = { tokens: 76_000, contextWindow: 200_000, compactAt: 92_000 };
  const now = 1_000_000;

  test('counts down from the server expiry and flips to expired at it', () => {
    const at = { ...base, resumeExpiresAt: now + 180_000 };
    expect(contextCacheState(at, false, now)).toEqual({ kind: 'warm', leftMs: 180_000 });
    expect(contextMeterLines(t, at, { now })).toContain('缓存 {n} 分钟后失效'.replace('{n}', '3'));
    expect(contextMeterLines(t, at, { now: now + 179_001 })).toContain('缓存不到 1 分钟后失效');
    expect(contextCacheState(at, false, now + 180_000)).toEqual({ kind: 'expired' });
  });

  test('shows no cache line when the provider guarantees no lifetime', () => {
    expect(contextCacheState(base, false, now)).toBeNull();
    expect(contextMeterLines(t, base, { now })).toEqual(['上下文 76K / 200K', '92K 时自动压缩']);
  });

  test('a model switch is a miss whatever the lifetime', () => {
    expect(contextCacheState({ ...base, resume: 'cold' }, false, now)).toEqual({ kind: 'cold' });
  });

  test('names the room left once usage is within a tenth of the compaction point', () => {
    const near = { ...base, tokens: 88_400 };
    expect(contextMeterLines(t, near, { now })[1]).toBe('再用 3.6K 就自动压缩');
  });
});

describe('ContextMeterLine channel usage stats', () => {
  test('renders channel usage stats alongside context without placeholder dashes', () => {
    const html = renderToStaticMarkup(
      createElement(I18nProvider, {
        initialLocale: 'zh',
        children: createElement(ContextMeterLine, {
          context: {
            tokens: 17_367,
            contextWindow: 183_000,
            compactAt: 150_000,
            cache: { read: 44_312, write: 6_545, input: 8 },
          },
          usage: {
            rows: [
              {
                buildId: 'chief-offer',
                model: 'claude-code/claude-opus-5-5',
                input: 8,
                output: 355,
                cacheRead: 44_312,
                cacheWrite: 6_545,
                costInput: 0.0001,
                costOutput: 0.0089,
                costCacheRead: 0.0222,
                costCacheWrite: 0.0409,
                costTotal: 0.0721,
              },
            ],
            durationSeconds: 14,
            engines: ['Claude Code'],
            machines: ['Ians-Mac-mini'],
            turns: 1,
          },
        }),
      }),
    );
    expect(html).toContain('data-testid="channel-usage-stats"');
    expect(html).toContain('用量');
    expect(html).toContain('轮次');
    expect(html).toContain('Claude Code');
    expect(html).toContain('14s');
    expect(html).toContain('$0.07');
    expect(html).toContain('Ians-Mac-mini');
    expect(html).not.toContain('—');
  });

  test('ContextMeterPanel renders without crashing when rendered directly', () => {
    const html = renderToStaticMarkup(
      createElement(I18nProvider, {
        initialLocale: 'zh',
        children: createElement(ContextMeterPanel, {
          context: { tokens: 10_000, contextWindow: 100_000 },
          now: 1_000_000,
        }),
      }),
    );
    expect(html).toContain('10K / 100K');
  });
});
