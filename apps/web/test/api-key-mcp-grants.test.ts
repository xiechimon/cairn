import { MCP_TOOL_REGISTRY } from '@cairn/shared';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test, vi } from 'vitest';
import { API_KEY_ACCESS, ApiKeyCreateDialog } from '../src/routes/api-key-create-dialog.js';

vi.mock('../src/components/ui/dialog-shell.js', () => ({
  DialogShell: ({ children }: { children: ReactNode }) => createElement('div', null, children),
}));

vi.mock('../src/i18n/provider.js', () => ({
  useI18n: () => ({ t: (text: string) => text }),
}));

const grantsOf = (kind: 'read' | 'write') =>
  MCP_TOOL_REGISTRY.filter((tool) => tool.kind === kind).map((tool) => tool.grant);

describe('API key create dialog', () => {
  test('a new key gets runner enrollment, Git and every MCP tool in its registry kind', () => {
    expect(API_KEY_ACCESS).toEqual({
      gitAccess: true,
      mcpAccess: true,
      machineAccess: true,
      toolGrants: { read: grantsOf('read'), write: grantsOf('write') },
    });
  });

  test('the dialog asks only for a name, with no use choice and no permission', () => {
    const html = renderToStaticMarkup(
      createElement(ApiKeyCreateDialog, { open: true, onClose: vi.fn(), onCreate: vi.fn() }),
    );
    expect(html).toContain('placeholder="MY_KEY"');
    expect(html).not.toContain('role="radio"');
    expect(html).not.toContain('role="checkbox"');
    expect(html).not.toContain('可选');
  });
});
