import { expect, test } from '@playwright/test';

test('digits are ordinary text in the composer; inside the card a digit moves to that numbered row', async ({ page }) => {
  await page.goto('/app?scenario=home-c');
  const composer = page.getByTestId('home-c').getByTestId('chief-composer-input');
  const first = page.getByTestId('chief-question-option-0-0');
  const second = page.getByTestId('chief-question-option-0-1');
  await expect(first).toBeVisible();
  await expect(first).toContainText('1');
  await composer.focus();
  await page.keyboard.press('1');
  await expect(composer).toHaveValue('1');
  await expect(first).toHaveAttribute('aria-pressed', 'false');
  await composer.fill('');
  await first.focus();
  await page.keyboard.press('2');
  await expect(second).toBeFocused();
  await expect(second).toHaveAttribute('aria-pressed', 'false');
  await page.keyboard.press('ArrowUp');
  await expect(first).toBeFocused();
});
