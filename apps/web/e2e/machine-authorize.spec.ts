import { expect, type Page, test } from '@playwright/test';

const AUTHORIZE = '/app/machines/authorize';
const POLL = '**/api/machine/enroll/poll';

async function pollSays(page: Page, body: Record<string, unknown>): Promise<void> {
  await page.route(POLL, (route) => route.fulfill({ status: 200, json: body }));
}

function card(page: Page) {
  return page.getByRole('region', { name: '授权机器' });
}

test('arriving with no params → idle face (backdrop + card + title + guide text + generate-authorization-link button)', async ({ page }) => {
  await page.goto(AUTHORIZE);
  await expect(page.locator('.authorize-backdrop')).toBeVisible();
  await expect(card(page)).toBeVisible();
  await expect(page.getByRole('heading', { name: '授权机器' })).toBeVisible();
  await expect(page.getByText('生成授权链接，在执行机上完成注册发起。')).toBeVisible();
  await expect(page.getByRole('button', { name: '生成授权链接' })).toBeEnabled();
});

test('?enroll=<id> + poll=pending → pending face (copy + confirm-authorization button)', async ({ page }) => {
  await pollSays(page, { status: 'pending' });
  await page.goto(`${AUTHORIZE}?enroll=e2e-enroll`);
  await expect(
    page.getByText('一台执行机请求加入你的团队。确认后它将以自己的凭据连接。'),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: '确认授权' })).toBeEnabled();
});

test('?enroll=<id> + poll=expired → expired face (copy, no button)', async ({ page }) => {
  await pollSays(page, { status: 'expired' });
  await page.goto(`${AUTHORIZE}?enroll=e2e-enroll`);
  await expect(page.getByText('授权链接已失效，请在执行机上重新发起。')).toBeVisible();
  await expect(card(page).getByRole('button')).toHaveCount(0);
});

test('?enroll=<id> + poll=authorized → done face (copy + machineId meta)', async ({ page }) => {
  await pollSays(page, {
    status: 'authorized',
    machine: {
      machineId: 'e2e-machine-id',
      token: 'e2e-token',
      teamId: 'e2e-team',
      serverUrl: 'http://127.0.0.1:1',
    },
  });
  await page.goto(`${AUTHORIZE}?enroll=e2e-enroll`);
  await expect(page.getByText('授权完成，机器已注册。')).toBeVisible();
  await expect(page.getByText('machineId: e2e-machine-id')).toBeVisible();
});