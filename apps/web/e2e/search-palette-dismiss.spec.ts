import { expect, type Page, test } from '@playwright/test';

const BOARD = '/app?scenario=01';

const panel = (page: Page) => page.getByRole('dialog', { name: '搜索' });
const input = (page: Page) => panel(page).getByRole('textbox');

async function openFromSidebarButton(page: Page) {
  await expect(page.getByRole('complementary')).toBeVisible();
  await page.getByRole('complementary').getByRole('button', { name: '搜索' }).click();
  await expect(panel(page)).toBeVisible();
  await expect(panel(page)).toHaveCSS('transform', 'none');
  await page.waitForTimeout(200);
}

async function clickBelowPanel(page: Page) {
  const box = (await panel(page).boundingBox())!;
  await page.mouse.click(Math.round(box.x + box.width / 2), Math.round(box.y + box.height + 40));
}

test('one click outside the palette closes it', async ({ page }) => {
  await page.goto(BOARD);
  await openFromSidebarButton(page);

  await clickBelowPanel(page);
  await expect(panel(page)).toBeHidden({ timeout: 3000 });
});

test('a dismissal click on the dialog layer outside the panel closes it', async ({ page }) => {
  await page.goto(BOARD);
  await openFromSidebarButton(page);

  await page.evaluate(() => {
    document.querySelector<HTMLElement>('[data-slot="dialog-content"]')?.click();
  });
  await expect(panel(page)).toBeHidden({ timeout: 3000 });
});

test('one Escape closes the palette while the field holds text', async ({ page }) => {
  await page.goto(BOARD);
  await openFromSidebarButton(page);

  await expect(input(page)).toBeFocused();
  await page.keyboard.type('r3 lifecycle');
  await expect(input(page)).toHaveValue('r3 lifecycle');

  await page.keyboard.press('Escape');
  await expect(panel(page)).toBeHidden({ timeout: 3000 });
});

test('one Escape closes the palette while the field is composing', async ({ page }) => {
  await page.goto(BOARD);
  await openFromSidebarButton(page);

  await expect(input(page)).toBeFocused();
  await page.keyboard.type('r3');
  await page.evaluate(() => {
    document.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    document.activeElement?.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Escape',
        code: 'Escape',
        bubbles: true,
        cancelable: true,
        isComposing: true,
      }),
    );
  });
  await expect(panel(page)).toBeHidden({ timeout: 3000 });
});

test('one Escape closes the empty palette', async ({ page }) => {
  await page.goto(BOARD);
  await openFromSidebarButton(page);

  await page.keyboard.press('Escape');
  await expect(panel(page)).toBeHidden({ timeout: 3000 });
});

test('Escape closes the syntax help first and the palette on the next press', async ({ page }) => {
  await page.goto(BOARD);
  await openFromSidebarButton(page);

  const help = panel(page).getByRole('button', { name: '语法' });
  await help.click();
  await expect(help).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Escape');
  await expect(help).toHaveAttribute('aria-expanded', 'false');
  await expect(panel(page)).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(panel(page)).toBeHidden({ timeout: 3000 });
});
