import { expect, type Page, test } from '@playwright/test';

const MACHINES = '/app/resources/machines?scenario=06';
const TAILSCALE_URL = 'https://studio-mac.tail4c2a.ts.net';

async function openDialog(page: Page, path = MACHINES) {
  await page.goto(path);
  await page.getByRole('button', { name: '添加执行机' }).click();
  const dialog = page.getByRole('dialog', { name: '添加执行机' });
  await expect(dialog).toBeVisible();
  return dialog;
}

test('the start command carries the checked Tailscale address, not the page origin', async ({
  page,
}) => {
  const dialog = await openDialog(page);
  await expect(dialog).toHaveAccessibleName('添加执行机');
  await expect(dialog.getByTestId('tailscale-ready')).toHaveText(
    `已连通，另一台电脑用这个地址连回来：${TAILSCALE_URL}`,
  );
  await expect(dialog.getByTestId('enrollment-code-hint')).toHaveText(
    "终端会显示一个批准码。把它填在下面，确认把那台电脑加入团队 Xmon Dai's team。",
  );
  const commands = dialog.locator('code');
  await expect(commands).toHaveCount(2);
  await expect(commands.nth(0)).toHaveText('npm install -g @xiechimon/cairn-cli@latest');
  await expect(commands.nth(1)).toHaveText(`cairn start --server ${TAILSCALE_URL}`);
  expect(new URL(page.url()).origin).not.toBe(TAILSCALE_URL);
  await expect(dialog.getByText('有条件时优先使用云主机', { exact: false })).toHaveCount(0);
  // API key disclosure collapsed by default
  await expect(
    dialog.getByRole('button', { name: '在云服务器上运行？改用 API key 注册' }),
  ).toBeVisible();
  await expect(dialog.getByRole('link', { name: '获取 API key →' })).toHaveCount(0);
});

test('the approval code from the terminal approves the computer inside the dialog', async ({
  page,
}) => {
  let confirmed: unknown = null;
  await page.route('**/api/machine/enroll/confirm', async (route) => {
    confirmed = route.request().postDataJSON();
    await route.fulfill({ status: 200, json: { machine: {} } });
  });
  const dialog = await openDialog(page);
  const approve = dialog.getByRole('button', { name: '批准', exact: true });
  const code = dialog.getByRole('textbox', { name: '批准码' });
  await code.fill('k7f3');
  await expect(approve).toBeDisabled();
  await code.fill('k7f3-q9xm');
  await approve.click();
  await expect.poll(() => confirmed).toEqual({ code: 'k7f3-q9xm' });
  await expect(code).toHaveValue('');
});

test('family law: X, Escape and backdrop dismiss; panel clicks do not', async ({ page }) => {
  let dialog = await openDialog(page);
  await dialog.getByRole('button', { name: '关闭' }).click();
  await expect(page.getByRole('dialog', { name: '添加执行机' })).toBeHidden();

  dialog = await openDialog(page);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: '添加执行机' })).toBeHidden();

  dialog = await openDialog(page);
  await dialog.getByTestId('dialog-head').click();
  await expect(page.getByRole('dialog', { name: '添加执行机' })).toBeVisible();
  await page.mouse.click(20, 20);
  await expect(page.getByRole('dialog', { name: '添加执行机' })).toBeHidden();
});

test('API key disclosure expands the key command and the api-keys link', async ({ page }) => {
  const dialog = await openDialog(page);
  const toggle = dialog.getByRole('button', { name: '在云服务器上运行？改用 API key 注册' });
  await toggle.click();

  await expect(dialog.locator('code').filter({ hasText: '--api-key' })).toHaveText(
    `cairn start --server ${TAILSCALE_URL} --api-key <key> --team <teamId>`,
  );
  const link = dialog.getByRole('link', { name: '获取 API key →' });
  await expect(link).toHaveText('获取 API key →');
  await expect(link).toHaveAttribute('href', '/app/api-keys?scenario=06');

  const browserLink = dialog.getByRole('link', { name: '浏览器授权注册 →' });
  await expect(browserLink).toHaveText('浏览器授权注册 →');
  await expect(browserLink).toHaveAttribute('href', '/app/machines/authorize?scenario=06');
  // toggle collapses again
  await toggle.click();
  await expect(dialog.getByRole('link', { name: '获取 API key →' })).toHaveCount(0);
});

test('copy buttons write their command to the clipboard', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const dialog = await openDialog(page);
  const copy = dialog.getByRole('button', { name: '复制' });
  await copy.first().click();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe('npm install -g @xiechimon/cairn-cli@latest');
  await copy.nth(1).click();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe(`cairn start --server ${TAILSCALE_URL}`);
});

test('until Tailscale reaches this computer no command is shown, only the next step', async ({
  page,
}) => {
  const missing = await openDialog(page, `${MACHINES}&tailscale=not-installed`);
  await expect(missing.getByText('这台电脑还没装 Tailscale。', { exact: false })).toBeVisible();
  await expect(missing.getByRole('link', { name: '下载 Tailscale →' })).toHaveAttribute(
    'href',
    'https://tailscale.com/download',
  );
  await expect(missing.locator('code')).toHaveCount(0);
  await expect(missing.getByRole('button', { name: '重新检查' })).toBeVisible();

  const off = await openDialog(page, `${MACHINES}&tailscale=off`);
  await expect(off.getByText('点「开启」后', { exact: false })).toBeVisible();
  await expect(off.locator('code')).toHaveCount(0);
  await expect(off.getByRole('button', { name: '开启' })).toBeVisible();
  await expect(off.getByRole('button', { name: '完成' })).toHaveCount(0);

  const operator = await openDialog(page, `${MACHINES}&tailscale=needs-operator`);
  await expect(operator.locator('code')).toHaveText(['sudo tailscale set --operator=$USER']);
  await expect(operator.getByRole('button', { name: '重试' })).toBeVisible();
});
