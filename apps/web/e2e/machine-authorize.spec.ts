import { expect, type Page, test } from '@playwright/test';

const AUTHORIZE = '/app/machines/authorize';
const POLL = '**/api/machine/enroll/poll';
const TAILSCALE = '**/api/remote/tailscale';
const TAILSCALE_URL = 'https://studio-mac.tail4c2a.ts.net';

async function pollSays(page: Page, body: Record<string, unknown>): Promise<void> {
  await page.route(POLL, (route) => route.fulfill({ status: 200, json: body }));
}

function card(page: Page) {
  return page.getByRole('region', { name: '授权执行机' });
}

test('arriving with no params → the start command for the checked Tailscale address, with copy and a way back', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.route(TAILSCALE, (route) =>
    route.fulfill({ status: 200, json: { state: 'ready', url: TAILSCALE_URL, consentUrl: null } }),
  );
  await page.goto(AUTHORIZE);
  await expect(page.locator('.authorize-backdrop')).toBeVisible();
  await expect(page.getByRole('heading', { name: '授权执行机' })).toBeVisible();
  const command = `cairn start --server ${TAILSCALE_URL}`;
  await expect(card(page).locator('code')).toHaveText([
    'npm install -g @xiechimon/cairn-cli@latest',
    command,
  ]);
  await card(page).getByRole('button', { name: '复制', exact: true }).nth(1).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(command);
  await page.getByRole('link', { name: '← 返回执行机' }).click();
  await page.waitForURL((u) => u.pathname === '/app/settings/machines');
});

test('without a checked Tailscale address the page sends you to Add Runner instead of a command', async ({ page }) => {
  await page.route(TAILSCALE, (route) =>
    route.fulfill({ status: 200, json: { state: 'not-connected', url: null, consentUrl: null } }),
  );
  await page.goto(AUTHORIZE);
  await expect(
    card(page).getByText('先在执行机页的「添加执行机」里用 Tailscale 连通这台电脑，命令会出现在这里。'),
  ).toBeVisible();
  await expect(card(page).locator('code')).toHaveCount(0);
});

test('before the first poll answers, confirm is disabled and says it is connecting', async ({ page }) => {
  await page.route(POLL, () => {});
  await page.goto(`${AUTHORIZE}?enroll=e2e-enroll`);
  await expect(page.getByRole('button', { name: '正在连接执行机…' })).toBeDisabled();
});

test('a failed confirm says what to do in a sentence and keeps the server text out of it', async ({ page }) => {
  await pollSays(page, { status: 'pending' });
  await page.route('**/api/machine/enroll/confirm', (route) =>
    route.fulfill({ status: 403, json: { error: 'enrollment team mismatch' } }),
  );
  await page.goto(`${AUTHORIZE}?enroll=e2e-enroll`);
  await page.getByRole('button', { name: '确认授权' }).click();
  const alert = card(page).getByRole('alert');
  await expect(alert).toHaveText(
    '授权没成功，请再试一次。还不行就在执行机上重新运行 cairn start。',
  );
  await expect(alert).toHaveAttribute('title', 'enrollment team mismatch');
  await expect(page.getByRole('button', { name: '确认授权' })).toBeEnabled();
});

test('a confirm that lost a race to another tab shows the authorized face, and an expired one the expired face', async ({
  page,
}) => {
  await pollSays(page, { status: 'pending' });
  let status = 409;
  await page.route('**/api/machine/enroll/confirm', (route) =>
    route.fulfill({ status, json: { error: 'x' } }),
  );
  await page.goto(`${AUTHORIZE}?enroll=e2e-enroll`);
  await page.getByRole('button', { name: '确认授权' }).click();
  await expect(card(page)).toContainText('授权完成，执行机已注册。');
  await expect(card(page).getByRole('alert')).toHaveCount(0);
  status = 404;
  await page.goto(`${AUTHORIZE}?enroll=e2e-other`);
  await page.getByRole('button', { name: '确认授权' }).click();
  await expect(card(page)).toContainText('授权链接过期了');
});

test('a poll that cannot reach the server says so under the disabled button', async ({ page }) => {
  await page.route(POLL, (route) => route.abort());
  await page.goto(`${AUTHORIZE}?enroll=e2e-enroll`);
  await expect(page.getByRole('button', { name: '正在连接执行机…' })).toBeDisabled();
  await expect(card(page).getByRole('status')).toHaveText('连不上服务器，正在重试。请检查网络。');
});

test('?enroll=<id> + poll=pending → pending face (copy + confirm-authorization button)', async ({ page }) => {
  await pollSays(page, { status: 'pending' });
  await page.goto(`${AUTHORIZE}?enroll=e2e-enroll`);
  await expect(page.getByText('有一台执行机请求加入你的团队。')).toBeVisible();
  await expect(page.getByRole('button', { name: '确认授权' })).toBeEnabled();
});

test('?enroll=<id> + poll=expired → expired face (copy, no button)', async ({ page }) => {
  await pollSays(page, { status: 'expired' });
  await page.goto(`${AUTHORIZE}?enroll=e2e-enroll`);
  await expect(card(page)).toContainText('授权链接过期了。在执行机上重新运行 cairn start 拿新链接。');
  await expect(card(page).getByRole('button')).toHaveCount(0);
});

test('?enroll=<id> + poll=authorized → done face, with no machine id', async ({ page }) => {
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
  await expect(page.getByText('授权完成，执行机已注册。')).toBeVisible();
  await expect(card(page)).not.toContainText('e2e-machine-id');
});
test('pending with a name → name row, self-report warning, done copy names the machine', async ({ page }) => {
  let authorized = false;
  await page.route(POLL, (route) =>
    route.fulfill({
      status: 200,
      json: authorized
        ? {
            status: 'authorized',
            machine: {
              machineId: 'e2e-machine-id',
              token: 'e2e-token',
              teamId: 'e2e-team',
              serverUrl: 'http://127.0.0.1:1',
            },
          }
        : { status: 'pending', name: 'omarchy' },
    }),
  );
  await page.route('**/api/machine/enroll/confirm', (route) => {
    authorized = true;
    return route.fulfill({
      status: 200,
      json: {
        machine: {
          machineId: 'e2e-machine-id',
          token: 'e2e-token',
          teamId: 'e2e-team',
          serverUrl: 'http://127.0.0.1:1',
        },
      },
    });
  });
  await page.goto(`${AUTHORIZE}?enroll=e2e-enroll`);
  await expect(card(page).getByText('机器名')).toBeVisible();
  await expect(card(page).getByText('omarchy')).toBeVisible();
  await expect(card(page)).toContainText('名字是那台电脑自己报的');
  await page.getByRole('button', { name: '确认授权' }).click();
  await expect(page.getByText('授权完成，omarchy 已注册为执行机。')).toBeVisible();
});
