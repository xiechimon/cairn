import { expect, type Page, test } from '@playwright/test';

const FLEET = 'scenario=providers-fleet';

const settings = (page: Page) => page.getByRole('dialog', { name: '设置' });

test('settings open over the page they were opened from, which stays mounted', async ({ page }) => {
  await page.goto(`/app/schedules?${FLEET}`);
  const rowsBefore = await page.locator('[data-route="/app/schedules"]').count();
  await page.getByTestId('sidebar-settings').click();
  await expect(settings(page)).toBeVisible();
  await expect(page.locator('[data-route="/app/schedules"]')).toHaveCount(rowsBefore);
  await expect(page.locator('[inert] [data-route="/app/schedules"]')).toHaveCount(rowsBefore);
  const box = await settings(page).boundingBox();
  const view = page.viewportSize();
  expect(box && view && box.width < view.width - 40 && box.height < view.height - 20).toBe(true);
});

test('direct settings URLs open the modal on top of the home', async ({ page }) => {
  await page.goto(`/app/settings/providers?${FLEET}`);
  await expect(settings(page)).toBeVisible();
  await expect(page.locator('[inert] [data-testid="chief-composer-input"]')).toHaveCount(1);
  await settings(page).getByRole('button', { name: '关闭设置' }).click();
  await expect(page).toHaveURL(new RegExp(`/app\\?${FLEET}$`));
  await expect(settings(page)).toHaveCount(0);
});

test('a legacy settings URL opens the modal over the home and closes to it', async ({ page }) => {
  for (const legacy of ['/app/resources/machines', '/app/account', '/app/api-keys']) {
    await page.goto(`${legacy}?${FLEET}`);
    await expect(settings(page)).toBeVisible();
    await expect(page.locator('[inert] [data-testid="chief-composer-input"]')).toHaveCount(1);
    await settings(page).getByRole('button', { name: '关闭设置' }).click();
    await expect(page).toHaveURL(new RegExp(`/app\\?${FLEET}$`));
    await expect(settings(page)).toHaveCount(0);
    await expect(page.getByTestId('chief-composer-input')).toBeVisible();
  }
});

test('browser back closes the modal even after switching sections', async ({ page }) => {
  await page.goto(`/app/schedules?${FLEET}`);
  await page.getByTestId('sidebar-settings').click();
  await settings(page).locator('[data-settings-section="providers"]').click();
  await settings(page).locator('[data-settings-section="machines"]').click();
  await page.goBack();
  await expect(settings(page)).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`/app/schedules\\?${FLEET}$`));
});

test('the backdrop closes the modal and focus returns to the gear', async ({ page }) => {
  await page.goto(`/app?${FLEET}`);
  await page.getByTestId('sidebar-settings').focus();
  await page.keyboard.press('Enter');
  await expect(settings(page)).toBeVisible();
  await page.mouse.click(8, 8);
  await expect(settings(page)).toHaveCount(0);
  await expect(page.getByTestId('sidebar-settings')).toBeFocused();
});

test('Escape returns focus to the opener', async ({ page }) => {
  await page.goto(`/app?${FLEET}`);
  await page.getByTestId('sidebar-settings').focus();
  await page.keyboard.press('Enter');
  await expect(settings(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(settings(page)).toHaveCount(0);
  await expect(page.getByTestId('sidebar-settings')).toBeFocused();
});

test('Tab stays inside the modal in both directions', async ({ page }) => {
  await page.goto(`/app/settings/appearance?${FLEET}`);
  await expect(settings(page)).toBeVisible();
  const inside = () =>
    page.evaluate(() => document.activeElement?.closest('[role="dialog"]') !== null);
  for (let i = 0; i < 25; i++) {
    await page.keyboard.press('Tab');
    expect(await inside()).toBe(true);
  }
  for (let i = 0; i < 25; i++) {
    await page.keyboard.press('Shift+Tab');
    expect(await inside()).toBe(true);
  }
});

test('the dialog is labelled by its title', async ({ page }) => {
  await page.goto(`/app/settings/appearance?${FLEET}`);
  await expect(settings(page)).toHaveAttribute('aria-modal', 'true');
  await expect(settings(page)).toHaveAccessibleName('设置');
});

test('groups follow the design: models, execution, security', async ({ page }) => {
  await page.goto(`/app/settings/appearance?${FLEET}`);
  const nav = settings(page).getByRole('navigation', { name: '设置分区' });
  await expect(nav).toContainText('模型');
  await expect(nav).toContainText('执行环境');
  await expect(nav).toContainText('安全');
  await expect(nav.locator('hr')).toHaveCount(3);
  const order = await nav.locator('[data-settings-section]').evaluateAll((els) =>
    els.map((el) => el.getAttribute('data-settings-section')),
  );
  expect(order.indexOf('secrets')).toBeGreaterThan(order.indexOf('mcp'));
  expect(order).toContain('remote');
  expect(order).toContain('work-routing');
});

test('phone: full screen with the title row and a section tab strip', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/app/settings?${FLEET}`);
  const box = await settings(page).boundingBox();
  expect(box).toMatchObject({ x: 0, y: 0, width: 390, height: 844 });
  await expect(page.getByTestId('settings-tabs')).toBeVisible();
  await expect(settings(page).getByTestId('settings-head')).toHaveText('账号');
});

test('the machines nav row carries the online count as its description, not as a visible badge', async ({
  page,
}) => {
  await page.goto('/app/settings/appearance?scenario=home-c');
  const row = settings(page).locator('nav [data-settings-section="machines"]');
  await expect(row).toHaveText('Runner');
  await expect(row).toHaveAttribute('aria-description', '1/2 台电脑在线');
});
