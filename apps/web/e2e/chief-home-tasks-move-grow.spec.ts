import { expect, type Page, test } from '@playwright/test';
import { mockLive, taskEntry, THREAD } from './chief-home-mock.js';

const panel = (page: Page) => page.getByRole('complementary', { name: '任务' });
const section = (page: Page, name: string) =>
  panel(page).locator(`[data-testid="tasks-section"][data-section="${name}"]`);

async function resync(page: Page) {
  await page.waitForFunction(() => window.__es.some((es) => es.url.includes('/api/teams/t1/stream')));
  await page.evaluate(() =>
    (
      window.__es.find((es) => es.url.includes('/api/teams/t1/stream')) as unknown as {
        onerror: () => void;
      }
    ).onerror(),
  );
}

test('a task that moves group grows in at its new place and the receiving count flashes once', async ({ page }) => {
  const moving = taskEntry({ id: 'todo-1', title: 'Fix the drag count', section: 'working' });
  const staying = taskEntry({ id: 'todo-2', title: 'Sweep dependencies', seqNum: 12, section: 'working' });
  const state = { threads: [THREAD], messages: [], tasks: [moving, staying] };
  await mockLive(page, state);
  await page.goto('/app?pane=tasks');
  await expect(section(page, 'working').getByText('Fix the drag count')).toBeVisible();
  expect(await panel(page).locator('[data-grow], [data-flash]').count()).toBe(0);

  state.tasks = [{ ...moving, phase: 'review', section: 'ready_for_review' }, staying];
  await resync(page);
  const landed = section(page, 'ready_for_review');
  await expect(landed.getByText('Fix the drag count')).toBeVisible();
  await expect(section(page, 'working').getByText('Fix the drag count')).toHaveCount(0);
  await expect(landed.locator('[data-grow]')).toHaveCount(1);
  await expect(landed.locator('[data-flash]')).toHaveText('1');
  await expect(section(page, 'working').locator('[data-grow], [data-flash]')).toHaveCount(0);
  await expect(panel(page).locator('[data-grow], [data-flash]')).toHaveCount(0, { timeout: 3000 });
});

test('a reload lays the groups out still', async ({ page }) => {
  const state = {
    threads: [THREAD], messages: [],
    tasks: [taskEntry({ id: 'todo-1', title: 'Fix the drag count', phase: 'review', section: 'ready_for_review' })],
  };
  await mockLive(page, state);
  await page.goto('/app?pane=tasks');
  await expect(section(page, 'ready_for_review').getByText('Fix the drag count')).toBeVisible();
  await page.reload();
  await expect(section(page, 'ready_for_review').getByText('Fix the drag count')).toBeVisible();
  expect(await panel(page).locator('[data-grow], [data-flash]').count()).toBe(0);
});
