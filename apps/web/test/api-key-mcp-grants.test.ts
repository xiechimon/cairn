import { MCP_TOOL_REGISTRY } from '@cairn/shared';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test, vi } from 'vitest';
import { API_KEY_USES, ApiKeyCreateDialog } from '../src/routes/api-key-create-dialog.js';

vi.mock('../src/components/ui/dialog-shell.js', () => ({
  DialogShell: ({ children }: { children: ReactNode }) => createElement('div', null, children),
}));

vi.mock('../src/i18n/provider.js', () => ({
  useI18n: () => ({ t: (text: string) => text }),
}));

const grantsOf = (kind: 'read' | 'write') =>
  MCP_TOOL_REGISTRY.filter((tool) => tool.kind === kind).map((tool) => tool.grant);

describe('API key uses', () => {
  test('a runner key enrolls runners and nothing else', () => {
    expect(API_KEY_USES.machine).toEqual({
      gitAccess: false,
      mcpAccess: false,
      machineAccess: true,
      toolGrants: { read: [], write: [] },
    });
  });

  test('an MCP client key opens MCP with every tool in its registry kind, and Git, but cannot enroll runners', () => {
    expect(API_KEY_USES.mcp).toEqual({
      gitAccess: true,
      mcpAccess: true,
      machineAccess: false,
      toolGrants: { read: grantsOf('read'), write: grantsOf('write') },
    });
  });

  test('the dialog shows a name and a use, and no individual permission', () => {
    const html = renderToStaticMarkup(
      createElement(ApiKeyCreateDialog, { open: true, onClose: vi.fn(), onCreate: vi.fn() }),
    );
    expect(html).toContain('只能在其他电脑上用 cairn start 注册执行机。');
    expect(html).not.toContain('role="checkbox"');
    expect(html).not.toContain('type="checkbox"');
  });
});
