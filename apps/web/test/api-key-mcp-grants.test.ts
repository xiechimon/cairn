import { MCP_TOOL_REGISTRY } from '@cairn/shared';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test, vi } from 'vitest';
import { API_KEY_PRESETS, ApiKeyCreateDialog } from '../src/routes/api-key-create-dialog.js';

vi.mock('../src/components/ui/dialog-shell.js', () => ({
  DialogShell: ({ children }: { children: ReactNode }) => createElement('div', null, children),
}));

vi.mock('../src/i18n/provider.js', () => ({
  useI18n: () => ({ t: (text: string) => text }),
}));

const grantsOf = (kind: 'read' | 'write') =>
  MCP_TOOL_REGISTRY.filter((tool) => tool.kind === kind).map((tool) => tool.grant);

describe('API key presets', () => {
  test('connecting a runner grants machine enrollment and nothing else', () => {
    expect(API_KEY_PRESETS.machine).toEqual({
      gitAccess: false,
      mcpAccess: false,
      machineAccess: true,
      toolGrants: { read: [], write: [] },
    });
  });

  test('read-only opens MCP with every read tool and no write tool', () => {
    expect(API_KEY_PRESETS.read).toEqual({
      gitAccess: false,
      mcpAccess: true,
      machineAccess: false,
      toolGrants: { read: grantsOf('read'), write: [] },
    });
  });

  test('all grants every switch and every tool in its registry kind', () => {
    expect(API_KEY_PRESETS.all).toEqual({
      gitAccess: true,
      mcpAccess: true,
      machineAccess: true,
      toolGrants: { read: grantsOf('read'), write: grantsOf('write') },
    });
  });

  test('the dialog opens on a preset with no individual checkboxes shown', () => {
    const html = renderToStaticMarkup(
      createElement(ApiKeyCreateDialog, { open: true, onClose: vi.fn(), onCreate: vi.fn() }),
    );
    expect(html).toContain('只能用来在命令行注册执行机');
    expect(html).not.toContain('role="checkbox"');
    expect(html).not.toContain('apikey-tool-');
  });
});
