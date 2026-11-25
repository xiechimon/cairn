import { DEFAULT_DEVIN_MODELS, type ModelSource, type TopModel } from '@cairn/shared';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';
import { toModelOptions } from '../src/api/mappers.js';
import { AntigravityMark, DevinMark } from '../src/components/brand-marks.js';
import { I18nProvider } from '../src/i18n/provider.js';
import { FrequentModelsCard } from '../src/resources/frequent-models-card.js';
import { ThinkingLevelSelect } from '../src/resources/thinking-level-select.js';

const sources: ModelSource[] = [
  {
    runtime: 'devin',
    installed: true,
    hostname: 'mac',
    machineId: 'm1',
    models: [...DEFAULT_DEVIN_MODELS],
  },
  {
    runtime: 'claude-code',
    installed: true,
    hostname: 'mac',
    machineId: 'm1',
    models: [{ id: 'claude-haiku-4-5', name: 'claude-haiku-4-5', thinkingLevels: [] }],
  },
  {
    runtime: 'antigravity',
    installed: true,
    hostname: 'mac',
    machineId: 'm1',
    models: [{ id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', thinkingLevels: [] }],
  },
];

const models: TopModel[] = [
  { provider: 'devin', modelId: 'swe-2-high', thinkingLevel: null },
  { provider: 'claude-code', modelId: 'claude-haiku-4-5', thinkingLevel: 'high' },
  { provider: 'antigravity', modelId: 'claude-sonnet-4-6', thinkingLevel: null },
];

function rows(): string[] {
  const html = renderToStaticMarkup(
    createElement(I18nProvider, {
      initialLocale: 'en',
      children: createElement(FrequentModelsCard, {
        models,
        options: toModelOptions(sources),
        onChange: () => {},
      }),
    }),
  );
  return html.split('data-testid="frequent-model-row"').slice(1);
}

const markOf = (mark: typeof DevinMark) =>
  renderToStaticMarkup(createElement(mark, { className: 'size-4 flex-none text-foreground' }));

describe('frequently used model rows', () => {
  test('SWE-2 offers its thinking levels under the Devin mark with the default it resolves to; a model without a real choice shows nothing there', () => {
    const [swe, haiku, antigravity] = rows();
    expect(swe).toContain('aria-label="SWE-2 thinking level"');
    expect(swe).toContain('data-slot="select-trigger"');
    expect(swe).toContain('Default (High)');
    expect(swe).toContain(markOf(DevinMark));
    for (const row of [haiku, antigravity]) {
      expect(row).not.toContain('data-slot="select-trigger"');
      expect(row).not.toMatch(/Fixed|不可调|Default/);
    }
    expect(antigravity).toContain(markOf(AntigravityMark));
  });

  test('renders sortable drag grips only when at least two models exist', () => {
    const three = rows();
    for (const row of three) {
      expect(row).toContain('data-testid="frequent-model-drag-grip"');
      expect(row).toContain('aria-roledescription="sortable"');
    }
    const singleHtml = renderToStaticMarkup(
      createElement(I18nProvider, {
        initialLocale: 'en',
        children: createElement(FrequentModelsCard, {
          models: [models[0]!],
          options: toModelOptions(sources),
          onChange: () => {},
        }),
      }),
    );
    expect(singleHtml).not.toContain('data-testid="frequent-model-drag-grip"');
  });

  test('a selector whose only level is the default it resolves to is not rendered', () => {
    const html = renderToStaticMarkup(
      createElement(I18nProvider, {
        initialLocale: 'en',
        children: createElement(ThinkingLevelSelect, {
          levels: ['medium'],
          resolvesTo: 'medium',
          value: null,
          onChange: () => {},
          label: 'one choice',
          className: '',
        }),
      }),
    );
    expect(html).toBe('');
  });
});
