import { expect, type Page, test } from '@playwright/test';

const MACHINES_NO_SUPPORT = '/app/settings/machines?scenario=phone-no-support';
const MACHINES_PHONES = '/app/settings/machines?scenario=phone-states';
const MACHINES_ORDER = '/app/settings/machines?scenario=runners-order';
const ITEM = '[data-testid="machine-item"]';
const PHONE_ROW = '[data-testid="phone-row"]';

const settings = (page: Page) => page.getByRole('dialog', { name: '设置' });

test('a machine row carries no phone disclosure or empty-state text', async ({ page }) => {
  await page.goto(MACHINES_PHONES);
  await expect(page.locator(ITEM).first()).toBeVisible();
  await expect(settings(page).getByTestId('phones-meta')).toHaveCount(0);
  await expect(settings(page).getByTestId('phones-drawer')).toHaveCount(0);
  await expect(settings(page).getByTestId('phones-empty')).toHaveCount(0);
});

test('a phone host with no phones shows no phone row and no placeholder row', async ({ page }) => {
  await page.goto(MACHINES_NO_SUPPORT);
  await expect(settings(page).locator(ITEM)).toHaveCount(1);
  await expect(settings(page).locator(PHONE_ROW)).toHaveCount(0);
  await expect(settings(page).getByTestId('phone-add')).toHaveCount(0);
  await expect(settings(page).getByText('安卓手机')).toHaveCount(0);

  await page.goto(MACHINES_PHONES);
  const empty = settings(page).locator(ITEM).filter({ hasText: 'empty-mac' });
  await expect(empty).toBeVisible();
  const list = settings(page).getByTestId('machine-list');
  const names = await list
    .locator(PHONE_ROW)
    .getByTestId('phone-name')
    .allTextContents();
  expect(names).toHaveLength(9);
  expect(names).not.toContain(expect.stringContaining('empty'));
});

test('paired and discovered phones appear as device rows with kind, capability, and state, while unpaired offline probes stay hidden', async ({
  page,
}) => {
  await page.goto(MACHINES_PHONES);
  const phones = settings(page).locator(PHONE_ROW);
  await expect(phones).toHaveCount(9);
  await expect(phones.filter({ hasText: '离线未配对手机' })).toHaveCount(0);
  await expect(phones.filter({ hasText: 'Pixel 8a' }).getByTestId('phone-kind')).toHaveText(
    '安卓手机',
  );
  await expect(phones.filter({ hasText: 'Pixel 8a' }).getByTestId('phone-capability')).toHaveText(
    'Agent 可查看和操作',
  );
  await expect(phones.filter({ hasText: 'Pixel 8a' }).getByTestId('phone-state')).toHaveText(
    '就绪',
  );
  await expect(phones.filter({ hasText: 'Pixel 7' }).getByTestId('phone-state')).toHaveText(
    '已锁定，需要主人解锁',
  );
  await expect(phones.filter({ hasText: 'USB 手机' }).getByTestId('phone-state')).toHaveText(
    '配对中',
  );
  await expect(phones.filter({ hasText: '新手机' }).getByTestId('phone-kind')).toHaveText(
    '安卓手机',
  );
  await expect(phones.filter({ hasText: '新手机' }).getByTestId('phone-capability')).toHaveText(
    '配对后可供 Agent 查看和操作',
  );
  await expect(phones.filter({ hasText: '新手机' }).getByTestId('phone-state')).toHaveText('未配对');
  await expect(
    phones.filter({ hasText: '未授权的手机' }).getByTestId('phone-state'),
  ).toHaveText('需要重新配对');
  await expect(
    phones.filter({ hasText: '离线的手机' }).getByTestId('phone-state'),
  ).toHaveText('无法连接');
});

