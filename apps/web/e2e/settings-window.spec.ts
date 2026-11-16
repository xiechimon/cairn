import { expect, type Page, test } from '@playwright/test';

const FLEET = 'scenario=providers-fleet';

const settings = (page: Page) => page.getByRole('dialog', { name: '设置' });
const navItem = (page: Page, id: string) =>
  settings(page).locator(`[data-settings-section="${id}"]`);

test('sidebar footer: settings and usage icons, no user chip and no computers link; the header chip carries the offline machine', async ({
  page,
}) => {
  await page.goto(`/app?${FLEET}`);
  const footer = page.getByTestId('sidebar-footer');
  await expect(footer.getByTestId('sidebar-settings')).toBeVisible();
  await expect(footer.getByTestId('sidebar-usage')).toBeVisible();
  await expect(page.getByTestId('sidebar-user-menu')).toHaveCount(0);
  await expect(page.locator('[data-slot="sidebar-user"]')).toHaveCount(0);
  await expect(footer.getByTestId('sidebar-attention')).toHaveCount(0);
  await expect(page.getByTestId('machines-button')).toHaveAccessibleName(/4 台在线 · 1 台离线（old-laptop）/);
  await expect(page.getByTestId('machines-button').locator('[data-slot="fleet-badge"]')).toHaveAttribute('data-fleet', 'offline');
});

test('the settings icon opens the window on Account; Escape returns to the page it came from', async ({
  page,
}) => {
  await page.goto(`/app?${FLEET}&pane=tasks&tab=scheduled`);
  await page.getByTestId('sidebar-reopen').click();
  await page.mouse.move(700, 400);
  await page.getByTestId('sidebar-settings').click();
  await expect(page).toHaveURL(/\/app\/settings\?/);
  await expect(settings(page)).toBeVisible();
  await expect(navItem(page, 'account')).toHaveAttribute('aria-current', 'page');
  await page.keyboard.press('Escape');
  await expect(settings(page)).toHaveCount(0);
  await expect(page).toHaveURL(/\/app\?scenario=providers-fleet&pane=tasks&tab=scheduled$/);
});

test('archived projects live in the sidebar only: settings has no Projects section and its old link opens Account', async ({
  page,
}) => {
  await page.goto(`/app/settings/projects?${FLEET}`);
  await expect(settings(page)).toBeVisible();
  await expect(navItem(page, 'projects')).toHaveCount(0);
  await expect(navItem(page, 'account')).toHaveAttribute('aria-current', 'page');
});

test('Escape inside a text field is the field\'s; the window stays open', async ({ page }) => {
  await page.goto(`/app/settings/routing?${FLEET}`);
  const name = settings(page).getByLabel('名称');
  await name.fill('draft');
  await name.press('Escape');
  await expect(settings(page)).toBeVisible();
  await settings(page).getByRole('heading', { name: 'Anthropic' }).click();
  await page.keyboard.press('Escape');
  await expect(settings(page)).toHaveCount(0);
});

test('section and scope changes keep the page settings will return to', async ({
  page,
}) => {
  await page.goto('/app?scenario=model-routing&pane=tasks&tab=scheduled');
  await page.getByTestId('sidebar-reopen').click();
  await page.mouse.move(700, 400);
  await page.getByTestId('sidebar-settings').click();
  await navItem(page, 'routing').click();
  await expect(page).toHaveURL(/\/app\/settings\/routing\?scenario=model-routing/);
  await settings(page).getByRole('button', { name: '关闭设置' }).click();
  await expect(page).toHaveURL(/\/app\?scenario=model-routing&pane=tasks&tab=scheduled$/);

  await page.goto(`/app?${FLEET}&pane=tasks&tab=scheduled`);
  await page.getByTestId('sidebar-reopen').click();
  await page.mouse.move(700, 400);
  await page.getByTestId('sidebar-settings').click();
  await navItem(page, 'routing').click();
  await settings(page).getByRole('combobox', { name: '设置作用于' }).click();
  await page.getByRole('option', { name: /build-box-orb/ }).click();
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(/\/app\?scenario=providers-fleet&pane=tasks&tab=scheduled$/);
});

