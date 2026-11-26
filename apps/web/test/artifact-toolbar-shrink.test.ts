import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ArtifactToolbar } from '../src/board/artifact/artifact-toolbar.js';
import { TooltipProvider } from '../src/components/ui/tooltip.js';
import { I18nProvider } from '../src/i18n/provider.js';

describe('ArtifactToolbar title shrink', () => {
  it('overrides button shrink-0 so long titles truncate without clipping toolbar controls', () => {
    const html = renderToStaticMarkup(
      h(I18nProvider, {
        initialLocale: 'zh',
        children: h(
          TooltipProvider,
          null,
          h(ArtifactToolbar, {
            name: '核实并重写简历 Cairn 与 szsq 条目.md',
            menu: h('div', null, 'menu'),
            comments: { count: 0, on: false, disabled: false, toggle: () => {} },
            history: { open: false, toggle: () => {} },
          }),
        ),
      }),
    );
    const match = /data-testid="artifact-name"[^>]*class="([^"]+)"/.exec(html);
    const classes = (match?.[1] ?? '').split(/\s+/);
    expect(classes).toContain('min-w-0');
    expect(classes).toContain('shrink');
    expect(classes).not.toContain('shrink-0');
  });
});
