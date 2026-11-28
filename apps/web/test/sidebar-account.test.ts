import type { CloudStatusResponse } from '@cairn/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { fetchCloudStatus } from '../src/api/hooks.js';
import { LiveDataContext } from '../src/api/provider.js';
import {
  type AccountHostRow,
  SidebarAccount,
  SidebarAccountPanel,
} from '../src/board/sidebar-account.js';
import { I18nProvider } from '../src/i18n/provider.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderTrigger(options: {
  cloud?: CloudStatusResponse;
  live?: boolean;
  displayName?: string;
}) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
  });
  if (options.cloud !== undefined) {
    qc.setQueryData(['cloudStatus'], options.cloud);
  }
  return renderToStaticMarkup(
    createElement(
      I18nProvider,
      {
        initialLocale: 'zh',
        children: createElement(QueryClientProvider, {
          client: qc,
          children: createElement(MemoryRouter, {
            initialEntries: ['/app'],
            children: createElement(LiveDataContext.Provider, {
              value: {
                live: options.live ?? true,
                teamId: 'team_1',
                userName: options.displayName ?? 'Local Ian',
                user: { displayName: options.displayName ?? 'Local Ian', avatarUrl: null },
                teamsQuery: undefined,
              },
              children: createElement(SidebarAccount),
            }),
          }),
        }),
      },
    ),
  );
}

const noop = () => {};

function renderPanel(options: {
  displayName: string;
  avatarUrl?: string | null;
  cloud?: CloudStatusResponse;
  linked: boolean;
  offerCloudSignIn?: boolean;
  desktopHostAvailable?: boolean;
  onRemoteHost?: boolean;
  hosts?: readonly AccountHostRow[];
}) {
  const cloud = options.cloud;
  const subscribed = cloud?.subscribed ?? false;
  return renderToStaticMarkup(
    createElement(I18nProvider, {
      initialLocale: 'zh',
      children: createElement(SidebarAccountPanel, {
        displayName: options.displayName,
        avatarSrc: options.avatarUrl ?? null,
        cloud,
        linked: options.linked,
        offerCloudSignIn: options.offerCloudSignIn ?? true,
        offerBillingPortal: options.linked && (subscribed || (cloud?.hasBillingCustomer ?? false)),
        workspaceUrl: cloud?.workspace?.url ?? null,
        onRemoteHost: options.onRemoteHost ?? false,
        desktopHostAvailable: options.desktopHostAvailable ?? false,
        hosts: options.hosts,
        connectPending: false,
        checkoutPending: false,
        portalPending: false,
        switchingHost: false,
        disconnectPending: false,
        onSignIn: noop,
        onAccountSettings: noop,
        onSubscribe: noop,
        onBillingPortal: noop,
        onOpenWorkspace: noop,
        onSwitchHost: noop,
        onSignOut: noop,
      }),
    }),
  );
}

function hostRowTag(html: string, id: string): string {
  return html.match(new RegExp(`<button[^>]*data-host-id="${id}"[^>]*>`))?.[0] ?? '';
}

