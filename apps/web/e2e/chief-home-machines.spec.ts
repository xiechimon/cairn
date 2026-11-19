import { expect, type Page, test } from '@playwright/test';
import { mockLive, THREAD } from './chief-home-mock.js';

const HOME = '/app?scenario=home-c';
const MIDDAY_IN_BEIJING = Date.UTC(2026, 10, 12, 4);

const chip = (page: Page) => page.getByTestId('machines-button');
const panel = (page: Page) => page.getByRole('complementary', { name: '电脑' });

test('the computer chip names the Coordinator machine, its state and any offline machine', async ({
  page,
}) => {
  await page.goto(HOME);
  await expect(chip(page)).toHaveAccessibleName(/xmonsMac/);
  await expect(chip(page)).not.toHaveAccessibleName(/在线/);
  await expect(chip(page)).not.toHaveAccessibleName(/在跑/);
  await expect(chip(page)).not.toHaveAccessibleName(/\+1/);
  await expect(chip(page)).toHaveText('');
  await expect(chip(page).locator('span:not([data-slot="fleet-badge"])')).toHaveCount(0);
  await expect(chip(page).locator('[data-slot="fleet-badge"]')).toHaveAttribute('data-fleet', 'offline');
  await expect(chip(page)).toHaveAttribute('aria-pressed', 'false');
});

test('the chip opens a list with one row per computer, the Coordinator machine first, and no new-session button', async ({
  page,
}) => {
  await page.goto(HOME);
  await chip(page).click();
  await expect(panel(page)).toBeVisible();
  await expect(page).toHaveURL(/[?&]pane=machines/);
  await expect(chip(page)).toHaveAttribute('aria-pressed', 'true');

  await expect(panel(page).getByRole('heading', { name: '你的电脑' })).toHaveCount(0);
  const rows = panel(page).getByTestId('machine-list-row');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText('xmonsMac');
  await expect(rows.nth(0)).toHaveText('xmonsMac');
  await expect(rows.nth(0)).not.toContainText('Coordinator');
  await expect(rows.nth(1)).toContainText('omarchy');
  await expect(rows.nth(1)).toContainText('离线');
  await expect(panel(page).getByRole('switch')).toHaveCount(0);
  await expect(panel(page).getByRole('button', { name: /新会话|新任务|新建/ })).toHaveCount(0);
  await expect(panel(page)).not.toContainText('检查过');
  await expect(panel(page).getByRole('button', { name: '再检查一次' })).toHaveCount(0);

  await panel(page).getByRole('link', { name: '添加电脑' }).click();
  await expect(page).toHaveURL(/\/app\/settings\/machines/);
});

test('each computer is one card in the list with no detail page, tabs or back control', async ({
  page,
}) => {
  await page.goto(`${HOME}&pane=machines`);
  await expect(panel(page).getByTestId('machine-card')).toHaveCount(2);
  await expect(panel(page).getByRole('tab')).toHaveCount(0);
  await expect(panel(page).getByRole('button', { name: /^(xmonsMac|omarchy)$/ })).toHaveCount(0);
  await expect(panel(page).getByRole('button', { name: '所有电脑' })).toHaveCount(0);
  await expect(panel(page).getByText('Agent 的权限')).toHaveCount(0);
  await expect(panel(page).getByRole('switch')).toHaveCount(0);
  const offline = panel(page).getByTestId('machine-card').filter({ hasText: 'omarchy' });
  await expect(offline).toContainText('离线');
  await expect(offline.getByTestId('machine-screen')).toHaveCount(0);
  await expect(offline.getByTestId('machine-screen-hint')).toHaveCount(0);
});

test('the chip badge is green when every computer is online and the sidebar has no computers link', async ({
  page,
}) => {
  await page.goto('/app?scenario=10');
  const badge = chip(page).locator('[data-slot="fleet-badge"]');
  await expect(badge).toHaveAttribute('data-fleet', 'online');
  const [r, g, b] = (await badge.evaluate((el) => getComputedStyle(el).backgroundColor))
    .match(/\d+/g)
    ?.map(Number) ?? [0, 0, 0];
  expect(g).toBeGreaterThan(r ?? 0);
  expect(g).toBeGreaterThan(b ?? 0);
  await expect(chip(page)).not.toHaveAccessibleName(/离线/);
  await expect(page.getByTestId('sidebar-footer').getByRole('link', { name: /在线/ })).toHaveCount(0);
});

test('the chip name carries the Coordinator machine and its state', async ({ page }) => {
  await page.goto(HOME);
  await expect(chip(page)).toHaveAccessibleName('电脑 · xmonsMac · 1 台离线（omarchy）');
});

