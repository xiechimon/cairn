import { expect, type Page, test } from '@playwright/test';
import { mockLive } from './chief-home-mock';

const cell = (page: Page, date: string) =>
  page.locator(`[data-testid="usage-heatmap"] [data-day="${date}"]`);
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

  test('a full year of days: hover reads a day, a click scopes the rankings to it', async ({
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
    expect(asked.at(-1)?.get('days')).toBe('371');
    const stats = page.getByTestId('usage-stats');
    await expect(stats).toContainText('Past year864K token');
    await expect(stats).toContainText('Coordinator 71% · Tasks 29%');
    await expect(stats).toContainText('80%');
    await expect(page.locator('[data-testid="usage-heatmap"] [data-day]')).toHaveCount(365);
    await expect(page.getByTestId('usage-legend')).toHaveText('LessMore');
    await expect(page.getByTestId('usage-since')).toHaveText('Started 11/15');
    await expect(readout(page)).toHaveText('This month · 864K token · Coordinator 616K · Tasks 248K');
    await expect(page.getByTestId('usage-current-month')).toBeVisible();
    const card = (await page.getByTestId('usage-year').boundingBox())!;
    const frame = (await page.getByTestId('usage-heatmap-frame').boundingBox())!;
    const map = (await page.getByTestId('usage-heatmap').boundingBox())!;
    expect(Math.abs(frame.x - card.x - (card.x + card.width - map.x - map.width))).toBeLessThan(3);
    await expect(stats.locator(':scope > div').nth(3)).toContainText('Cache read');

    await cell(page, '2026-11-16').hover();
    await expect(readout(page)).toHaveText(
      'Mon, November 16 · 860K token · Coordinator 612K · Tasks 248K',
    );
    await expect(page.getByTestId('usage-models')).toContainText('Big ModelGateway');
    await expect(page.getByTestId('usage-projects')).toContainText('cairn248K100%');

    await cell(page, '2026-11-15').click();
    await expect(cell(page, '2026-11-15')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('usage-models')).not.toContainText('Big Model');
    await expect(page.getByTestId('usage-projects')).toHaveCount(0);
    await page.mouse.move(0, 0);
    await expect(readout(page)).toHaveText('Sun, November 15 · 4K token · Coordinator 4K · Tasks 0');

    await page.keyboard.press('ArrowDown');
    await expect(cell(page, '2026-11-16')).toBeFocused();
    await expect(cell(page, '2026-11-16')).toHaveAttribute('aria-pressed', 'true');
    await cell(page, '2026-11-16').click();
    await expect(cell(page, '2026-11-16')).toHaveAttribute('aria-pressed', 'false');
    await expect(stats).toContainText('864K token');
  });

  test('the current month outline runs in the gaps around its days', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.clock.setFixedTime(new Date('2026-11-21T12:00:00Z'));
    await mockLive(page, { threads: [], messages: [] }, (path, _route, json) =>
      path === '/api/teams/t1/usage/daily'
        ? json({
            days: [day('2026-11-02', 4000, 0, { 'cc/haiku': 4000 })],
            models: [{ key: 'cc/haiku', name: 'claude-haiku-5-5', provider: 'Claude Code' }],
            projects: [],
          })
        : undefined,
    );
    await page.goto('/app/usage');
    const days = page.locator('[data-testid="usage-heatmap"] [data-day^="2026-11-"]');
    await expect(days).toHaveCount(21);
    const boxes = await days.evaluateAll((els) =>
      els.map((el) => {
        const r = el.getBoundingClientRect();
        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
      }),
    );
    const outline = page.getByTestId('usage-current-month').locator('path');
    await expect(outline).toBeVisible();
    const line = await outline.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
    });
    const monday = (await cell(page, '2026-11-02').boundingBox())!;
    const nextMonday = (await cell(page, '2026-11-09').boundingBox())!;
    const half = (nextMonday.x - monday.x - monday.width) / 2;
    const near = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(1);
    near(line.left, Math.min(...boxes.map((b) => b.left)) - half);
    near(line.right, Math.max(...boxes.map((b) => b.right)) + half);
    near(line.top, Math.min(...boxes.map((b) => b.top)) - half);
    near(line.bottom, Math.max(...boxes.map((b) => b.bottom)) + half);
  });
});

test('a new team sees an empty state instead of a blank chart', async ({ page }) => {
  await mockLive(page, { threads: [], messages: [] }, (path, _route, json) =>
    path === '/api/teams/t1/usage/daily' ? json({ days: [], models: [], projects: [] }) : undefined,
  );
  await page.goto('/app/usage');
  await expect(page.getByTestId('usage-empty')).toContainText('No usage yet');
  await expect(page.getByTestId('usage-heatmap')).toHaveCount(0);
});
