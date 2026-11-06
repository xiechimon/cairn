import { expect, test } from '@playwright/test';
import { mockLive, PROJECT, TASK, THREAD } from './chief-home-mock';

const DAY = 24 * 60 * 60 * 1000;
const MACHINES = [
  {
    id: 'machine-omarchy',
    name: 'omarchy',
    teamId: 't1',
    online: true,
    latestCliVersion: null,
    kind: 'local',
    enabledRuntimes: ['pi', 'claude-code'],
    claudeLogin: { state: 'expiring', expiresAt: Date.now() + 2 * DAY },
  },
  {
    id: 'machine-ghost',
    name: 'ghost',
    teamId: 't1',
    online: true,
    latestCliVersion: null,
    kind: 'remote',
    enabledRuntimes: ['claude-code'],
    claudeLogin: { state: 'expired', expiresAt: Date.now() - 60 * 60 * 1000 },
  },
  {
    id: 'machine-steady',
    name: 'steady',
    teamId: 't1',
    online: true,
    latestCliVersion: null,
    kind: 'remote',
    enabledRuntimes: ['claude-code'],
    claudeLogin: { state: 'ok', expiresAt: Date.now() + 30 * DAY },
  },
  {
    id: 'machine-mystery',
    name: 'mystery',
    teamId: 't1',
    online: true,
    latestCliVersion: null,
    kind: 'remote',
    enabledRuntimes: ['claude-code'],
    claudeLogin: { state: 'unknown', expiresAt: Date.now() - 60 * 60 * 1000 },
  },
];

test('home warns for expiring and expired Claude Code logins above Needs you', async ({ page }) => {
  await mockLive(page, {
    threads: [THREAD],
    messages: [],
    todos: [TASK],
    projects: [PROJECT],
    machines: MACHINES,
  });
  await page.goto('/app');
  const home = page.getByTestId('home-c');
  const banner = home.getByTestId('claude-login-banner');
  await expect(banner).toBeVisible();
  await expect(banner.getByTestId('claude-login-summary')).toHaveText('1 处已过期，其余快到期。');
  await expect(banner).toContainText('2 处 Claude 登录需要处理');
  await expect(banner.getByRole('link', { name: '查看' })).toHaveAttribute(
    'href',
    '/app/resources/machines',
  );
  await expect(home.getByText('steady', { exact: true })).toHaveCount(0);
  await expect(home.getByText('mystery', { exact: true })).toHaveCount(0);
});
