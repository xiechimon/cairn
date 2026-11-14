import { expect, type Page, test } from '@playwright/test';
import { mockLive } from './chief-home-mock';

const DUPLICATES = '/app/settings/machines?scenario=machines-duplicate-names';

const settings = (page: Page) => page.getByRole('dialog', { name: '设置' });
const scope = (page: Page) => settings(page).getByRole('combobox', { name: '设置作用于' });

test('model services open with a scope sentence and keep the scope in the URL', async ({ page }) => {
  await page.goto('/app/settings/providers?scenario=providers-fleet');
  await expect(settings(page).getByTestId('settings-scope')).toContainText('设置作用于');
  await expect(scope(page)).toContainText('所有 Runner');
  await scope(page).click();
  await page.getByRole('option', { name: /build-box/ }).first().click();
  await expect(page).toHaveURL(/scope=/);
  await expect(scope(page)).toContainText('build-box');
  await expect(scope(page).locator('svg.lucide-monitor')).toBeVisible();
  await expect(settings(page).getByTestId('settings-checked')).toContainText('已检查');
  await scope(page).click();
  await page.getByRole('option', { name: '所有 Runner', exact: true }).click();
  expect(new URL(page.url()).searchParams.has('scope')).toBe(false);
  await expect(scope(page).locator('svg.lucide-server')).toBeVisible();
});

test('routing carries the same sentence and says routing applies to all machines', async ({
  page,
}) => {
  await page.goto('/app/settings/routing?scenario=providers-fleet');
  await expect(settings(page).getByTestId('settings-scope')).toContainText('设置作用于');
  await expect(settings(page).getByTestId('settings-scope-note')).toHaveCount(0);
  await scope(page).click();
  await page.getByRole('option', { name: /build-box/ }).first().click();
  await expect(page).toHaveURL(/scope=/);
  await expect(settings(page).getByTestId('settings-scope-note')).toContainText('对所有 Runner 生效');
});

test('English scope copy names all machines and keeps rules and policies in the nav', async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem('cairn.locale', 'en'));
  await page.goto('/app/settings/providers?scenario=providers-fleet');
  const selector = page.getByRole('combobox', { name: 'Settings apply to' });
  await expect(selector).toContainText('All machines');
  await selector.click();
  await expect(page.getByRole('option', { name: 'All machines', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('link', { name: 'Rules & policies', exact: true })).toBeVisible();
});

test('gallery scope preserves duplicate suffixes and offline markers with icons', async ({ page }) => {
  await page.goto('/design.html?only=settings-scope&theme=light&w=390');
  const selector = page.getByRole('combobox', { name: 'Settings apply to' });
  await expect(selector).toContainText('All machines');
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

test('an offline machine says when it was last online', async ({ page }) => {
  await page.goto(DUPLICATES);
  const row = settings(page).getByTestId('machine-item').filter({ hasText: 'old-laptop' });
  await expect(row.getByTestId('machine-last-seen')).toHaveText('最后在线 12 分钟前');
});

test('the accept switch is derived: off clears runtimes, on opens runtimes with a toast and saves nothing', async ({
  page,
}) => {
  const patches: unknown[] = [];
  let enabledRuntimes = ['pi'];
  await page.route('**/api/**', (route, request) => {
    if (request.method() !== 'GET') return route.fallback();
    return route.fulfill({ status: 500, json: { error: 'e2e stub: not the surface under test' } });
  });
  await page.route('**/api/teams', (route) =>
    route.fulfill({
      json: [{ id: 'team-1', name: 'Team', createdAt: 0, plan: 'free', avatarStyle: null }],
    }),
  );
  await page.route('**/api/user/me', (route) =>
    route.fulfill({ json: { id: 'user-1', displayName: '我', avatarUrl: null } }),
  );
  await page.route('**/api/teams/team-1/members', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/teams/team-1/machines', (route) =>
    route.fulfill({
      json: [
        {
          id: 'm-1',
          name: 'alpha',
          teamId: 'team-1',
          online: true,
          latestCliVersion: null,
          kind: 'remote',
          enabledRuntimes,
        },
      ],
    }),
  );
  await page.route('**/api/machines/m-1', (route, request) => {
    if (request.method() !== 'PATCH') return route.fallback();
    const body = request.postDataJSON() as { enabledRuntimes: string[] };
    patches.push(body);
    enabledRuntimes = body.enabledRuntimes;
    return route.fulfill({ json: {} });
  });
  await page.goto('/app/settings/machines');
  const toggle = settings(page).getByTestId('machine-accept-toggle');
  await expect(toggle).toBeChecked();
  await toggle.click();
  await expect.poll(() => patches.length).toBe(1);
  expect(patches[0]).toEqual({ enabledRuntimes: [] });
  await expect(toggle).not.toBeChecked();

  await toggle.click();
  await expect(settings(page).getByTestId('machine-pick-runtimes')).toHaveText(
    '选择这台 Runner 接哪些运行时',
  );
  await expect(page.locator('[data-sonner-toast]')).toContainText('选择这台 Runner 接哪些运行时');
  await expect(settings(page).getByTestId('machine-item')).toHaveAttribute(
    'data-expanded',
    'true',
  );
  await expect(settings(page).getByTestId('provider-toggle').first()).toBeFocused();
  expect(patches).toHaveLength(1);
  await expect(toggle).not.toBeChecked();

  await settings(page).getByTestId('provider-toggle').first().click();
  await expect.poll(() => patches.length).toBe(2);
  expect(patches[1]).toEqual({ enabledRuntimes: ['pi'] });
});

test('an offline accept switch stays disabled and explains why on click', async ({ page }) => {
  await page.route('**/api/**', (route, request) => {
    if (request.method() !== 'GET') return route.fallback();
    return route.fulfill({ status: 500, json: { error: 'e2e stub: not the surface under test' } });
  });
  await page.route('**/api/teams', (route) =>
    route.fulfill({
      json: [{ id: 'team-1', name: 'Team', createdAt: 0, plan: 'free', avatarStyle: null }],
    }),
  );
  await page.route('**/api/user/me', (route) =>
    route.fulfill({ json: { id: 'user-1', displayName: '我', avatarUrl: null } }),
  );
  await page.route('**/api/teams/team-1/members', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/teams/team-1/machines', (route) =>
    route.fulfill({
      json: [
        {
          id: 'm-offline',
          name: 'omarchy',
          teamId: 'team-1',
          online: false,
          latestCliVersion: null,
          kind: 'remote',
          enabledRuntimes: [],
        },
      ],
    }),
  );
  await page.goto('/app/settings/machines');
  const toggle = settings(page).getByTestId('machine-accept-toggle');
  await expect(toggle).toBeDisabled();
  const reason = '重新连接 omarchy 后才能修改它的设置。';
  const explain = settings(page).getByRole('button', { name: reason });
  const box = await explain.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeGreaterThanOrEqual(36);
  expect(box!.height).toBeGreaterThanOrEqual(24);
  const toggleBox = await toggle.boundingBox();
  expect(toggleBox).not.toBeNull();
  await page.mouse.click(toggleBox!.x + 2, toggleBox!.y + toggleBox!.height / 2);
  await expect(page.locator('[data-sonner-toast]', { hasText: reason })).toBeVisible();
  await explain.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-sonner-toast]', { hasText: reason }).first()).toBeVisible();
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
  const previousBox = await page.getByRole('option', { name: '所有 Runner', exact: true }).boundingBox();
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
