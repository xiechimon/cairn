import { expect, type Page, test } from '@playwright/test';
import { openChiefWindow } from './helpers.js';

const FLEET = 'scenario=providers-fleet';

const settings = (page: Page) => page.getByRole('dialog', { name: '设置' });
const navItem = (page: Page, id: string) =>
  settings(page).locator(`[data-settings-section="${id}"]`);

test('sidebar footer: settings and activity icons, no user chip, quiet machine line, red dot only when a machine is offline', async ({
  page,
}) => {
  await page.goto(`/app?${FLEET}`);
  const footer = page.getByTestId('sidebar-footer');
  await expect(footer.getByTestId('sidebar-settings')).toBeVisible();
  await expect(footer.getByTestId('sidebar-activity')).toBeVisible();
  await expect(page.getByTestId('sidebar-user-menu')).toHaveCount(0);
  await expect(page.locator('[data-slot="sidebar-user"]')).toHaveCount(0);
  await expect(footer.getByTestId('sidebar-attention').getByText('4 在线 · 1 离线')).toBeVisible();
  await expect(footer.getByTestId('sidebar-attention')).toHaveAttribute('title', '4 台在线 · 1 台离线（old-laptop）');
  await expect(footer.getByTestId('sidebar-attention')).toHaveAttribute('data-fleet', 'offline');

  await page.goto('/app?scenario=10');
  await expect(
    page.getByTestId('sidebar-footer').locator('[data-testid="sidebar-attention"][data-fleet="offline"]'),
  ).toHaveCount(0);
});

test('the settings icon opens the window on Account; Escape returns to the page it came from', async ({
  page,
}) => {
  await page.goto(`/app/schedules?${FLEET}`);
  await page.getByTestId('sidebar-settings').click();
  await expect(page).toHaveURL(/\/app\/settings\?/);
  await expect(settings(page)).toBeVisible();
  await expect(navItem(page, 'account')).toHaveAttribute('aria-current', 'page');
  await page.keyboard.press('Escape');
  await expect(settings(page)).toHaveCount(0);
  await expect(page).toHaveURL(/\/app\/schedules\?scenario=providers-fleet/);
});

test('Escape inside a text field is the field\'s; the window stays open', async ({ page }) => {
  await page.goto(`/app/settings/providers?${FLEET}`);
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
  await page.goto('/app/schedules?scenario=model-routing');
  await page.getByTestId('sidebar-settings').click();
  await navItem(page, 'routing').click();
  await expect(page).toHaveURL(/\/app\/settings\/routing\?scenario=model-routing/);
  await settings(page).getByRole('button', { name: '关闭设置' }).click();
  await expect(page).toHaveURL(/\/app\/schedules\?scenario=model-routing$/);

  await page.goto(`/app/schedules?${FLEET}`);
  await page.getByTestId('sidebar-settings').click();
  await navItem(page, 'providers').click();
  await settings(page).getByRole('combobox', { name: '设置作用于' }).click();
  await page.getByRole('option', { name: /build-box-orb/ }).click();
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(/\/app\/schedules\?scenario=providers-fleet$/);
});

test('sections switch in place, keep their own params, and close goes back to where it started', async ({
  page,
}) => {
  await page.goto(`/app?${FLEET}`);
  await page.getByTestId('sidebar-settings').click();
  await navItem(page, 'providers').click();
  await expect(page).toHaveURL(/\/app\/settings\/providers\?scenario=providers-fleet/);
  await expect(settings(page).getByTestId('provider-instance')).toHaveCount(3);
  await navItem(page, 'machines').click();
  await expect(navItem(page, 'machines')).toHaveAttribute('aria-current', 'page');
  await expect(navItem(page, 'machines')).toContainText('4/5');
  await settings(page).getByRole('button', { name: '关闭设置' }).click();
  await expect(page).toHaveURL(/\/app\?scenario=providers-fleet$/);
});

test('old resource URLs land on their settings section with the query intact', async ({ page }) => {
  const cases = [
    ['/app/resources/providers', 'providers'],
    ['/app/resources/model-routing', 'providers'],
    ['/app/resources/routing-settings', 'work-routing'],
    ['/app/resources/machines', 'machines'],
    ['/app/resources/skills', 'skills'],
    ['/app/resources/mcp-servers', 'mcp'],
    ['/app/resources/secrets', 'secrets'],
    ['/app/account', 'account'],
    ['/app/api-keys', 'api-keys'],
    ['/app/team', 'team'],
  ] as const;
  for (const [from, section] of cases) {
    await page.goto(`${from}?scenario=10&scope=x`);
    await expect(page).toHaveURL(new RegExp(`/app/settings/${section}\\?scenario=10&scope=x$`));
    await expect(navItem(page, section)).toHaveAttribute('aria-current', 'page');
  }
});

test('search narrows the section list and says when nothing matches', async ({ page }) => {
  await page.goto(`/app/settings/account?${FLEET}`);
  const search = settings(page).getByLabel('搜索设置');
  await search.fill('机');
  await expect(settings(page).locator('[data-settings-section]')).toHaveCount(1);
  await expect(navItem(page, 'machines')).toBeVisible();
  await search.fill('zzz');
  await expect(settings(page).getByText('没有匹配的设置')).toBeVisible();
});

test('appearance section switches the theme', async ({ page }) => {
  await page.goto(`/app/settings/appearance?${FLEET}`);
  await settings(page).getByRole('radio', { name: '深色' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await settings(page).getByRole('radio', { name: '浅色' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('phone: the list comes first, a section opens full screen with a way back', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/app/settings?${FLEET}`);
  await expect(navItem(page, 'providers')).toBeVisible();
  await expect(page.getByTestId('settings-content')).toBeHidden();
  await navItem(page, 'providers').click();
  await expect(navItem(page, 'providers')).toBeHidden();
  await expect(settings(page).getByTestId('provider-instance').first()).toBeVisible();
  await settings(page).getByRole('link', { name: '返回设置' }).click();
  await expect(navItem(page, 'providers')).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test('opening settings leaves the Coordinator window as it was', async ({ page }) => {
  await page.goto('/app/schedules?scenario=11');
  await openChiefWindow(page);
  await expect(page.locator('.chief-drawer')).toBeVisible();
  await page.getByTestId('sidebar-settings').click();
  await expect(settings(page)).toBeVisible();
  await settings(page).getByRole('button', { name: '关闭设置' }).click();
  await expect(page).toHaveURL(/\/app\/schedules\?scenario=11$/);
  await expect(page.locator('.chief-drawer')).toBeVisible();

  await page.getByTestId('sidebar-settings').click();
  await settings(page).getByRole('heading', { name: '账号' }).first().click();
  await page.keyboard.press('Escape');
  await expect(settings(page)).toHaveCount(0);
  await expect(page.locator('.chief-drawer')).toBeVisible();
});
