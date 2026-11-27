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
  const why = 'Connect a Telegram bot, Slack, iMessage or WeChat and talk to the Coordinator from your phone.';
  await expect(page.getByText(why)).toHaveCount(0);
  await settings.getByRole('button', { name: why }).focus();
  await expect(page.getByText(why)).toBeVisible();
  await page.keyboard.press('Escape');

  await row.getByRole('button', { name: '@cairn_home_bot menu' }).click();
  await page.getByTestId('im-delete-conn-tg').click();
  const confirm = page.getByRole('alertdialog');
  await expect(confirm).toBeVisible();
  expect(deletes).toEqual([]);
  await confirm.getByRole('button', { name: 'Delete' }).click();
  await expect.poll(() => deletes.length).toBe(1);
});

test('IM: the Slack connect dialog opens with the App-Level Token field focused', async ({
  page,
}) => {
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
    route.fulfill({ json: { connections: [] } }),
  );
  await page.route('**/api/teams/team-1/im/pairing-requests', (route) =>
    route.fulfill({ json: { requests: [] } }),
  );

  await page.goto('/app/settings/im');
  const settings = page.getByRole('dialog', { name: 'Settings' });
  await settings.getByTestId('im-connect-slack').click();
  const dialog = page.getByRole('dialog', { name: 'Connect Slack' });
  await expect(dialog.getByTestId('im-app-token-input')).toBeFocused();

  const link = dialog.getByRole('link', { name: "Create a Slack app with Cairn's settings" });
  await expect(link).toBeVisible();
  const instruction = dialog.getByText('Create a Slack app, then paste its two tokens here.');
  const linkBox = await link.boundingBox();
  const instructionBox = await instruction.boundingBox();
  if (linkBox === null || instructionBox === null) {
    throw new Error('expected both the manifest link and the instruction line to have boxes');
  }
  expect(linkBox.y).toBeGreaterThanOrEqual(instructionBox.y + instructionBox.height);
});

test('IM: degraded connections show Reconnect and expired WeChat shows Rescan', async ({
  page,
}) => {
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
  const connections = [
    {
      id: 'conn-imsg',
      platform: 'imessage',
      accountLabel: 'Mac mini',
      status: 'degraded',
      statusDetail: 'imsg send denied (-1743)',
      pairedSenders: [],
      lastSendError: null,
      createdAt: 0,
    },
    {
      id: 'conn-wx-deg',
      platform: 'wechat',
      accountLabel: 'WeChat bot',
      status: 'degraded',
      statusDetail: 'network error',
      pairedSenders: [],
      lastSendError: null,
      createdAt: 1,
    },
    {
      id: 'conn-wx-exp',
      platform: 'wechat',
      accountLabel: 'WeChat expired',
      status: 'expired',
      statusDetail: 'session expired',
      pairedSenders: [],
      lastSendError: null,
      createdAt: 2,
    },
  ];
  await page.route('**/api/teams/team-1/im/connections', (route) =>
    route.fulfill({ json: { connections } }),
  );
  await page.route('**/api/teams/team-1/im/pairing-requests', (route) =>
    route.fulfill({ json: { requests: [] } }),
  );
  const reconnects: string[] = [];
  await page.route('**/api/teams/team-1/im/connections/*/reconnect', (route, request) => {
    reconnects.push(request.url());
    return route.fulfill({ json: { connection: { ...connections[0], status: 'connecting' } } });
  });

  await page.goto('/app/settings/im');
  const settings = page.getByRole('dialog', { name: 'Settings' });

  await expect(settings.getByTestId('im-reconnect-conn-imsg')).toBeVisible();
  await expect(settings.getByTestId('im-reconnect-conn-wx-deg')).toBeVisible();
  await expect(settings.getByTestId('im-rescan-conn-wx-exp')).toBeVisible();
  await expect(settings.getByTestId('im-reconnect-conn-wx-exp')).toHaveCount(0);

  await settings.getByTestId('im-reconnect-conn-imsg').click();
  await expect.poll(() => reconnects.length).toBe(1);
});

