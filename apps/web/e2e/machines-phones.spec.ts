import { expect, type Page, test } from '@playwright/test';

const MACHINES_06 = '/app/settings/machines?scenario=06';
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

test('a phone host with no phones shows no phone row', async ({ page }) => {
  await page.goto(MACHINES_PHONES);
  const empty = settings(page).locator(ITEM).filter({ hasText: 'empty-mac' });
  await expect(empty).toBeVisible();
  const list = settings(page).getByTestId('machine-list');
  const names = await list
    .locator(PHONE_ROW)
    .getByTestId('phone-name')
    .allTextContents();
  expect(names).toHaveLength(8);
  expect(names).not.toContain(expect.stringContaining('empty'));
});

test('paired and discovered phones appear as device rows with their state, while unpaired offline probes stay hidden', async ({
  page,
}) => {
  await page.goto(MACHINES_PHONES);
  const phones = settings(page).locator(PHONE_ROW);
  await expect(phones).toHaveCount(8);
  await expect(phones.filter({ hasText: '离线未配对手机' })).toHaveCount(0);
  await expect(phones.filter({ hasText: 'Pixel 8a' }).getByTestId('phone-state')).toHaveText(
    '就绪',
  );
  await expect(phones.filter({ hasText: 'Pixel 7' }).getByTestId('phone-state')).toHaveText(
    '已锁定，需要主人解锁',
  );
  await expect(phones.filter({ hasText: 'USB 手机' }).getByTestId('phone-state')).toHaveText(
    '配对中',
  );
  await expect(phones.filter({ hasText: '新手机' }).getByTestId('phone-state')).toHaveText('未配对');
  await expect(
    phones.filter({ hasText: '离线的手机' }).getByTestId('phone-state'),
  ).toHaveText('无法连接');
});

test('phone rows carry their own actions: pair, retry, forget', async ({ page }) => {
  await page.goto(MACHINES_PHONES);
  const phones = settings(page).locator(PHONE_ROW);
  await expect(phones.filter({ hasText: '新手机' }).getByTestId('phone-pair')).toBeVisible();
  await expect(phones.filter({ hasText: '旧手机' }).getByTestId('phone-retry')).toBeVisible();
  await expect(phones.filter({ hasText: 'Pixel 8a' }).getByTestId('phone-forget')).toBeVisible();
});

test('pairing a phone lives behind the 添加执行机 entry', async ({ page }) => {
  await page.goto(MACHINES_PHONES);
  await settings(page).getByRole('button', { name: '添加执行机' }).click();
  const dialog = page.getByRole('dialog', { name: '添加执行机' });
  await expect(dialog.getByTestId('phone-pair-entry')).toBeVisible();
  await dialog.getByTestId('phone-pair-entry').click();
  await expect(page.getByTestId('phone-pair-dialog')).toBeVisible();
});

test('without a phone host the add dialog shows no phone entry and no phone UI', async ({
  page,
}) => {
  await page.goto(MACHINES_06);
  await expect(page.locator(ITEM).first()).toBeVisible();
  await expect(page.locator(PHONE_ROW)).toHaveCount(0);
  await expect(page.getByTestId('phones-meta')).toHaveCount(0);
  await settings(page).getByRole('button', { name: '添加执行机' }).click();
  const dialog = page.getByRole('dialog', { name: '添加执行机' });
  await expect(dialog.getByTestId('phone-pair-entry')).toHaveCount(0);
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
