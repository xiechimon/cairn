import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';
import { ThreadUsageDetails, ThreadUsageRing } from '../src/board/thread-usage-ring.js';
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
            machines: ['Studio-Mac-mini'],
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
    expect(html).toContain('Studio-Mac-mini');
    expect(html).not.toContain('—');
  });

  test('ContextMeterPanel labels the prompt cache hit rate as the last turn hit rate', () => {
    const zh = renderToStaticMarkup(
      createElement(I18nProvider, {
        initialLocale: 'zh',
        children: createElement(ContextMeterPanel, {
          context: {
            tokens: 17_367,
            contextWindow: 183_000,
            cache: { read: 44_312, write: 6_545, input: 8 },
          },
          now: 1_000_000,
        }),
      }),
    );
    expect(zh).toContain('17K / 183K');
    expect(zh).toContain('上轮命中率');
    expect(zh).toContain('87%');
    const en = renderToStaticMarkup(
      createElement(I18nProvider, {
        initialLocale: 'en',
        children: createElement(ContextMeterPanel, {
          context: {
            tokens: 17_367,
            contextWindow: 183_000,
            cache: { read: 44_312, write: 6_545, input: 8 },
          },
          now: 1_000_000,
        }),
      }),
    );
    expect(en).toContain('Last turn hit rate');
  });

  test('shows only current engine/model/runner with icons and omits historical clutter', () => {
    const html = renderToStaticMarkup(
      createElement(I18nProvider, {
        initialLocale: 'en',
        children: createElement(ContextMeterLine, {
          context: { tokens: 24_000, contextWindow: 200_000 },
          usage: {
            rows: [
              {
                buildId: 'chief-offer',
                model: 'anthropic-ultra/claude-haiku-5-5',
                input: 100,
                output: 50,
                cacheRead: 400,
                cacheWrite: 0,
                costInput: null,
                costOutput: null,
                costCacheRead: null,
                costCacheWrite: null,
                costTotal: 0.05,
              },
              {
                buildId: 'chief-offer',
                model: 'domestic-proxy/MiniMax-M3',
                input: 50,
                output: 25,
                cacheRead: 0,
                cacheWrite: 0,
                costInput: null,
                costOutput: null,
                costCacheRead: null,
                costCacheWrite: null,
                costTotal: 0.02,
              },
              {
                buildId: 'chief-offer',
                model: 'swe-2-1-medium',
                input: 200,
                output: 100,
                cacheRead: 800,
                cacheWrite: 0,
                costInput: null,
                costOutput: null,
                costCacheRead: null,
                costCacheWrite: null,
                costTotal: 0.1,
              },
            ],
            durationSeconds: 32,
            engines: ['Claude Code', 'Devin'],
            machines: ['studioMac-0001.local', 'Studio-Mac-mini'],
            turns: 3,
            latest: {
              engine: 'Devin',
              engineRuntime: 'devin',
              model: {
                raw: 'swe-2-1-medium',
                provider: 'devin',
                providerLabel: 'Devin',
                modelId: 'swe-2-1-medium',
                modelName: 'SWE-2.1',
                runtime: 'devin',
              },
              machine: {
                id: 'm-mini',
                name: 'Studio-Mac-mini',
                osPlatform: 'darwin',
              },
            },
          },
        }),
      }),
    );
    expect(html).toContain('SWE-2.1');
    expect(html).not.toContain('swe-2-1-medium');
    expect(html).not.toContain('Claude Code');
    expect(html).not.toContain('studioMac-0001.local');
    expect(html).not.toContain('Claude Haiku 5.5');
    expect(html).toContain('data-testid="usage-current-engine"');
    expect(html).toContain('data-testid="usage-current-model"');
    expect(html).toContain('data-testid="usage-current-runner"');
    expect(html).not.toContain('data-testid="usage-history-toggle"');
    expect(html).not.toContain('data-testid="usage-history-list"');
    expect(html).toContain('<svg');
  });
});

describe('ThreadUsageRing parity and placeholder hiding', () => {
  test('renders only the context ring glyph without a percentage text node', () => {
    const html = renderToStaticMarkup(
      createElement(I18nProvider, {
        initialLocale: 'en',
        children: createElement(ThreadUsageRing, {
          state: 'ready',
          onRetry: () => {},
          context: { tokens: 50_000, contextWindow: 200_000 },
          summary: {
            cost: '$0.25',
            tokens: '50k',
            cached: '80%',
            models: ['anthropic-ultra/claude-sonnet-5-5'],
            machines: ['Studio-Mac-mini'],
            duration: '12s',
            engines: ['Cairn'],
          },
        }),
      }),
    );
    expect(html).toContain('data-testid="thread-usage-ring"');
    expect(html).toContain('data-percent="25"');
    expect(html).not.toContain('25%');
  });

  test('hides unavailable cost, tokens, and cache hit rows without dash placeholders', () => {
    const html = renderToStaticMarkup(
      createElement(I18nProvider, {
        initialLocale: 'en',
        children: createElement(ThreadUsageDetails, {
          state: 'ready',
          onRetry: () => {},
          summary: {
            cost: '',
            tokens: '',
            cached: '',
            models: [],
            machines: [],
            duration: '',
            engines: [],
          },
        }),
      }),
    );
    expect(html).not.toContain('—');
    expect(html).not.toContain('>Cost<');
    expect(html).not.toContain('>Tokens<');
    expect(html).not.toContain('>Cache hit<');
  });
});
