import { expect, type Page, test } from '@playwright/test';

const BOARD = '/app?scenario=01';
const DETAIL = '/app/todo/7ve0iOkQ-JBpSL98zSiGc?scenario=27';

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

test('R2: C at load opens the new-task dialog', async ({ page }) => {
  await pressAtLoad(page, { key: 'c' });
  await page.goto(BOARD);
  await expect(page.locator('.new-task-dialog')).toBeVisible();
});

test('R3: ⌘J at load opens the chief drawer', async ({ page }) => {
  await pressAtLoad(page, { key: 'j', metaKey: true });
  await page.goto('/app?view=board&scenario=01');
  await expect(page.locator('.chief-drawer')).toBeVisible();
});

test('R4: Escape at load on the detail page leaves it', async ({ page }) => {
  await pressAtLoad(page, { key: 'Escape' });
  await page.goto(DETAIL);
  await expect(page).toHaveURL(/\/app\?scenario=27$/);
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
