import { expect, type Page, test } from '@playwright/test';
import { mockLive } from './chief-home-mock';

const bar = (page: Page, date: string) => page.locator(`[data-testid="usage-chart"] [data-day="${date}"]`);
const readout = (page: Page) => page.getByTestId('usage-readout');

const day = (date: string, coordinator: number, tasks: number, models: Record<string, number>) => ({
  date,
  coordinator,
  tasks,
  input: Math.round((coordinator + tasks) * 0.2),
  output: 0,
  cacheRead: Math.round((coordinator + tasks) * 0.8),
  cacheWrite: 0,
  models,
  projects: tasks > 0 ? { p1: tasks } : {},
  todos: tasks > 0 ? ['todo-1'] : [],
  cost: null,
});

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('cairn.locale', 'en'));
});

test.describe('live', () => {
  test.use({ timezoneId: 'Asia/Shanghai' });

  test('a new user sees their days from the first one, split by source and by model', async ({
    page,
  }) => {
    await page.clock.setFixedTime(new Date('2026-11-16T12:00:00Z'));
    const asked: URLSearchParams[] = [];
    await mockLive(page, { threads: [], messages: [] }, (path, route, json) => {
      if (path !== '/api/teams/t1/usage/daily') return undefined;
      asked.push(new URL(route.request().url()).searchParams);
      return json({
        days: [
          day('2026-11-15', 4000, 0, { 'cc/haiku': 4000 }),
          day('2026-11-16', 612000, 248000, { 'cc/haiku': 612000, 'gw/big': 248000 }),
        ],
        models: [
          { key: 'cc/haiku', name: 'claude-haiku-5-5', provider: 'Claude Code' },
          { key: 'gw/big', name: 'Big Model', provider: 'Gateway' },
        ],
        projects: [{ id: 'p1', name: 'cairn' }],
      });
    });
    await page.goto('/app');
    await page.getByTestId('sidebar-usage').click();
    await expect(page).toHaveURL(/\/app\/usage/);
    await expect(page.getByRole('dialog', { name: 'Usage' })).toBeVisible();
    expect(asked.at(-1)?.get('tz')).toBe('Asia/Shanghai');
    expect(asked.at(-1)?.get('days')).toBe('180');
    await expect(page.getByTestId('usage-stats')).toContainText('Since 11/15');
    await expect(page.getByTestId('usage-stats')).toContainText('864K token');
    await expect(page.getByTestId('usage-stats')).toContainText('1 task');
    await expect(page.getByTestId('usage-stats')).toContainText('80%');
    await expect(page.locator('[data-testid="usage-chart"] [data-day]')).toHaveCount(7);
    await expect(bar(page, '2026-11-10')).toHaveCount(1);
    await expect(readout(page)).toHaveText('Started 11/15 · 2 days used');

    await bar(page, '2026-11-16').hover();
    await expect(readout(page)).toHaveText(
      'Mon, November 16 · 860K token · Coordinator 612K · Tasks 248K',
    );
    await page.getByTestId('usage-split-model').click();
    await bar(page, '2026-11-16').hover();
    await expect(readout(page)).toHaveText(
      'Mon, November 16 · 860K token · claude-haiku-5-5 612K · Big Model 248K',
    );
    await expect(page.getByTestId('usage-models')).toContainText('Big ModelGateway');
    await expect(page.getByTestId('usage-projects')).toContainText('cairn248K100%');

    await page.mouse.move(0, 0);
    await page.getByTestId('usage-chart').focus();
    await page.keyboard.press('ArrowLeft');
    await expect(readout(page)).toHaveText('Mon, November 16 · 860K token · claude-haiku-5-5 612K · Big Model 248K');
    await page.keyboard.press('ArrowLeft');
    await expect(readout(page)).toHaveText(
      'Sun, November 15 · 4K token · claude-haiku-5-5 4K',
    );
  });
});

test('a new team sees an empty state instead of a blank chart', async ({ page }) => {
  await mockLive(page, { threads: [], messages: [] }, (path, _route, json) =>
    path === '/api/teams/t1/usage/daily' ? json({ days: [], models: [], projects: [] }) : undefined,
  );
  await page.goto('/app/usage');
  await expect(page.getByTestId('usage-empty')).toContainText('No usage yet');
  await expect(page.getByTestId('usage-chart')).toHaveCount(0);
});