test('remote runners reporting phones do not surface phone rows under settings', async ({
  page,
}) => {
  await page.route('**/api/**', (route, request) => {
    if (request.method() !== 'GET') return route.fallback();
    return route.fulfill({ status: 500, json: { error: 'e2e stub' } });
  });
  await page.route('**/api/teams', (route) =>
    route.fulfill({
      json: [
        {
          id: 'team-1',
          name: 'Team',
          createdAt: 0,
          plan: 'free',
          avatarStyle: null,
          defaultMachineId: 'm-remote',
        },
      ],
    }),
  );
  await page.route('**/api/user/me', (route) =>
    route.fulfill({ json: { id: 'user-1', displayName: '我', avatarUrl: null } }),
  );
  await page.route('**/api/teams/team-1/machines', (route) =>
    route.fulfill({
      json: [
        {
          id: 'm-remote',
          name: 'remote-laptop',
          teamId: 'team-1',
          online: true,
          latestCliVersion: null,
          kind: 'remote',
          enabledRuntimes: ['pi'],
          capabilities: {
            osPlatform: 'darwin',
            mcpServers: [],
            skills: [],
            phoneHost: true,
            phones: [
              {
                deviceId: 'emulator-5554',
                platform: 'android',
                name: 'sdk gphone64 arm64',
                link: 'ready',
              },
            ],
          },
        },
      ],
    }),
  );
  await page.route('**/api/teams/team-1/members', (route) => route.fulfill({ json: [] }));
  try {
    await page.goto('/app/settings/machines');
    await expect(settings(page).locator(ITEM)).toHaveCount(1);
    await expect(settings(page).locator(PHONE_ROW)).toHaveCount(0);
    await expect(settings(page).getByText('sdk gphone64 arm64')).toHaveCount(0);
    await settings(page).locator(ITEM).first().getByTestId('machine-menu').click();
    await expect(page.getByTestId('machine-menu-pair-phone')).toHaveCount(0);
  } finally {
    await page.unrouteAll({ behavior: 'wait' });
  }
});

test('phone rows carry their own actions: pair, retry, forget', async ({ page }) => {
  await page.goto(MACHINES_PHONES);
  const phones = settings(page).locator(PHONE_ROW);
  await expect(phones.filter({ hasText: '新手机' }).getByTestId('phone-pair')).toBeVisible();
  await expect(phones.filter({ hasText: '旧手机' }).getByTestId('phone-retry')).toBeVisible();
  await expect(phones.filter({ hasText: 'Pixel 8a' }).getByTestId('phone-forget')).toBeVisible();
});

test('each hostable machine menu offers phone pairing; the add-machine shortcut does not guess among several hosts', async ({
  page,
}) => {
  await page.goto(MACHINES_PHONES);
  await expect(settings(page).getByTestId('phone-add')).toHaveCount(0);
  await settings(page)
    .locator(ITEM)
    .filter({ hasText: 'runner-mac' })
    .getByTestId('machine-menu')
    .click();
  await expect(page.getByTestId('machine-menu-pair-phone')).toContainText('配对安卓手机…');
  await page.getByTestId('machine-menu-pair-phone').click();
  await expect(page.getByRole('dialog', { name: '配对手机' })).toContainText('IP:端口');
  await page.keyboard.press('Escape');
  await settings(page).getByRole('button', { name: '添加执行机' }).click();
  const dialog = page.getByRole('dialog', { name: '添加执行机' });
  await expect(dialog.getByTestId('phone-pair-entry')).toHaveCount(0);
});

test('the pair dialog keeps submit disabled until a private endpoint, code and consent are present', async ({
  page,
}) => {
  await page.goto(MACHINES_NO_SUPPORT);
  await settings(page).locator(ITEM).first().getByTestId('machine-menu').click();
  await page.getByTestId('machine-menu-pair-phone').click();
  await expect(page.getByRole('dialog', { name: '配对手机' })).toContainText('安卓 11');
  const endpoint = page.getByTestId('phone-pair-endpoint');
  const code = page.getByTestId('phone-pair-code');
  const consent = page.getByTestId('phone-pair-consent');
  const submit = page.getByTestId('phone-pair-submit');
  await expect(submit).toBeDisabled();
  await endpoint.fill('8.8.8.8:37001');
  await code.fill('123456');
  await consent.click();
  await expect(submit).toBeDisabled();
  await endpoint.fill('192.168.1.20:37001');
  await expect(submit).toBeEnabled();
  await consent.click();
  await expect(submit).toBeDisabled();
  await page.getByRole('button', { name: '取消' }).click();
  await expect(page.getByTestId('phone-pair-dialog')).toHaveCount(0);
});

