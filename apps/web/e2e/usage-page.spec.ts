import { expect, type Page, test } from '@playwright/test';
import { mockLive } from './chief-home-mock';
import { pressAndExpect } from './helpers.js';

const cell = (page: Page, date: string) => page.locator(`[data-day="${date}"]`);
const readout = (page: Page) => page.getByTestId('usage-readout');

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('cairn.locale', 'en'));
});

test.describe('live', () => {
  test.use({ timezoneId: 'Asia/Shanghai' });

  test('the sidebar Usage link asks for the viewer zone and shades each local day', async ({
    page,
  }) => {
    await page.clock.setFixedTime(new Date('2026-11-15T20:00:00Z'));
    const asked: URLSearchParams[] = [];
    await mockLive(page, { threads: [], messages: [] }, (path, route, json) => {
      if (path !== '/api/teams/t1/usage/daily') return undefined;
      asked.push(new URL(route.request().url()).searchParams);
      return json({
        days: [
          { date: '2026-11-15', coordinator: 0, tasks: 4000 },
          { date: '2026-11-16', coordinator: 612000, tasks: 248000 },
        ],
      });
    });
    await page.goto('/app');
    await page.getByTestId('sidebar-usage').click();
    await expect(page).toHaveURL(/\/app\/usage/);
    await expect(page.getByRole('dialog', { name: 'Usage' })).toBeVisible();
    await expect(readout(page)).toHaveText(
      'Mon, November 16 · 860K token · Coordinator 612K · Tasks 248K',
    );
    expect(asked.at(-1)?.get('tz')).toBe('Asia/Shanghai');
    expect(asked.at(-1)?.get('days')).toBe('176');
    await expect(page.getByTestId('usage-recent-total')).toHaveText('864K token');
    await expect(cell(page, '2026-11-16')).toHaveAttribute('data-level', '4');
    await expect(cell(page, '2026-11-15')).toHaveAttribute('data-level', '1');
    await expect(cell(page, '2026-11-14')).toHaveAttribute('data-level', '0');
    await expect(cell(page, '2026-11-17')).toHaveCount(0);

    await cell(page, '2026-11-15').hover();
    await expect(readout(page)).toHaveText('Sun, November 15 · 4K token · Coordinator 0 · Tasks 4K');
    await cell(page, '2026-11-14').click();
    await page.mouse.move(0, 0);
    await expect(readout(page)).toHaveText('Sat, November 14 · No usage');
    await page.keyboard.press('ArrowDown');
    await expect(readout(page)).toHaveText('Sun, November 15 · 4K token · Coordinator 0 · Tasks 4K');
  });
});

test('a new team sees an empty state instead of a blank grid', async ({ page }) => {
  await mockLive(page, { threads: [], messages: [] }, (path, _route, json) =>
    path === '/api/teams/t1/usage/daily' ? json({ days: [] }) : undefined,
  );
  await page.goto('/app/usage');
  await expect(page.getByTestId('usage-empty')).toContainText('No usage yet');
  await expect(page.getByTestId('usage-heatmap')).toHaveCount(0);
});

test('Activity stays reachable from search after its footer button became Usage', async ({
  page,
}) => {
  await page.goto('/app');
  const footer = page.getByTestId('sidebar-footer');
  await expect(footer.getByTestId('sidebar-usage')).toBeVisible();
  await expect(footer.getByTestId('sidebar-activity')).toHaveCount(0);
  const search = page.getByRole('dialog', { name: 'Search' });
  await pressAndExpect(page, 'Meta+k', search);
  await search.getByRole('button', { name: 'Activity', exact: true }).click();
  await expect(page).toHaveURL(/\/app\/activity/);
  await expect(page.getByRole('dialog', { name: 'Activity' })).toBeVisible();
});
