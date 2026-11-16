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
  test('offers every MCP grant once, under the group of its registry kind', () => {
    const html = renderToStaticMarkup(
      createElement(ApiKeyCreateDialog, { open: true, onClose: vi.fn(), onCreate: vi.fn() }),
    );
    const [, readGroup = '', writeGroup = ''] = html.split('<legend');
    expect(readGroup).toContain('读取');
    expect(writeGroup).toContain('写入');
    for (const { name, kind } of MCP_TOOL_REGISTRY) {
      const box = `id="apikey-tool-${name}"`;
      expect(kind === 'read' ? readGroup : writeGroup, name).toContain(box);
      expect(kind === 'read' ? writeGroup : readGroup, name).not.toContain(box);
    }
    expect(writeGroup).toContain('新建线程');
    expect(writeGroup).toContain('回复线程');
  });
});
