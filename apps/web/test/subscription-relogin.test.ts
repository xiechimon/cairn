import type { ProviderRecord, RoutingConnection } from '@cairn/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Verification } from '../src/api/account-verification.js';
import type { SubscriptionAccount } from '../src/api/claude-accounts.js';
import { AntigravityLoginBanner } from '../src/board/antigravity-login-banner.js';
import { ClaudeLoginBanner } from '../src/board/claude-login-banner.js';
import { DevinLoginBanner } from '../src/board/devin-login-banner.js';
import { TooltipProvider } from '../src/components/ui/tooltip.js';
import { resolveScenario } from '../src/fixtures/scenario.js';
import { I18nProvider } from '../src/i18n/provider.js';
import { ProvidersSection } from '../src/resources/providers-page.js';
import { SubscriptionDetail, subscriptionStatusView } from '../src/resources/subscription-detail.js';
import { type TFunc, translate } from '../src/i18n/translate.js';

vi.mock('../src/fixtures/scenario.js', { spy: true });
afterEach(() => vi.restoreAllMocks());

const NOW = Date.UTC(2026, 10, 25, 8);
const t: TFunc = (source, vars) => translate('zh', {}, source, vars);
const clock = () => '12:00';

function makeAccount(
  vendor: SubscriptionAccount['vendor'],
  overrides: Partial<SubscriptionAccount> = {},
): SubscriptionAccount {
  return {
    id: `${vendor}-sub-1`,
    vendor,
    label: `${vendor} 订阅`,
    expiresAt: NOW - 3_600_000,
    createdAt: NOW - 86_400_000,
    plan: null,
    state: 'expired',
    cooldownUntil: null,
    windows: [],
    lastUsedAt: null,
    stepsLast24h: 0,
    hasToken: true,
    models: [],
    ...overrides,
  };
}

function renderProviders(opts: {
  subscriptions?: SubscriptionAccount[];
  devinSubscriptions?: SubscriptionAccount[];
  antigravitySubscriptions?: SubscriptionAccount[];
  providers?: ProviderRecord[];
  connections?: RoutingConnection[];
}) {
  vi.mocked(resolveScenario).mockReturnValue({
    todos: [],
    now: NOW,
    resources: {
      skills: [],
      mcpServers: [],
      machines: [],
      providers: opts.providers ?? [],
      providerSources: [],
      accounts: {
        subscriptions: opts.subscriptions ?? [],
        devinSubscriptions: opts.devinSubscriptions ?? [],
        antigravitySubscriptions: opts.antigravitySubscriptions ?? [],
        otherAccounts: [],
        machines: [],
        providers: [],
        routing: { edges: [], connections: opts.connections ?? [], quota: [] },
      },
    },
  });
  return renderToStaticMarkup(
    createElement(I18nProvider, {
      initialLocale: 'zh',
      children: createElement(QueryClientProvider, {
        client: new QueryClient(),
        children: createElement(MemoryRouter, {
          children: createElement(TooltipProvider, null, createElement(ProvidersSection)),
        }),
      }),
    }),
  );
}

describe('expired and invalid subscription re-sign-in', () => {
  it.each(['antigravity', 'claude', 'devin'] as const)(
    'renders primary Sign in again button on expired %s subscription card',
    (vendor) => {
      const account = makeAccount(vendor);
      const html = renderProviders({
        ...(vendor === 'antigravity' ? { antigravitySubscriptions: [account] } : {}),
        ...(vendor === 'claude' ? { subscriptions: [account] } : {}),
        ...(vendor === 'devin' ? { devinSubscriptions: [account] } : {}),
      });
      expect(html).toContain('data-testid="subscription-sign-in-again"');
      expect(html).toContain('data-variant="default"');
      expect(html).toContain('重新登录');
      expect(html).not.toContain('移除并重新添加');
      expect(html).not.toContain('先移除它');
    },
  );

  it('does not render Sign in again on a healthy subscription card', () => {
    const account = makeAccount('antigravity', {
      state: 'ok',
      expiresAt: NOW + 86_400_000,
    });
    const html = renderProviders({ antigravitySubscriptions: [account] });
    expect(html).not.toContain('data-testid="subscription-sign-in-again"');
  });

  it('renders Sign in again when SubscriptionDetail receives onSignInAgain after auth failure', () => {
    const account = makeAccount('claude', { state: 'ok', expiresAt: null });
    const verification: Verification = { phase: 'failed', reason: 'auth' };
    const html = renderToStaticMarkup(
      createElement(I18nProvider, {
        initialLocale: 'zh',
        children: createElement(
          TooltipProvider,
          null,
          createElement(SubscriptionDetail, {
            account,
            models: [],
            now: NOW,
            view: subscriptionStatusView(account, NOW, t, clock),
            verification,
            actions: { onVerify: () => {}, onRemove: () => {}, onSignInAgain: () => {} },
          }),
        ),
      }),
    );
    expect(html).toContain('data-testid="subscription-sign-in-again"');
    expect(html).toContain('重新登录');
  });

  it('renders primary Sign in again button on unauthenticated Codex OAuth provider card', () => {
    const codex: ProviderRecord = {
      id: 'prov-codex',
      label: 'ChatGPT',
      kind: 'custom',
      providerId: 'openai-codex',
      baseUrl: 'https://chatgpt.com/backend-api/codex',
      api: 'openai-responses',
      authHeader: false,
      compat: {},
      models: [{ id: 'gpt-5-codex', name: 'GPT-5 Codex' }],
      createdBy: 'owner',
      createdAt: NOW,
      updatedAt: NOW,
    };
    const html = renderProviders({
      providers: [codex],
      connections: [
        {
          id: 'prov-codex',
          vendor: 'openai',
          kind: 'subscription',
          models: ['gpt-5-codex'],
          available: false,
        },
      ],
    });
    expect(html).toContain('data-testid="provider-sign-in-again"');
    expect(html).toContain('重新登录');
  });

  it('renders direct Sign in again action on Coordinator login banners', () => {
    const wrap = (node: ReturnType<typeof createElement>) =>
      renderToStaticMarkup(
        createElement(I18nProvider, {
          initialLocale: 'zh',
          children: createElement(
            QueryClientProvider,
            { client: new QueryClient() },
            createElement(MemoryRouter, null, node),
          ),
        }),
      );

    const agHtml = wrap(
      createElement(AntigravityLoginBanner, {
        warnings: [
          {
            key: 'ag-1',
            kind: 'expired',
            text: 'Antigravity 订阅：已过期',
            subscriptionId: 'ag-1',
            label: 'Antigravity 订阅',
            attachInPlace: true,
          },
        ],
      }),
    );
    expect(agHtml).toContain('data-testid="antigravity-login-relogin"');
    expect(agHtml).toContain('重新登录');

    const claudeHtml = wrap(
      createElement(ClaudeLoginBanner, {
        warnings: [
          {
            key: 'cl-1',
            kind: 'expired',
            text: 'Claude 订阅：已过期',
            subscriptionId: 'cl-1',
            label: 'Claude 订阅',
          },
        ],
      }),
    );
    expect(claudeHtml).toContain('data-testid="claude-login-relogin"');

    const devinHtml = wrap(
      createElement(DevinLoginBanner, {
        warnings: [
          {
            key: 'dv-1',
            kind: 'expired',
            text: 'Devin 订阅：已过期',
            subscriptionId: 'dv-1',
            label: 'Devin 订阅',
          },
        ],
      }),
    );
    expect(devinHtml).toContain('data-testid="devin-login-relogin"');
  });
});