test('sections switch in place, keep their own params, and close goes back to where it started', async ({
  page,
}) => {
  await page.goto(`/app?${FLEET}`);
  await page.getByTestId('sidebar-settings').click();
  await navItem(page, 'routing').click();
  await expect(page).toHaveURL(/\/app\/settings\/routing\?scenario=providers-fleet/);
  await expect(settings(page).getByTestId('provider-instance')).toHaveCount(3);
  await navItem(page, 'machines').click();
  await expect(navItem(page, 'machines')).toHaveAttribute('aria-current', 'page');
  await expect(navItem(page, 'machines')).toHaveAttribute('aria-description', '4/5 台电脑在线');
  await settings(page).getByRole('button', { name: '关闭设置' }).click();
  await expect(page).toHaveURL(/\/app\?scenario=providers-fleet$/);
});

test('old resource URLs land on their settings section with the query intact', async ({ page }) => {
  const cases = [
    ['/app/resources/providers', 'routing'],
    ['/app/settings/providers', 'routing'],
    ['/app/resources/routing-settings', 'work-routing'],
    ['/app/resources/machines', 'machines'],
    ['/app/resources/skills', 'skills'],
    ['/app/resources/mcp-servers', 'mcp'],
    ['/app/resources/secrets', 'secrets'],
    ['/app/account', 'account'],
    ['/app/api-keys', 'api-keys'],
    ['/app/team', 'work-routing'],
    ['/app/settings/team', 'work-routing'],
  ] as const;
  for (const [from, section] of cases) {
    await page.goto(`${from}?scenario=10&scope=x`);
    await expect(page).toHaveURL(new RegExp(`/app/settings/${section}\\?scenario=10&scope=x$`));
    await expect(navItem(page, section)).toHaveAttribute('aria-current', 'page');
  }
});

test('search lists matching sections and rows, jumps to the pick and highlights the row', async ({
  page,
}) => {
  await page.goto(`/app/settings/account?${FLEET}`);
  const search = settings(page).getByLabel('搜索设置');
  await search.fill('机');
  await expect(settings(page).getByTestId('settings-search-results')).toBeVisible();
  await expect(settings(page).locator('[data-settings-result="machines"]')).toBeVisible();
  await search.fill('color');
  const option = settings(page).getByRole('option');
  await expect(option).toHaveCount(1);
  await expect(option).toContainText('外观');
  await expect(option).toContainText('颜色主题');
  await search.press('Enter');
  await expect(page).toHaveURL(/\/app\/settings\/appearance\?/);
  await expect(search).toHaveValue('');
  const row = settings(page).locator('[data-settings-label="颜色主题"]');
  await expect(row).toHaveAttribute('data-match', '');
  await settings(page).getByTestId('settings-body').click({ position: { x: 5, y: 300 } });
  await expect(row).not.toHaveAttribute('data-match', '');
  await search.fill('zzz');
  await expect(settings(page).getByText('没有匹配的设置')).toBeVisible();
});

test('typing opens the search, Escape clears it first and a second Escape closes settings', async ({
  page,
}) => {
  await page.goto(`/app/settings/account?${FLEET}`);
  await page.keyboard.type('key');
  const search = settings(page).getByLabel('搜索设置');
  await expect(search).toBeFocused();
  await expect(search).toHaveValue('key');
  await search.press('Escape');
  await expect(search).toHaveValue('');
  await expect(settings(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(settings(page)).toHaveCount(0);
});

test('appearance section switches the theme between system, light and dark', async ({ page }) => {
  await page.goto(`/app/settings/appearance?${FLEET}`);
  await expect(settings(page).getByRole('radio', { name: '跟随系统' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await settings(page).getByRole('radio', { name: '深色' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await settings(page).getByRole('radio', { name: '浅色' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('phone: a scrollable tab strip switches sections inside a full-screen modal', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/app/settings?${FLEET}`);
  await expect(navItem(page, 'account')).toHaveAttribute('aria-current', 'page');
  await expect(page.getByTestId('settings-content')).toBeVisible();
  await navItem(page, 'routing').click();
  await expect(navItem(page, 'routing')).toHaveAttribute('aria-current', 'page');
  await expect(settings(page).getByTestId('provider-instance').first()).toBeVisible();
  const strip = page.getByTestId('settings-tabs');
  const scrolls = await strip.evaluate((el) => el.scrollWidth > el.clientWidth);
  expect(scrolls).toBe(true);
  await settings(page).getByRole('button', { name: '关闭设置' }).click();
  await expect(settings(page)).toHaveCount(0);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