test('at phone width the chip stays an icon and the title stays for screen readers', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(HOME);
  const box = await chip(page).boundingBox();
  expect(box?.width ?? 0).toBeLessThanOrEqual(60);
  const title = page.getByTestId('home-c').getByRole('heading', { level: 1 });
  await expect(title).toHaveText('Coordinator');
  await expect(title).toHaveClass(/sr-only/);
});

test('the icon-only header buttons show a tooltip with their name on hover', async ({
  page,
}) => {
  await page.goto(HOME);
  for (const [name, tip] of [
    ['任务', '任务，3 件等你'],
    ['成果', '成果'],
    ['电脑', '电脑 · xmonsMac · 1 台离线（omarchy）'],
  ] as const) {
    const button = page.getByTestId('home-c-pane-buttons').getByRole('button', { name });
    await button.hover();
    await expect(page.locator('[data-slot="tooltip-content"]')).toHaveText(tip);
    await page.mouse.move(0, 0);
    await expect(page.locator('[data-slot="tooltip-content"]')).toHaveCount(0);
  }
});

test('each computer is its own outlined card with its status dot, and the add row is outlined', async ({
  page,
}) => {
  await page.clock.setFixedTime(MIDDAY_IN_BEIJING);
  await page.goto('/app?scenario=home-c-machines&pane=machines');
  const cards = panel(page).getByTestId('machine-card');
  await expect(cards).toHaveCount(4);
  const rows = panel(page).getByTestId('machine-list-row');
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(0)).toContainText('xmonsMac');
  const dots = panel(page).getByTestId('machine-status-dot');
  await expect(dots).toHaveCount(4);
  await expect(dots.nth(0)).toHaveAttribute('data-online', 'true');
  await expect(dots.nth(1)).toHaveAttribute('data-online', 'false');
  await expect(dots.nth(2)).toHaveAttribute('data-online', 'true');
  await expect(dots.nth(3)).toHaveAttribute('data-online', 'false');
  await expect(rows.nth(3)).toHaveText('Office Mac mini离线 · 2 小时前');
  for (let i = 0; i < 4; i++) {
    await expect(cards.nth(i).locator('xpath=ancestor::*[@data-slot="list-card"]')).toHaveAttribute(
      'data-outlined',
      'true',
    );
  }
  await expect(panel(page).getByTestId('machines-add').locator('[data-slot="list-card"]')).toHaveAttribute(
    'data-outlined',
    'true',
  );
});

test('Computer settings in a card menu opens that computer in settings', async ({ page }) => {
  await page.goto('/app?scenario=home-c-machines&pane=machines');
  const card = panel(page).getByTestId('machine-card').filter({ hasText: 'Office Mac mini' });
  await card.getByTestId('machine-menu').click();
  await page.getByTestId('machine-settings').click();
  await expect(page).toHaveURL(/\/app\/settings\/machines\?machine=home-c-office/);
});

const REF = '/app?scenario=sessions-ref&pane=machines';

test('the reference list says what runs on an online computer and how long an offline one has been away', async ({
  page,
}) => {
  await page.clock.setFixedTime(MIDDAY_IN_BEIJING);
  await page.goto(REF);
  const rows = panel(page).getByTestId('machine-list-row');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toHaveText('工作室的 MacBook Air');
  await expect(rows.nth(1)).toHaveText(/^办公室 Mac mini离线 · \d+ (分钟|小时)前$/);
  await expect(panel(page).getByRole('button', { name: /云|cloud/i })).toHaveCount(0);
});

test('a computer coming online lights its dot up instead of switching it', async ({ page }) => {
  const state = { threads: [THREAD], messages: [], machines: [{ id: 'm-1', name: 'omarchy', online: false }] };
  await mockLive(page, state);
  await page.goto('/app?pane=machines');
  const dot = panel(page).getByTestId('machine-status-dot');
  await expect(dot).toHaveAttribute('data-online', 'false');
  await page.waitForFunction(() => window.__es.some((es) => es.url.includes('/api/teams/t1/stream')));
  state.machines = [{ id: 'm-1', name: 'omarchy', online: true }];
  await page.evaluate(() =>
    (
      window.__es.find((es) => es.url.includes('/api/teams/t1/stream')) as unknown as {
        onerror: () => void;
      }
    ).onerror(),
  );
  await expect(dot).toHaveAttribute('data-online', 'true');
  const colors = await dot.evaluate(
    (el) =>
      new Promise<string[]>((resolve) => {
        const seen: string[] = [];
        const read = () => {
          seen.push(getComputedStyle(el).backgroundColor);
          if (seen.length < 50) requestAnimationFrame(read);
          else resolve(seen);
        };
        read();
      }),
  );
  expect(new Set(colors).size).toBeGreaterThan(2);
});
