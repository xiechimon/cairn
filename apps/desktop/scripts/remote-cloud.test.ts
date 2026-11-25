import { describe, expect, test, vi } from 'vitest';
import { appMenuTemplate } from '../src/app-menu.js';
import { offlinePageHtml } from '../src/offline-page.js';
import { isAllowedRemoteAuthUrl } from '../src/remote-auth.js';
import { trayMenuTemplate } from '../src/tray-menu.js';

describe('offlinePageHtml', () => {
  test('renders zh copy with Cairn tokens, retry button, and switch buttons excluding active host', () => {
    const html = offlinePageHtml({
      locale: 'zh',
      hostName: 'Cloud <prod>',
      hostUrl: 'https://cloud.example.com',
      activeId: 'remote-1',
      connections: [
        { id: 'local', kind: 'local', name: 'This computer' },
        { id: 'remote-1', kind: 'remote', name: 'Cloud <prod>' },
        { id: 'remote-2', kind: 'remote', name: 'Home Box' },
      ],
    });
    expect(html).toContain('无法连接到 Cloud &lt;prod&gt;');
    expect(html).toContain('https://cloud.example.com');
    expect(html).toContain('立即重试');
    expect(html).toContain('data-switch-id="local"');
    expect(html).toContain('切换到 本机');
    expect(html).toContain('data-switch-id="remote-2"');
    expect(html).not.toContain('data-switch-id="remote-1"');
    expect(html).not.toContain('Error:');
    expect(html).toContain('#e7e6e1');
    expect(html).toContain('#1b1c1b');
  });

  test('renders en copy cleanly', () => {
    const html = offlinePageHtml({
      locale: 'en',
      hostName: 'Cloud',
      hostUrl: 'https://cloud.example.com',
      activeId: 'remote-1',
      connections: [
        { id: 'local', kind: 'local', name: 'This computer' },
        { id: 'remote-1', kind: 'remote', name: 'Cloud' },
      ],
    });
    expect(html).toContain('Cannot reach Cloud');
    expect(html).toContain('Retry now');
    expect(html).toContain('Switch to This computer');
  });
});

describe('isAllowedRemoteAuthUrl', () => {
  const origin = 'https://cloud.example.com';
  const issuer = 'https://auth.example.com';

  test('allows app origin, exact https Clerk issuer, and dedicated OAuth auth paths', () => {
    expect(isAllowedRemoteAuthUrl('https://cloud.example.com/app', origin, issuer)).toBe(true);
    expect(isAllowedRemoteAuthUrl('https://auth.example.com/v1/oauth', origin, issuer)).toBe(true);
    expect(
      isAllowedRemoteAuthUrl('https://accounts.google.com/o/oauth2/v2/auth', origin, issuer),
    ).toBe(true);
    expect(isAllowedRemoteAuthUrl('https://github.com/login/oauth/authorize', origin, issuer)).toBe(
      true,
    );
    expect(
      isAllowedRemoteAuthUrl('https://clerk.shared.lcl.dev/v1/oauth_callback', origin, issuer),
    ).toBe(true);
  });

  test('rejects wildcard accounts.dev, http auth issuers, non-auth github repos, data URLs, and arbitrary sites', () => {
    expect(isAllowedRemoteAuthUrl('https://attacker.accounts.dev/sign-in', origin, issuer)).toBe(
      false,
    );
    expect(
      isAllowedRemoteAuthUrl('https://attacker.clerk.accounts.dev/sign-in', origin, null),
    ).toBe(false);
    expect(
      isAllowedRemoteAuthUrl('http://auth.example.com/v1/oauth', origin, 'http://auth.example.com'),
    ).toBe(false);
    expect(isAllowedRemoteAuthUrl('https://github.com/org/repo/pull/1', origin, issuer)).toBe(
      false,
    );
    expect(isAllowedRemoteAuthUrl('data:text/html,<script>alert(1)</script>', origin, issuer)).toBe(
      false,
    );
    expect(isAllowedRemoteAuthUrl('https://evil.example.net/phish', origin, issuer)).toBe(false);
    expect(isAllowedRemoteAuthUrl('javascript:alert(1)', origin, issuer)).toBe(false);
    expect(isAllowedRemoteAuthUrl('file:///etc/passwd', origin, issuer)).toBe(false);
  });
});

describe('Switch Host native menus', () => {
  test('appMenuTemplate includes Switch Host submenu when multiple hosts exist', () => {
    const switchHost = vi.fn();
    const menu = appMenuTemplate(
      { status: 'idle', version: '0.1.0' } as never,
      { check: vi.fn(), install: vi.fn() },
      { send: vi.fn(), back: vi.fn(), forward: vi.fn() },
      'en',
      {
        entries: [
          { id: 'local', label: 'This computer', active: false },
          { id: 'remote-1', label: 'Cloud', active: true },
        ],
        switchHost,
      },
    );
    const appSubmenu = menu[0]?.submenu as Array<{
      label?: string;
      submenu?: Array<{ click?: () => void }>;
    }>;
    const switcher = appSubmenu.find((item) => item.label === 'Switch Host');
    expect(switcher).toBeDefined();
    switcher?.submenu?.[0]?.click?.();
    expect(switchHost).toHaveBeenCalledWith('local');
  });

  test('trayMenuTemplate includes Switch Host submenu when multiple hosts exist', () => {
    const switchHost = vi.fn();
    const items = trayMenuTemplate('cloud.example.com', false, {
      open: vi.fn(),
      setKeepAwake: vi.fn(),
      hosts: [
        { id: 'local', label: 'This computer', active: false },
        { id: 'remote-1', label: 'Cloud', active: true },
      ],
      switchHost,
      quit: vi.fn(),
    });
    const switcher = items.find((item) => item.label === 'Switch Host') as
      | { submenu?: Array<{ click?: () => void }> }
      | undefined;
    expect(switcher).toBeDefined();
    switcher?.submenu?.[0]?.click?.();
    expect(switchHost).toHaveBeenCalledWith('local');
  });
});
