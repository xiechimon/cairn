import { expect, test } from '@playwright/test';

const TELEGRAM = {
  id: 'conn-tg',
  platform: 'telegram',
  accountLabel: '@cairn_home_bot',
  status: 'ready',
  statusDetail: null,
  pairedSenders: [{ id: 'u-1', name: 'Mia Wong', chatKey: 'c-1', addedAt: 0 }],
  lastSendError: null,
  createdAt: 0,
};

test('IM: a connected Telegram bot is one row, and deleting it asks first', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('cairn.locale', 'en'));
  await page.route('**/api/**', (route, request) =>
    request.method() === 'GET'
      ? route.fulfill({ status: 500, json: { error: 'e2e stub: not the surface under test' } })
      : route.fallback(),
  );
  await page.route('**/api/teams', (route) =>
    route.fulfill({
      json: [{ id: 'team-1', name: 'Team', createdAt: 0, plan: 'free', avatarStyle: null }],
    }),
  );
  await page.route('**/api/user/me', (route) =>
    route.fulfill({ json: { id: 'user-1', displayName: 'Me', avatarUrl: null } }),
  );
  await page.route('**/api/teams/team-1/im/connections', (route) =>
    route.fulfill({ json: { connections: [TELEGRAM] } }),
  );
  await page.route('**/api/teams/team-1/im/pairing-requests', (route) =>
    route.fulfill({ json: { requests: [] } }),
  );
  const deletes: string[] = [];
  await page.route('**/api/teams/team-1/im/connections/conn-tg', (route, request) => {
    if (request.method() !== 'DELETE') return route.fallback();
    deletes.push(request.url());
    return route.fulfill({ status: 204, body: '' });
  });

  await page.goto('/app/settings/im');
  const settings = page.getByRole('dialog', { name: 'Settings' });
  const row = settings.getByTestId('im-connection-conn-tg');
  await expect(row).toBeVisible();
  await expect(settings.getByTestId('im-platform-telegram')).toHaveCount(0);
  await expect(settings.getByTestId('im-connect-telegram')).toHaveCount(0);
  await expect(row).toContainText('Connected · 1 paired contact');
  await expect(row).not.toContainText('contacts');
  await expect(settings.getByTestId('im-platform-slack')).toBeVisible();
  await expect(settings.getByTestId('im-platform-wechat')).toBeVisible();

  await row.getByRole('button', { name: '@cairn_home_bot menu' }).click();
  await page.getByTestId('im-delete-conn-tg').click();
  const confirm = page.getByRole('alertdialog');
  await expect(confirm).toBeVisible();
  expect(deletes).toEqual([]);
  await confirm.getByRole('button', { name: 'Delete' }).click();
  await expect.poll(() => deletes.length).toBe(1);
});
