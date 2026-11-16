import { expect, type Page, test } from '@playwright/test';
import { mockLive } from './chief-home-mock';

const DUPLICATES = '/app/settings/machines?scenario=machines-duplicate-names';

const settings = (page: Page) => page.getByRole('dialog', { name: '设置' });
const scope = (page: Page) => settings(page).getByRole('combobox', { name: '设置作用于' });

test('model services open with a scope sentence and keep the scope in the URL', async ({ page }) => {
  await page.goto('/app/settings/providers?scenario=providers-fleet');
  await expect(settings(page).getByTestId('settings-scope')).toContainText('设置作用于');
  await expect(scope(page)).toContainText('所有执行机');
  await scope(page).click();
  await page.getByRole('option', { name: /build-box/ }).first().click();
  await expect(page).toHaveURL(/scope=/);
  await expect(scope(page)).toContainText('build-box');
  await expect(scope(page).locator('[data-slot="machine-os-icon"][title="Linux"]')).toBeVisible();
  await expect(settings(page).getByTestId('settings-checked')).toContainText('已检查');
  await scope(page).click();
  await page.getByRole('option', { name: '所有执行机', exact: true }).click();
  expect(new URL(page.url()).searchParams.has('scope')).toBe(false);
  await expect(scope(page).locator('svg.lucide-server')).toBeVisible();
});

test('English scope copy names all machines and keeps the model selector in the nav', async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem('cairn.locale', 'en'));
  await page.goto('/app/settings/providers?scenario=providers-fleet');
  const selector = page.getByRole('combobox', { name: 'Settings apply to' });
  await expect(selector).toContainText('All Runners');
  await selector.click();
  await expect(page.getByRole('option', { name: 'All Runners', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('link', { name: 'Model selector', exact: true })).toBeVisible();
});

test('gallery scope preserves duplicate suffixes and offline markers with icons', async ({ page }) => {
  await page.goto('/design.html?only=settings-scope&theme=light&w=390');
  const selector = page.getByRole('combobox', { name: 'Settings apply to' });
  await expect(selector).toContainText('All Runners');
  await selector.click();
  const twins = page.getByRole('option').filter({ hasText: 'build-box' });
  await expect(twins).toHaveCount(2);
  await expect(twins.getByTestId('machine-secondary')).toHaveText(['#c3d4', '#e5f6']);
  await expect(twins.last()).toContainText('Offline');
  await expect(twins.last().locator('svg.lucide-monitor')).toBeVisible();
  await twins.last().click();
  await expect(selector).toContainText('build-box · #e5f6');
  await expect(selector.locator('svg.lucide-monitor')).toBeVisible();
});

test('device and personal pages show no scope sentence', async ({ page }) => {
  for (const section of ['appearance', 'account']) {
    await page.goto(`/app/settings/${section}`);
    await expect(settings(page)).toBeVisible();
    await expect(settings(page).getByTestId('settings-scope')).toHaveCount(0);
  }
});

test('machines with the same name get an id suffix in the rows, the scope menu and the migrate picker', async ({
  page,
}) => {
  await page.goto(DUPLICATES);
  const rows = settings(page).getByTestId('machine-item');
  await expect(rows).toHaveCount(4);
  const twins = rows.filter({ hasText: 'build-box' });
  await expect(twins).toHaveCount(2);
  await expect(twins.getByTestId('machine-secondary')).toHaveText(['#dbox', '#b7q2']);
  await expect(rows.filter({ hasText: 'omarchy' }).getByTestId('machine-secondary')).toHaveCount(0);

  await twins.first().getByTestId('machine-menu').click();
  await page.getByTestId('machine-menu-evacuate').click();
  await page.locator('.machine-evacuate-select').click();
  await expect(page.locator('.machine-evacuate-row', { hasText: 'build-box' })).toContainText(
    '#b7q2',
  );
});

test('an offline machine keeps only its current status in the compact row', async ({ page }) => {
  await page.goto(DUPLICATES);
  const row = settings(page).getByTestId('machine-item').filter({ hasText: 'old-laptop' });
  await expect(row.getByTestId('machine-item-status')).toHaveText('离线');
  await expect(row.getByTestId('machine-last-seen')).toHaveCount(0);
});

test('scope menu wraps long machine names without clipping or overlapping adjacent options inside a phone viewport', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const machineName = 'm'.repeat(60);
  await mockLive(
    page,
    {
      threads: [],
      messages: [],
      machines: [
        { id: 'm-long', name: machineName, online: false },
        { id: 'm-next', name: 'next-machine', online: true },
      ],
    },
    (path, _route, json) => {
      if (path === '/api/teams/t1/providers') return json({ presets: [], providers: [] });
      if (path === '/api/teams/t1/model-sources') return json({ sources: [] });
      return undefined;
    },
  );
  await page.goto('/app/settings/providers');
  await scope(page).click();
  const menu = page.locator('[data-slot=select-content]');
  await expect(menu).toBeVisible();
  await expect
    .poll(() => menu.evaluate((element) => element.getBoundingClientRect().right))
    .toBeLessThanOrEqual(390);
  await page.getByRole('option', { name: new RegExp(machineName) }).click();
  await scope(page).click();
  const selected = page.getByRole('option', { name: new RegExp(machineName), selected: true });
  const itemBox = await selected.boundingBox();
  const textBox = await selected.locator('> :first-child').boundingBox();
  const previousBox = await page.getByRole('option', { name: '所有执行机', exact: true }).boundingBox();
  const nextBox = await page.getByRole('option', { name: 'next-machine', exact: true }).boundingBox();
  expect(itemBox).not.toBeNull();
  expect(textBox).not.toBeNull();
  expect(previousBox).not.toBeNull();
  expect(nextBox).not.toBeNull();
  expect(previousBox!.y + previousBox!.height).toBeLessThanOrEqual(itemBox!.y);
  expect(itemBox!.y + itemBox!.height).toBeLessThanOrEqual(nextBox!.y);
  expect(textBox!.x).toBeGreaterThanOrEqual(itemBox!.x);
  expect(textBox!.x + textBox!.width).toBeLessThanOrEqual(itemBox!.x + itemBox!.width);
  expect(textBox!.y).toBeGreaterThanOrEqual(itemBox!.y);
  expect(textBox!.y + textBox!.height).toBeLessThanOrEqual(itemBox!.y + itemBox!.height);
  const dimensions = await selected.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      height: style.height,
      minHeight: style.minHeight,
      paddingTop: style.paddingTop,
      paddingBottom: style.paddingBottom,
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight,
    };
  });
  await testInfo.attach('machine-option-computed-style', {
    body: JSON.stringify({ dimensions, itemBox, textBox, previousBox, nextBox }, null, 2),
    contentType: 'application/json',
  });
  expect(dimensions.scrollHeight).toBeLessThanOrEqual(dimensions.clientHeight);
  expect(dimensions.minHeight).toBe('32px');
  expect(Number.parseFloat(dimensions.height)).toBeGreaterThan(32);
  expect(Number.parseFloat(dimensions.paddingTop)).toBeGreaterThan(0);
  expect(Number.parseFloat(dimensions.paddingBottom)).toBeGreaterThan(0);
  const indicator = selected.locator('svg.lucide-check');
  await expect(indicator).toBeVisible();
  await expect(indicator).toBeInViewport({ ratio: 1 });
  await expect
    .poll(() => menu.evaluate((element) => element.getBoundingClientRect().right))
    .toBeLessThanOrEqual(390);
  await testInfo.attach('wrapped-machine-option', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
});
