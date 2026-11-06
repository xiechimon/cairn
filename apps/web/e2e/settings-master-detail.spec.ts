import { expect, type Page, test } from '@playwright/test';

const MACHINES = '/app/settings/machines?scenario=machines-master-detail';

const settings = (page: Page) => page.getByRole('dialog', { name: '设置' });
const items = (page: Page) => settings(page).getByTestId('machine-item');
const detail = (page: Page) => settings(page).getByTestId('machine-detail');

test('the breadcrumb is the only page title: no second heading repeats it', async ({ page }) => {
  await page.goto(MACHINES);
  await expect(settings(page).getByRole('heading', { level: 1 })).toHaveText('机器');
  await expect(settings(page).getByRole('heading', { name: '机器', exact: true })).toHaveCount(1);
  await expect(settings(page).getByTestId('page-topbar')).toHaveCount(0);
  await expect(settings(page).getByTestId('settings-breadcrumb')).toContainText('设置');
});

test('other sections keep one heading for the page, the breadcrumb', async ({ page }) => {
  for (const [section, label] of [
    ['providers', '模型服务'],
    ['routing', '订阅与路由'],
    ['skills', '技能'],
  ] as const) {
    await page.goto(`/app/settings/${section}?scenario=providers-fleet`);
    await expect(settings(page).getByRole('heading', { level: 1 })).toHaveText(label);
    await expect(settings(page).getByRole('heading', { name: label, exact: true })).toHaveCount(1);
  }
});

test('search is quiet, shows a / hint and the / key focuses it', async ({ page }) => {
  await page.goto(MACHINES);
  const search = settings(page).getByLabel('搜索设置');
  await expect(settings(page).getByTestId('settings-search-hint')).toHaveText('/');
  const look = await search.evaluate((el) => {
    const css = getComputedStyle(el);
    return { border: css.borderTopWidth, bg: css.backgroundColor };
  });
  expect(look.border).toBe('0px');
  expect(look.bg).toBe('rgba(0, 0, 0, 0)');
  await expect(search).not.toBeFocused();
  await page.keyboard.press('/');
  await expect(search).toBeFocused();
  await expect(search).toHaveValue('');
});

test('typing a slash inside another field does not steal focus', async ({ page }) => {
  await page.goto('/app/settings/providers?scenario=providers-fleet');
  const name = settings(page).getByLabel('名称');
  await name.fill('');
  await page.keyboard.type('a/b');
  await expect(name).toHaveValue('a/b');
  await expect(name).toBeFocused();
});

test('machines is master-detail: list on the left, status dot and short status, selection drives the detail', async ({
  page,
}) => {
  await page.goto(MACHINES);
  await expect(items(page)).toHaveCount(3);
  await expect(items(page).first()).toHaveAttribute('aria-current', 'true');
  await expect(detail(page).getByTestId('machine-detail-name')).toHaveText('omarchy');

  const host = items(page).filter({ hasText: 'omarchy' });
  await expect(host.locator('[data-orchestration="host"]')).toHaveText('Coordinator 主机');
  await expect(host.getByTestId('machine-item-status')).toHaveText('在线');
  await expect(
    items(page).filter({ hasText: 'old-laptop' }).getByTestId('machine-item-status'),
  ).toHaveText('离线');
  await expect(
    items(page).filter({ hasText: 'build-box' }).getByTestId('machine-item-status'),
  ).toHaveText('登录已过期');
  await expect(settings(page).getByTestId('machine-list').locator('svg[fill^="#"]')).toHaveCount(0);

  await items(page).filter({ hasText: 'old-laptop' }).click();
  await expect(page).toHaveURL(/machine=md-old-laptop/);
  await expect(items(page).filter({ hasText: 'old-laptop' })).toHaveAttribute(
    'aria-current',
    'true',
  );
  await expect(items(page).first()).not.toHaveAttribute('aria-current', 'true');
  await expect(detail(page).getByTestId('machine-detail-name')).toHaveText('old-laptop');
});

test('detail sections: status, runtimes, capacity, each row a label and description with the control on the right', async ({
  page,
}) => {
  await page.goto(MACHINES);
  const pane = detail(page);
  for (const name of ['状态', '运行时', '容量']) {
    await expect(pane.getByRole('heading', { name, exact: true })).toBeVisible();
  }
  await expect(pane.getByTestId('machine-detail-online')).toContainText('在线');
  await expect(settings(page).getByTestId('machines-checked')).toContainText('已检查');

  const row = pane.locator('[data-testid="provider-row"][data-runtime="claude-code"]');
  await expect(row).toContainText('Claude Code');
  await expect(row).toContainText('2.1.316');
  await expect(row.locator('svg[fill^="#"]')).toHaveCount(0);

  const cap = pane.getByTestId('machine-concurrency');
  await expect(cap).toBeVisible();
  await expect(pane.getByTestId('machine-running')).toContainText('1/3');
  const label = await pane.getByTestId('machine-capacity-label').boundingBox();
  const control = await cap.boundingBox();
  expect(label).not.toBeNull();
  expect(control).not.toBeNull();
  expect((control?.x ?? 0) > (label?.x ?? 0) + (label?.width ?? 0)).toBe(true);
});

test('offline and expired-login machines explain how to bring them back, with the command as code', async ({
  page,
}) => {
  await page.goto(MACHINES);
  await items(page).filter({ hasText: 'old-laptop' }).click();
  const pane = detail(page);
  await expect(pane.getByTestId('machine-detail-online')).toContainText('离线');
  await expect(pane.getByTestId('machine-recover')).toContainText('在这台机器上运行');
  await expect(pane.getByTestId('machine-recover').locator('code')).toContainText('start');

  await items(page).filter({ hasText: 'build-box' }).click();
  const warning = pane.getByTestId('claude-login-warning');
  await expect(warning).toHaveAttribute('data-login', 'expired');
  await expect(warning.locator('code')).toHaveText('claude auth login');
});

test('at 375px the master-detail stacks and nothing scrolls sideways', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto(MACHINES);
  await expect(items(page)).toHaveCount(3);
  const list = await settings(page).getByTestId('machine-list').boundingBox();
  const pane = await detail(page).boundingBox();
  expect(list).not.toBeNull();
  expect(pane).not.toBeNull();
  expect((pane?.y ?? 0) >= (list?.y ?? 0) + (list?.height ?? 0) - 1).toBe(true);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  const inner = await settings(page)
    .getByTestId('machines-scroll')
    .evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(inner).toBeLessThanOrEqual(0);
});

test('the old machine detail URL lands on the machine inside settings', async ({ page }) => {
  await page.goto('/app/resources/machines/md-old-laptop?scenario=machines-master-detail');
  await expect(page).toHaveURL(
    /\/app\/settings\/machines\?scenario=machines-master-detail&machine=md-old-laptop$/,
  );
  await expect(detail(page).getByTestId('machine-detail-name')).toHaveText('old-laptop');
});
