import { expect, type Page, test } from '@playwright/test';

const drawer = (page: Page) => page.locator('.chief-drawer');
const viewport = (page: Page) => page.getByTestId('chief-body');

test('probe: wheel up (backward) scroll + reopen behavior', async ({ page }) => {
  await page.goto('/app?scenario=chief-scroll-long');
  await expect(drawer(page)).toBeVisible();
  await drawer(page).evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));

  // start at bottom (default end position), wheel UP to the middle
  const box = await viewport(page).boundingBox();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  for (let i = 0; i < 12; i++) {
    await page.mouse.wheel(0, -120);
    await page.waitForTimeout(30);
  }
  await page.waitForTimeout(300);
  const parked = await viewport(page).evaluate((el) => el.scrollTop);
  const range = await viewport(page).evaluate((el) => el.scrollHeight - el.clientHeight);
  console.log('PARKED AFTER WHEEL-UP:', parked, 'RANGE:', range);

  await drawer(page).getByRole('button', { name: '最小化' }).click();
  await expect(drawer(page)).toBeHidden();
  const whileParked = await viewport(page).evaluate((el) => el.scrollTop);

  await page.locator('.chief-fab').click();
  await drawer(page).evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
  await page.waitForTimeout(500);
  const reopened = await viewport(page).evaluate((el) => el.scrollTop);
  console.log('WHILE_PARKED:', whileParked, 'REOPENED:', reopened);
});
