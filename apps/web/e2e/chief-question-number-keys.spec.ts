import { expect, test } from '@playwright/test';

test('digits are ordinary text while a question waits: they pick no chip and no chip shows a number', async ({ page }) => {
  await page.goto('/app?scenario=home-c');
  const composer = page.getByTestId('home-c').getByTestId('chief-composer-input');
  const first = page.getByTestId('chief-question-option-0-0');
  const second = page.getByTestId('chief-question-option-0-1');
  await expect(first).toBeVisible();
  await expect(page.getByTestId('chief-question-chips').locator('kbd')).toHaveCount(0);
  await composer.focus();
  await page.keyboard.press('1');
  await expect(composer).toHaveValue('1');
  await expect(first).toHaveAttribute('aria-pressed', 'false');
  await composer.fill('');
  await composer.blur();
  await page.keyboard.press('2');
  await expect(second).toHaveAttribute('aria-pressed', 'false');
  await second.click();
  await expect(second).toHaveAttribute('aria-pressed', 'true');
});