test('a pending pair submission cannot be cancelled or dismissed, then closes on success', async ({
  page,
}) => {
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let paired = false;
  const phone = {
    id: 'ph-new',
    machineId: 'ph-no-support',
    platform: 'android',
    deviceId: 'android:eeee5555ffff6666',
    name: 'Pixel 8a',
    consented: true,
    pairing: false,
    busy: false,
    handoff: false,
    lastError: null,
    createdAt: 1,
  };
  await page.route('**/api/**', (route, request) => {
    if (request.method() !== 'GET') return route.fallback();
    return route.fulfill({ status: 500, json: { error: 'e2e stub' } });
  });
  await page.route('**/api/teams', (route) =>
    route.fulfill({
      json: [
        {
          id: 'team-1',
          name: 'Team',
          createdAt: 0,
          plan: 'free',
          avatarStyle: null,
          defaultMachineId: 'ph-no-support',
        },
      ],
    }),
  );
  await page.route('**/api/user/me', (route) =>
    route.fulfill({ json: { id: 'user-1', displayName: '我', avatarUrl: null } }),
  );
  await page.route('**/api/teams/team-1/machines', (route) =>
    route.fulfill({
      json: [
        {
          id: 'ph-no-support',
          name: 'no-adb-mac',
          teamId: 'team-1',
          online: true,
          latestCliVersion: null,
          kind: 'local',
          enabledRuntimes: ['pi'],
          capabilities: { osPlatform: 'darwin', mcpServers: [], skills: [] },
        },
      ],
    }),
  );
  await page.route('**/api/teams/team-1/members', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/machines/ph-no-support/phones', async (route, request) => {
    if (request.method() === 'GET') {
      return route.fulfill({ json: { phones: paired ? [phone] : [] } });
    }
    if (request.method() === 'POST') {
      await gate;
      paired = true;
      return route.fulfill({ status: 201, json: { phone } });
    }
    return route.fallback();
  });
  try {
    await page.goto('/app/settings/machines');
    await settings(page).locator(ITEM).first().getByTestId('machine-menu').click();
    await page.getByTestId('machine-menu-pair-phone').click();
    await page.getByTestId('phone-pair-endpoint').fill('192.168.1.20:37001');
    await page.getByTestId('phone-pair-code').fill('123456');
    await page.getByTestId('phone-pair-consent').click();
    await page.getByTestId('phone-pair-submit').click();
    await expect(page.getByTestId('phone-pair-submit')).toBeDisabled();
    await expect(page.getByRole('button', { name: '取消' })).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('phone-pair-endpoint')).toHaveValue('192.168.1.20:37001');
    release?.();
    await expect(page.getByTestId('phone-pair-dialog')).toHaveCount(0);
  } finally {
    release?.();
    await page.unrouteAll({ behavior: 'wait' });
  }
});

test('an online local Mac shows the phone entry in its menu and add-machine without an empty phone row', async ({
  page,
}) => {
  await page.goto(MACHINES_NO_SUPPORT);
  await expect(page.locator(ITEM).first()).toBeVisible();
  await expect(page.locator(PHONE_ROW)).toHaveCount(0);
  await expect(settings(page).getByTestId('phone-add')).toHaveCount(0);
  await expect(settings(page).getByText('安卓手机')).toHaveCount(0);
  await settings(page).locator(ITEM).first().getByTestId('machine-menu').click();
  await expect(page.getByTestId('machine-menu-pair-phone')).toContainText('配对安卓手机…');
  await page.keyboard.press('Escape');
  await settings(page).getByRole('button', { name: '添加执行机' }).click();
  const dialog = page.getByRole('dialog', { name: '添加执行机' });
  await expect(dialog.getByTestId('phone-pair-entry')).toHaveText('配对安卓手机');
});

test('an offline local Mac still loads paired phones and lets the owner remove them', async ({
  page,
}) => {
  let phones = [
    {
      id: 'ph-off-1',
      machineId: 'ph-offline-mac',
      platform: 'android',
      deviceId: 'android:1111222233334444',
      name: 'Offline Pixel',
      consented: true,
      pairing: false,
      busy: false,
      handoff: false,
      lastError: null,
      createdAt: 1,
    },
  ];
  await page.route('**/api/**', (route, request) => {
    if (request.method() !== 'GET') return route.fallback();
    return route.fulfill({ status: 500, json: { error: 'e2e stub' } });
  });
  await page.route('**/api/teams', (route) =>
    route.fulfill({
      json: [
        {
          id: 'team-1',
          name: 'Team',
          createdAt: 0,
          plan: 'free',
          avatarStyle: null,
          defaultMachineId: 'ph-offline-mac',
        },
      ],
    }),
  );
  await page.route('**/api/user/me', (route) =>
    route.fulfill({ json: { id: 'user-1', displayName: '我', avatarUrl: null } }),
  );
  await page.route('**/api/teams/team-1/machines', (route) =>
    route.fulfill({
      json: [
        {
          id: 'ph-offline-mac',
          name: 'offline-mac',
          teamId: 'team-1',
          online: false,
          lastSeenAt: 1_700_000_000_000,
          latestCliVersion: null,
          kind: 'local',
          enabledRuntimes: ['pi'],
          capabilities: { osPlatform: 'darwin', mcpServers: [], skills: [] },
        },
      ],
    }),
  );
  await page.route('**/api/teams/team-1/members', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/machines/ph-offline-mac/phones**', async (route, request) => {
    if (request.method() === 'GET') {
      return route.fulfill({ json: { phones } });
    }
    if (request.method() === 'DELETE') {
      phones = [];
      return route.fulfill({ json: { outcome: 'forgotten' } });
    }
    return route.fallback();
  });
  try {
    await page.goto('/app/settings/machines');
    const row = settings(page).locator(PHONE_ROW).filter({ hasText: 'Offline Pixel' });
    await expect(row.getByTestId('phone-kind')).toHaveText('安卓手机');
    await expect(row.getByTestId('phone-capability')).toHaveText('Agent 可查看和操作');
    await expect(row.getByTestId('phone-state')).toHaveText('无法连接');
    await expect(settings(page).getByTestId('phone-add')).toHaveCount(0);
    await row.getByTestId('phone-forget').click();
    await page.getByRole('alertdialog', { name: '移除手机' }).getByRole('button', { name: '删除' }).click();
    await expect(settings(page).locator(PHONE_ROW)).toHaveCount(0);
    await settings(page).locator(ITEM).first().getByTestId('machine-menu').click();
    await expect(page.getByTestId('machine-menu-pair-phone')).toHaveCount(0);
  } finally {
    await page.unrouteAll({ behavior: 'wait' });
  }
});

