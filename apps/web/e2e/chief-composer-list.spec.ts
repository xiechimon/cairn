import { expect, test } from '@playwright/test';

test.describe('Coordinator composer ordered list keys', () => {
  test('Backspace right after an auto-continued marker removes the whole marker (#5352)', async ({
    page,
  }) => {
    await page.goto('/app?scenario=114');
    const composer = page.getByTestId('home-c').getByTestId('chief-composer-input');
    await expect(composer).toBeVisible();

    await composer.fill('1. foo');
    await composer.press('Shift+Enter');
    await expect(composer).toHaveValue('1. foo\n2. ');

    await composer.press('Backspace');
    await expect(composer).toHaveValue('1. foo\n');
    await expect
      .poll(() => composer.evaluate((el) => (el as HTMLTextAreaElement).selectionStart))
      .toBe(7);

    await composer.press('Backspace');
    await expect(composer).toHaveValue('1. foo');
  });
});
