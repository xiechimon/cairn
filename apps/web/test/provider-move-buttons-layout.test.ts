import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SortableMoveButtons } from '../src/components/providers/provider-panel.js';
import { TooltipProvider } from '../src/components/ui/tooltip.js';
import { I18nProvider } from '../src/i18n/provider.js';

describe('SortableMoveButtons reveal layout', () => {
  it('reserves flex space on hover/focus without absolute overlap', () => {
    const html = renderToStaticMarkup(
      h(I18nProvider, {
        initialLocale: 'zh',
        children: h(
          TooltipProvider,
          null,
          h(SortableMoveButtons, {
            revealOnHover: true,
            label: 'Claude 订阅',
            onMoveUp: () => {},
            onMoveDown: () => {},
          }),
        ),
      }),
    );
    const match = /^<span class="([^"]+)"/.exec(html);
    const classes = (match?.[1] ?? '').split(/\s+/);
    expect(classes).not.toContain('pointer-fine:absolute');
    expect(classes).not.toContain('absolute');
    expect(classes).toContain('pointer-fine:w-0');
    expect(classes).toContain('pointer-fine:justify-end');
    expect(classes).toContain('pointer-fine:overflow-hidden');
    expect(classes).toContain('pointer-fine:group-hover/row:w-auto');
    expect(classes).toContain('pointer-fine:group-focus-within/row:w-auto');
  });
});