test('runners render default first, then online, then offline, and stale offline rows can be removed from their menu', async ({
  page,
}) => {
  await page.goto(MACHINES_ORDER);
  const items = settings(page).locator(ITEM);
  await expect(items).toHaveCount(5);
  await expect(items.getByTestId('machine-item-name')).toHaveText([
    'mac-mini',
    'studio-mac.local',
    'build-linux',
    'travel-mac',
    'old-laptop',
  ]);
  await expect(items.first().getByTestId('machine-default')).toHaveText('默认');
  const stale = items.filter({
    has: page.getByTestId('machine-item-name').filter({ hasText: /^travel-mac$/ }),
  });
  await stale.getByTestId('machine-menu').click();
  await expect(page.getByTestId('machine-menu-delete')).toBeEnabled();
});

test('setting a runner as default moves it to the first row immediately', async ({ page }) => {
  let defaultMachineId: string | null = 'm-local';
  const rows = [
    {
      id: 'm-local',
      name: 'studio-mac.local',
      teamId: 'team-1',
      online: true,
      latestCliVersion: null,
      kind: 'local',
      enabledRuntimes: ['pi'],
    },
    {
      id: 'm-stale',
      name: 'studio-mac',
      teamId: 'team-1',
      online: false,
      latestCliVersion: null,
      kind: 'remote',
      enabledRuntimes: ['pi'],
    },
    {
      id: 'm-mini',
      name: 'mac-mini',
      teamId: 'team-1',
      online: true,
      latestCliVersion: null,
      kind: 'remote',
      enabledRuntimes: ['pi'],
    },
  ];
  await page.route('**/api/**', (route, request) => {
    if (request.method() !== 'GET') return route.fallback();
    return route.fulfill({ status: 500, json: { error: 'e2e stub' } });
  });
  await page.route('**/api/teams', (route) =>
    route.fulfill({
      json: [
        {
          id: 'team-1',
          name: 'Team',
          createdAt: 0,
          plan: 'free',
          avatarStyle: null,
          defaultMachineId,
        },
      ],
    }),
  );
  await page.route('**/api/user/me', (route) =>
    route.fulfill({ json: { id: 'user-1', displayName: '我', avatarUrl: null } }),
  );
  await page.route('**/api/teams/team-1/machines', (route) => route.fulfill({ json: rows }));
  await page.route('**/api/teams/team-1/members', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/machines/*', async (route, request) => {
    if (request.method() !== 'PATCH') return route.fallback();
    const id = new URL(request.url()).pathname.split('/').pop() ?? '';
    const body = request.postDataJSON() as { isDefault?: boolean };
    if (body.isDefault === true) defaultMachineId = id;
    const target = rows.find((entry) => entry.id === id) ?? rows[0];
    return route.fulfill({ json: target });
  });

  await page.goto('/app/settings/machines');
  const items = settings(page).locator(ITEM);
  await expect(items.getByTestId('machine-item-name')).toHaveText([
    'studio-mac.local',
    'mac-mini',
    'studio-mac',
  ]);
  await items.filter({ hasText: 'mac-mini' }).getByTestId('machine-menu').click();
  await page.getByTestId('machine-menu-default').click();
  await expect(items.getByTestId('machine-item-name')).toHaveText([
    'mac-mini',
    'studio-mac.local',
    'studio-mac',
  ]);
  await expect(items.first().getByTestId('machine-default')).toHaveText('默认');
});
