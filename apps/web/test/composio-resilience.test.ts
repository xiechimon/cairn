import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ComposioAppEntry, McpConnectorRecord } from '@cairn/shared';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';
import { ApiError } from '../src/api/client.js';
import { I18nProvider } from '../src/i18n/provider.js';
import {
  ComposioAppActions,
  ComposioErrorBanner,
  safeHttpsUrl,
} from '../src/resources/composio-section.js';

function makeConnector(overrides: Partial<McpConnectorRecord> = {}): McpConnectorRecord {
  return {
    id: 'cx-gmail',
    teamId: 'team-1',
    slug: 'gmail',
    label: 'Gmail',
    catalogId: 'composio',
    transport: 'http',
    url: 'https://mcp.composio.dev',
    headerNames: ['x-api-key'],
    authKind: 'composio',
    account: null,
    status: 'needs_auth',
    statusReason: 'authorizing',
    toolCount: null,
    checkedAt: null,
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  };
}

function makeApp(connector: McpConnectorRecord | null): ComposioAppEntry {
  return {
    slug: 'gmail',
    name: 'Gmail',
    description: 'Read and send mail',
    logoUrl: null,
    noAuth: false,
    toolsCount: 12,
    connector,
  };
}

function render(node: ReturnType<typeof createElement>, locale: 'zh' | 'en' = 'zh'): string {
  return renderToStaticMarkup(createElement(I18nProvider, { initialLocale: locale, children: node }));
}

describe('composio resilience', () => {
  test('mcp-servers-page isolates composioQ from top-level mergeQueries error boundary', () => {
    const src = readFileSync(
      resolve(import.meta.dirname, '../src/resources/mcp-servers-page.tsx'),
      'utf8',
    );
    const mergeCalls = [...src.matchAll(/mergeQueries\(([^)]*)\)/g)].map((m) => m[1] ?? '');
    expect(mergeCalls.length).toBeGreaterThan(0);
    for (const args of mergeCalls) {
      expect(args).not.toContain('composioQ');
    }
  });

  test('safeHttpsUrl allows only https URLs', () => {
    expect(safeHttpsUrl('https://connect.composio.dev/link/abc')).toBe(
      'https://connect.composio.dev/link/abc',
    );
    expect(safeHttpsUrl('http://connect.composio.dev/link/abc')).toBeNull();
    expect(safeHttpsUrl('javascript:alert(1)')).toBeNull();
    expect(safeHttpsUrl('not-a-url')).toBeNull();
    expect(safeHttpsUrl(null)).toBeNull();
  });

  test('ComposioErrorBanner shows invalid key copy with replace/remove and retry actions', () => {
    const html = render(
      createElement(ComposioErrorBanner, {
        error: new ApiError(400, 'Composio rejected the saved API key', 'invalid_api_key'),
        isFetching: false,
        onManageKey: () => {},
        onRetry: () => {},
      }),
    );
    expect(html).toContain('data-testid="composio-error-banner"');
    expect(html).toContain('Composio API key 无效');
    expect(html).toContain('data-testid="composio-error-manage-key"');
    expect(html).toContain('更换或移除 API key');
    expect(html).toContain('data-testid="composio-error-retry"');
    expect(html).toContain('重试');
  });

  test('ComposioErrorBanner shows unavailable copy and disables retry while fetching', () => {
    const html = render(
      createElement(ComposioErrorBanner, {
        error: new ApiError(502, 'Composio is unreachable', 'upstream_unavailable'),
        isFetching: true,
        onManageKey: () => {},
        onRetry: () => {},
      }),
    );
    expect(html).toContain('Composio 应用未能加载');
    expect(html).toContain('data-testid="composio-error-manage-key"');
    expect(html).toMatch(/disabled[^>]*data-testid="composio-error-retry"|data-testid="composio-error-retry"[^>]*disabled/);
  });

  test('polling wait state shows manual open-link, cancel-auth, and disconnect buttons', () => {
    const connector = makeConnector({ status: 'needs_auth', statusReason: 'authorizing' });
    const html = render(
      createElement(ComposioAppActions, {
        app: makeApp(connector),
        busy: null,
        authWait: {
          connectorId: connector.id,
          redirectUrl: 'https://connect.composio.dev/link/abc',
        },
        deleting: false,
        onConnect: () => {},
        onAuthorize: () => {},
        onCancelAuth: () => {},
        onDisconnect: () => {},
      }),
    );
    expect(html).toContain('data-testid="composio-open-auth-gmail"');
    expect(html).toContain('href="https://connect.composio.dev/link/abc"');
    expect(html).toContain('打开授权链接');
    expect(html).toContain('data-testid="composio-cancel-auth-gmail"');
    expect(html).toContain('取消授权');
    expect(html).toContain('data-testid="composio-remove-gmail"');
    expect(html).toContain('断开');
  });

  test('polling wait state without redirectUrl omits open-link but keeps cancel and disconnect', () => {
    const connector = makeConnector({ status: 'needs_auth', statusReason: 'authorizing' });
    const html = render(
      createElement(ComposioAppActions, {
        app: makeApp(connector),
        busy: null,
        authWait: { connectorId: connector.id, redirectUrl: null },
        deleting: false,
        onConnect: () => {},
        onAuthorize: () => {},
        onCancelAuth: () => {},
        onDisconnect: () => {},
      }),
    );
    expect(html).not.toContain('data-testid="composio-open-auth-gmail"');
    expect(html).toContain('data-testid="composio-cancel-auth-gmail"');
    expect(html).toContain('data-testid="composio-remove-gmail"');
  });

  test.each([
    ['needs_auth', 'composio-authorize-gmail'],
    ['error', 'composio-reconnect-gmail'],
    ['revoked', 'composio-reconnect-gmail'],
    ['connected', null],
  ] as const)('allows disconnecting in %s state', (status, primaryTestId) => {
    const connector = makeConnector({ status, statusReason: null });
    const html = render(
      createElement(ComposioAppActions, {
        app: makeApp(connector),
        busy: null,
        authWait: null,
        deleting: false,
        onConnect: () => {},
        onAuthorize: () => {},
        onCancelAuth: () => {},
        onDisconnect: () => {},
      }),
    );
    if (primaryTestId !== null) expect(html).toContain(`data-testid="${primaryTestId}"`);
    expect(html).toContain('data-testid="composio-remove-gmail"');
    expect(html).toContain('断开');
  });
});
