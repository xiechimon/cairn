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

test('a Runner login that expires raises no banner: only stored subscriptions do', async ({ page }) => {
  await mockLive(page, {
    threads: [THREAD],
    messages: [],
    todos: [TASK],
    projects: [PROJECT],
    machines: MACHINES,
  });
  await page.goto('/app');
  const home = page.getByTestId('home-c');
  await expect(home.getByTestId('chief-composer-input')).toBeVisible();
  await expect(home.getByTestId('claude-login-banner')).toHaveCount(0);
});

test('home warns for expiring and expired Claude subscriptions above Needs you', async ({ page }) => {
  await mockLive(
    page,
    { threads: [THREAD], messages: [], todos: [TASK], projects: [PROJECT], machines: MACHINES },
    (path, _route, json) =>
      path === '/api/teams/t1/claude-subscriptions'
        ? json([
            { id: 'sub-old', label: 'old', expiresAt: Date.now() - 60 * 60 * 1000, createdAt: 1 },
            { id: 'sub-soon', label: 'soon', expiresAt: Date.now() + 2 * DAY, createdAt: 2 },
          ])
        : undefined,
  );
  await page.goto('/app');
  const home = page.getByTestId('home-c');
  const banner = home.getByTestId('claude-login-banner');
  await expect(banner).toBeVisible();
  await expect(banner.getByTestId('claude-login-summary')).toHaveText(
    '换上新的 token 之前，这些订阅不会接新任务。',
  );
  await expect(banner).toContainText('1 处已过期，1 处即将过期');
  await expect(banner.getByRole('link', { name: '查看' })).toHaveAttribute(
    'href',
    '/app/resources/providers',
  );
});
