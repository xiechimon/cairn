import { expect, type Page, test } from '@playwright/test';
import { mockLive } from './chief-home-mock';

const DUPLICATES = '/app/settings/machines?scenario=machines-duplicate-names';

const settings = (page: Page) => page.getByRole('dialog', { name: '设置' });
const scope = (page: Page) => settings(page).getByRole('combobox', { name: '设置作用于' });

test('model services open with a scope sentence and keep the scope in the URL', async ({ page }) => {
  await page.goto('/app/settings/providers?scenario=providers-fleet');
  await expect(settings(page).getByTestId('settings-scope')).toContainText('设置作用于');
  await expect(scope(page)).toContainText('所有机器');
  await scope(page).click();
  await page.getByRole('option', { name: /build-box/ }).first().click();
  await expect(page).toHaveURL(/scope=/);
  await expect(scope(page)).toContainText('build-box');
  await expect(scope(page).locator('svg.lucide-monitor')).toBeVisible();
  await expect(settings(page).getByTestId('settings-checked')).toContainText('已检查');
  await scope(page).click();
  await page.getByRole('option', { name: '所有机器', exact: true }).click();
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
  await expect(settings(page).getByTestId('settings-scope-note')).toContainText('对所有机器生效');
});

test('English scope copy names all machines and preserves the team members page', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('cairn.locale', 'en'));
  await page.goto('/app/settings/providers?scenario=providers-fleet');
  const selector = page.getByRole('combobox', { name: 'Settings apply to' });
  await expect(selector).toContainText('All machines');
  await selector.click();
  await expect(page.getByRole('option', { name: 'All machines', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('link', { name: 'Team', exact: true })).toBeVisible();
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

test('the accept switch is derived: off clears runtimes, on only opens the runtime switches and saves nothing', async ({
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
    '选择这台机器接哪些运行时',
  );
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

test('scope menu keeps long machine names and the selection indicator inside a phone viewport', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const machineName = 'm'.repeat(60);
  await mockLive(
    page,
    {
      threads: [],
      messages: [],
      machines: [{ id: 'm-long', name: machineName, online: false }],
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
  const indicator = selected.locator('svg.lucide-check');
  await expect(indicator).toBeVisible();
  await expect(indicator).toBeInViewport({ ratio: 1 });
  await expect
    .poll(() => menu.evaluate((element) => element.getBoundingClientRect().right))
    .toBeLessThanOrEqual(390);
});
