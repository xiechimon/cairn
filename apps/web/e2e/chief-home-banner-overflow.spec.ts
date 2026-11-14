import { expect, test } from '@playwright/test';
import { mockLive, PROJECT, TASK, THREAD } from './chief-home-mock';

const HOUR = 60 * 60 * 1000;
const machines = Array.from({ length: 5 }, (_, i) => ({
  id: `machine-${i}`,
  name: `expired-box-${i}`,
  teamId: 't1',
  online: true,
  latestCliVersion: null,
  kind: 'remote',
  enabledRuntimes: ['claude-code'],
  claudeLogin: { state: 'expired', expiresAt: Date.now() - HOUR },
}));
const subscriptions = Array.from({ length: 3 }, (_, i) => ({
  id: `sub-${i}`,
  label: `subscription-${i}`,
  expiresAt: Date.now() - HOUR,
  createdAt: 1,
}));

test('five expired machines and three expired subscriptions stay one banner and leave the composer and message area usable at 375x667', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await mockLive(
    page,
    { threads: [THREAD], messages: [], todos: [TASK], projects: [PROJECT], machines },
    (path, _route, json) =>
      path === '/api/teams/t1/claude-subscriptions' ? json(subscriptions) : undefined,
  );
  await page.goto('/app');
  const home = page.getByTestId('home-c');
  const banner = home.getByTestId('claude-login-banner');
  await expect(banner).toContainText('8 处 Claude 登录已过期');
  await expect(banner.getByTestId('claude-login-warning')).toHaveCount(0);
  await expect(banner.getByRole('link', { name: '查看 Runner' })).toHaveAttribute(
    'href',
    '/app/resources/machines',
  );
  await expect(banner.getByRole('link', { name: '查看订阅' })).toHaveAttribute(
    'href',
    '/app/resources/providers',
  );
  const composer = home.getByTestId('chief-composer-input');
  await expect(composer).toBeVisible();
  const box = await composer.boundingBox();
  expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(667);
  const body = await home.getByTestId('chief-body').boundingBox();
  expect(body?.height ?? 0).toBeGreaterThanOrEqual(200);
});
