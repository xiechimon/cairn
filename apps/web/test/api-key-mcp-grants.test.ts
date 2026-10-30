import { MCP_TOOL_REGISTRY } from '@cairn/shared';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test, vi } from 'vitest';
import { ApiKeyCreateDialog } from '../src/routes/api-key-create-dialog.js';

vi.mock('../src/components/ui/dialog-shell.js', () => ({
  DialogShell: ({ children }: { children: ReactNode }) => createElement('div', null, children),
}));

vi.mock('../src/i18n/provider.js', () => ({
  useI18n: () => ({ t: (text: string) => text }),
}));

describe('API key MCP grant selection', () => {
  test('offers the exact grant labels enforced by the MCP face, including Thread entry', () => {
    const html = renderToStaticMarkup(
      createElement(ApiKeyCreateDialog, { open: true, onClose: vi.fn(), onCreate: vi.fn() }),
    );
    for (const { grant } of MCP_TOOL_REGISTRY) {
      expect(html, grant).toContain(`>${grant}</span>`);
      expect(html, grant).toContain(`aria-label="读 ${grant}"`);
      expect(html, grant).toContain(`aria-label="写 ${grant}"`);
    }
    expect(html).not.toContain('aria-label="读 todos"');
    expect(html).toContain('Start Thread');
    expect(html).toContain('Reply Thread');
  });
});
