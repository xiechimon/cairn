import { expect, type Page, test } from '@playwright/test';
import { mockLive, PROJECT, TASK, THREAD } from './chief-home-mock';

const SITE = { ...PROJECT, id: 'proj-2', name: 'cairn-site', repoName: 'cairn-site' };

const composer = (page: Page) => page.getByTestId('home-c').getByTestId('chief-composer-input');

async function mockWorld(page: Page, rejectSend = false) {
  await mockLive(page, {
    threads: rejectSend ? [] : [THREAD],
    messages: [],
    todos: [TASK],
    projects: [PROJECT, SITE],
    rejectSend,
  });
}

test('the home composer is one text box: no project chip and no save-as-draft', async ({
  page,
}) => {
  await mockWorld(page);
  await page.goto('/app');
  await expect(composer(page)).toBeVisible();
  await expect(page.getByTestId('home-c').getByTestId('chief-project-chip')).toHaveCount(0);
  await expect(page.getByTestId('composer-save-draft')).toHaveCount(0);
});

test('a toast lands over the main column, clear of the sidebar and the composer', async ({
  page,
}) => {
  await mockWorld(page, true);
  await page.goto('/app');
  await composer(page).fill('Toast placement');
  await composer(page).press('Enter');
  const toast = page.locator('[data-sonner-toast]').first();
  await expect(toast).toBeVisible();
  await page.waitForTimeout(500);
  const box = (await toast.boundingBox())!;
  const sidebar = (await page.locator('.board-sidebar').boundingBox())!;
  const composerBox = (await page.getByTestId('home-c').locator('.chief-composer').boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(sidebar.x + sidebar.width);
  expect(box.y + box.height).toBeLessThanOrEqual(composerBox.y);
  const toaster = page.locator('[data-sonner-toaster]');
  await expect(toaster).toHaveAttribute('data-y-position', 'bottom');
  await expect(toaster).toHaveAttribute('data-x-position', 'right');
  expect(page.viewportSize()!.width - (box.x + box.width)).toBeCloseTo(16, 0);
  await expect(toast.locator('[data-close-button]')).toBeVisible();
});

test('at phone width a toast lands below the menu button and clear of the composer', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockWorld(page, true);
  await page.goto('/app');
  await composer(page).fill('Toast placement narrow');
  await composer(page).press('Enter');
  const toast = page.locator('[data-sonner-toast]').first();
  await expect(toast).toBeVisible();
  await page.waitForTimeout(500);
  const box = (await toast.boundingBox())!;
  const composerBox = (await page.getByTestId('home-c').locator('.chief-composer').boundingBox())!;
  const menu = (await page.getByTestId('narrow-menu').boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(menu.y + menu.height);
  expect(box.y + box.height).toBeLessThanOrEqual(composerBox.y);
});
