import { expect, type Page, test } from '@playwright/test';

const BOARD = '/app?scenario=01';

async function pressAtLoad(page: Page, key: string) {
  await page.waitForSelector('.board-sidebar', { state: 'attached' });
  await page.keyboard.press(key);
}

test('R1: ⌘K at load opens search', async ({ page }) => {
  const ready = pressAtLoad(page, 'Meta+k');
  await page.goto(BOARD);
  await ready;
  await expect(page.getByRole('dialog', { name: '搜索' })).toBeVisible();
});

test('R2: C at load focuses the home composer', async ({ page }) => {
  const ready = pressAtLoad(page, 'c');
  await page.goto(BOARD);
  await ready;
  await expect(page.getByTestId('home-c').getByTestId('chief-composer-input')).toBeFocused();
  await expect(page.getByRole('dialog', { name: '新建任务' })).toHaveCount(0);
});

test('R3: ⌘J at load navigates to the Coordinator page', async ({ page }) => {
  const ready = pressAtLoad(page, 'Meta+j');
  await page.goto('/app?scenario=01&pane=tasks&tab=scheduled');
  await ready;
  await expect(page).toHaveURL(/\/app\?scenario=01$/);
  await expect(page.getByTestId('home-c').getByTestId('chief-composer-input')).toBeFocused();
});

test('R5: the app mounts without interaction shortly after load', async ({ page }) => {
  await page.addInitScript(() => {
    window.addEventListener('load', () => {
      document.documentElement.dataset.loadAt = String(performance.now());
    });
  });
  await page.goto(BOARD);
  const sidebar = page.locator('.board-sidebar');
  await expect(sidebar).toBeAttached();
  const gap = await page.evaluate(
    () => performance.now() - Number(document.documentElement.dataset.loadAt ?? '0'),
  );
  expect(gap).toBeLessThan(4000);
});