test('IM: ready connection menu triggers reconnect and maps lastSendError across statuses', async ({
  page,
}) => {
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
  const connections = [
    {
      ...TELEGRAM,
      lastSendError: 'raw 500 upstream timeout',
    },
    {
      id: 'conn-sl',
      platform: 'slack',
      accountLabel: 'xmon',
      status: 'degraded',
      statusDetail: null,
      pairedSenders: [],
      lastSendError: 'raw socket closed',
      createdAt: 1,
    },
  ];
  await page.route('**/api/teams/team-1/im/connections', (route) =>
    route.fulfill({ json: { connections } }),
  );
  await page.route('**/api/teams/team-1/im/pairing-requests', (route) =>
    route.fulfill({ json: { requests: [] } }),
  );
  const reconnects: string[] = [];
  const deletes: string[] = [];
  await page.route('**/api/teams/team-1/im/connections/*/reconnect', (route, request) => {
    reconnects.push(request.url());
    return route.fulfill({ json: { connection: { ...connections[0], status: 'connecting' } } });
  });
  await page.route('**/api/teams/team-1/im/connections/conn-tg', (route, request) => {
    if (request.method() === 'DELETE') deletes.push(request.url());
    return route.fallback();
  });

  await page.goto('/app/settings/im');
  const settings = page.getByRole('dialog', { name: 'Settings' });

  const tgRow = settings.getByTestId('im-connection-conn-tg');
  await expect(tgRow).toContainText('Last reply failed to send');
  await expect(tgRow).not.toContainText('raw 500 upstream timeout');
  await expect(tgRow.locator('[title="raw 500 upstream timeout"]')).toBeVisible();

  const slRow = settings.getByTestId('im-connection-conn-sl');
  await expect(slRow).toContainText('Last reply failed to send');
  await expect(slRow).not.toContainText('raw socket closed');
  await expect(slRow.locator('[title="raw socket closed"]')).toBeVisible();

  await tgRow.getByRole('button', { name: '@cairn_home_bot menu' }).click();
  await page.getByTestId('im-reconnect-menu-conn-tg').click();
  await expect.poll(() => reconnects.length).toBe(1);
  expect(deletes).toEqual([]);
});

test('IM pairing banner pops up on /app, enforces arm delay, and fits 390px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
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
  await page.route('**/api/remote/pairing-requests', (route) =>
    route.fulfill({ json: { requests: [] } }),
  );
  let approved = false;
  await page.route('**/api/teams/team-1/im/pairing-requests', (route) =>
    route.fulfill({
      json: {
        requests: approved
          ? []
          : [
              {
                id: 'pair-im-1',
                connId: 'conn-sl',
                platform: 'slack',
                senderId: 'U0TEST1',
                senderName: 'Alex Rivera With An Unusually Long Workspace Display Name',
                chatKey: 'D0CHAT1',
                status: 'pending',
                requestedAt: 1,
                decidedAt: null,
              },
            ],
      },
    }),
  );
  const approvals: string[] = [];
  await page.route('**/api/teams/team-1/im/pairing-requests/pair-im-1/approve', (route) => {
    approvals.push('pair-im-1');
    approved = true;
    return route.fulfill({
      json: {
        request: {
          id: 'pair-im-1',
          connId: 'conn-sl',
          platform: 'slack',
          senderId: 'U0TEST1',
          senderName: 'Alex Rivera With An Unusually Long Workspace Display Name',
          chatKey: 'D0CHAT1',
          status: 'approved',
          requestedAt: 1,
          decidedAt: 2,
        },
      },
    });
  });

  await page.goto('/app');
  const banner = page.getByTestId('im-pairing-request-banner');
  await expect(banner).toBeVisible();
  await expect(banner).toContainText('New chat app pairing request');
  await expect(banner).toContainText('Slack · Alex Rivera With An Unusually Long Workspace Display Name');

  const approve = banner.getByTestId('im-pairing-banner-approve');
  await expect(approve).toBeDisabled();

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(overflow).toBe(false);

  await expect(approve).toBeEnabled({ timeout: 3_000 });
  await approve.click();
  await expect.poll(() => approvals.length).toBe(1);
  await expect(banner).toHaveCount(0);
});
