import { expect, type Page, test } from '@playwright/test';

const BOARD = '/app?scenario=01';

async function pressAtLoad(page: Page, init: KeyboardEventInit) {
  await page.addInitScript((eventInit) => {
    window.addEventListener('load', () => {
      document.body.dispatchEvent(
        new KeyboardEvent('keydown', { ...eventInit, bubbles: true, cancelable: true }),
      );
    });
  }, init);
}

test('R1: ⌘K at load opens search', async ({ page }) => {
  await pressAtLoad(page, { key: 'k', metaKey: true });
  await page.goto(BOARD);
  await expect(page.getByRole('dialog', { name: '搜索' })).toBeVisible();
});

test('R2: C at load focuses the home composer', async ({ page }) => {
  await pressAtLoad(page, { key: 'c' });
  await page.goto(BOARD);
  await expect(page.getByTestId('home-c').getByTestId('chief-composer-input')).toBeFocused();
  await expect(page.getByRole('dialog', { name: '新建任务' })).toHaveCount(0);
});

test('R3: ⌘J at load opens the Coordinator drawer', async ({ page }) => {
  await pressAtLoad(page, { key: 'j', metaKey: true });
  await page.goto('/app/schedules?scenario=01');
  await expect(page.locator('.chief-drawer')).toBeVisible();
});

test('R5: the app is mounted when load fires', async ({ page }) => {
  await page.addInitScript(() => {
    window.addEventListener('load', () => {
      document.documentElement.dataset.sidebarAtLoad = String(
        document.querySelector('.board-sidebar') !== null,
      );
    });
  });
  await page.goto(BOARD);
  await expect(page.locator('html')).toHaveAttribute('data-sidebar-at-load', 'true');
});
