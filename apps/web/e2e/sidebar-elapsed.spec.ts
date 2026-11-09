import { expect, test } from '@playwright/test';
import { mockLive, TASK, THREAD } from './chief-home-mock';

const STATE = { threads: [THREAD], messages: [], todos: [TASK] };

test('a running task in the sidebar shows its real elapsed time', async ({ page }, testInfo) => {
  await mockLive(page, structuredClone(STATE));
  await page.goto('/app');
  const row = page.locator('[data-slot="sidebar-thread-row"]').first();
  await expect(row).toContainText(/1[0-9] 分/);
  await page.screenshot({ path: testInfo.outputPath('d122-elapsed-after.png'), clip: { x: 0, y: 0, width: 260, height: 400 } });
});

test('a running task with no start time shows no duration at all', async ({ page }, testInfo) => {
  await mockLive(page, { ...structuredClone(STATE), todos: [{ ...TASK, phaseAt: 0 }] });
  await page.goto('/app');
  const row = page.locator('[data-slot="sidebar-thread-row"]').first();
  await expect(row).toBeVisible();
  await expect(row).not.toContainText(/\d+\s*(天|小时|分)/);
  await page.screenshot({ path: testInfo.outputPath('d122-elapsed-zero.png'), clip: { x: 0, y: 0, width: 260, height: 400 } });
});