function hostRowIsDisabled(html: string, id: string): boolean {
  return / disabled(=|>|\s)/.test(hostRowTag(html, id).replace(/ class="[^"]*"/, ''));
}

describe('SidebarAccount', () => {
  test('shows local user display name by default when unlinked', () => {
    const html = renderTrigger({
      displayName: 'Local Ian',
      cloud: {
        configured: true,
        linked: false,
        cloudReachable: true,
        user: null,
        subscribed: false,
        hasBillingCustomer: false,
        subscriptionStatus: null,
        currentPeriodEnd: null,
        workspace: null,
      },
    });
    expect(html).toContain('data-testid="sidebar-account"');
    expect(html).toContain('Local Ian');
  });

  test('renders unlinked upward popover with sign-in and account settings', () => {
    const html = renderPanel({
      displayName: 'Local Ian',
      linked: false,
      cloud: {
        configured: true,
        linked: false,
        cloudReachable: true,
        user: null,
        subscribed: false,
        hasBillingCustomer: false,
        subscriptionStatus: null,
        currentPeriodEnd: null,
        workspace: null,
      },
    });
    expect(html).toContain('Local Ian');
    expect(html).toContain('本机模式');
    expect(html).toContain('登录 Cairn 账号');
    expect(html).toContain('账号设置');
    expect(html).not.toContain('开通 Cairn 云端');
  });

  test('lists every desktop host in the account popover and marks the active one', () => {
    const html = renderPanel({
      displayName: 'Local Ian',
      linked: false,
      desktopHostAvailable: true,
      hosts: [
        { id: 'local', label: '本机', active: true, local: true, switchable: false },
        { id: 'remote-1', label: 'Mac mini', active: false, local: false, switchable: true },
      ],
    });
    expect(html).toContain('data-testid="account-host-list"');
    expect(html).toContain('Mac mini');
    expect(hostRowIsDisabled(html, 'remote-1')).toBe(false);
    expect(hostRowIsDisabled(html, 'local')).toBe(true);
    expect(hostRowTag(html, 'local')).toContain('data-host-active="true"');
    expect(html).toContain('当前');
  });

  test('offers only this computer while the workspace runs on a remote host', () => {
    const html = renderPanel({
      displayName: 'Remote Ian',
      linked: false,
      desktopHostAvailable: true,
      onRemoteHost: true,
      hosts: [
        { id: 'local', label: '本机', active: false, local: true, switchable: true },
        { id: 'remote-1', label: 'Mac mini', active: true, local: false, switchable: false },
      ],
    });
    expect(hostRowIsDisabled(html, 'local')).toBe(false);
    expect(hostRowIsDisabled(html, 'remote-1')).toBe(true);
    expect(hostRowTag(html, 'remote-1')).toContain('data-host-active="true"');
    expect(html).toContain('data-testid="account-host-hint"');
    expect(html).toContain('账号设置');
  });

  test('shows no host list when this computer is the only host or in a browser tab', () => {
    const singleHost = renderPanel({
      displayName: 'Local Ian',
      linked: false,
      desktopHostAvailable: true,
    });
    expect(singleHost).not.toContain('data-testid="account-host-list"');
    const browser = renderPanel({
      displayName: 'Local Ian',
      linked: false,
      hosts: [
        { id: 'local', label: '本机', active: true, local: true, switchable: false },
        { id: 'remote-1', label: 'Mac mini', active: false, local: false, switchable: true },
      ],
    });
    expect(browser).not.toContain('data-testid="account-host-list"');
  });

  test('switches trigger and panel to Clerk avatar and display name and shows subscribe button when unsubscribed', () => {
    const linkedCloud: CloudStatusResponse = {
      configured: true,
      linked: true,
      cloudReachable: true,
      user: {
        sub: 'user_clerk_1',
        name: 'mon X',
        email: null,
        avatarUrl: 'https://img.clerk.com/ey.png',
      },
      subscribed: false,
      hasBillingCustomer: false,
      subscriptionStatus: null,
      currentPeriodEnd: null,
      workspace: null,
    };
    const triggerHtml = renderTrigger({ displayName: 'Local Ian', cloud: linkedCloud });
    expect(triggerHtml).toContain('mon X');
    expect(triggerHtml).toContain('https://img.clerk.com/ey.png');

    const panelHtml = renderPanel({
      displayName: 'mon X',
      avatarUrl: 'https://img.clerk.com/ey.png',
      linked: true,
      cloud: linkedCloud,
    });
    expect(panelHtml).toContain('Cairn 云端 · 未订阅');
    expect(panelHtml).toContain('开通 Cairn 云端 ($12/月)');
    expect(panelHtml).not.toContain('管理订阅与发票');
    expect(panelHtml).toContain('迁移本机数据');
    expect(panelHtml).toContain('退出 Cairn 账号');
  });

  test('shows subscribed badge, billing portal, and ready cloud workspace action when subscribed', () => {
    const html = renderPanel({
      displayName: 'mon X',
      avatarUrl: 'https://img.clerk.com/ey.png',
      linked: true,
      cloud: {
        configured: true,
        linked: true,
        cloudReachable: true,
        user: {
          sub: 'user_clerk_1',
          name: 'mon X',
          email: null,
          avatarUrl: 'https://img.clerk.com/ey.png',
        },
        subscribed: true,
        hasBillingCustomer: true,
        subscriptionStatus: 'active',
        currentPeriodEnd: '2027-01-01T00:00:00.000Z',
        workspace: {
          appName: 'cairn-u-1234567890',
          url: 'https://cairn-u-1234567890.fly.dev',
          status: 'ready',
          region: 'sin',
        },
      },
    });
    expect(html).toContain('mon X');
    expect(html).toContain('已订阅');
    expect(html).not.toContain('开通 Cairn 云端 ($12/月)');
    expect(html).toContain('管理订阅与发票');
    expect(html).toContain('云端工作区已就绪');
    expect(html).toContain('打开云端工作区');
  });

  test('falls back silently to local display in fixture mode without cloud data', () => {
    const html = renderTrigger({ live: false, displayName: '我' });
    expect(html).toContain('我');
  });

  test('fetchCloudStatus falls back silently on 403 paired-device and 404 unsupported server', async () => {
    for (const status of [403, 404]) {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => Response.json({ error: 'nope' }, { status })),
      );
      await expect(fetchCloudStatus()).resolves.toMatchObject({
        configured: false,
        linked: false,
        user: null,
      });
    }
  });
});
