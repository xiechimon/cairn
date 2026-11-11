import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('cairn.locale', 'en'));
});

test('the working row is typing dots with no text label, and the dots open the live steps', async ({
  page,
}) => {
  await page.goto('/app?scenario=chief-draft');
  const stream = page.getByTestId('chief-stream');
  const dots = stream.getByTestId('typing-dots');
  await expect(dots).toBeVisible();
  await expect(dots).toHaveAccessibleName('View steps');
  await expect(dots).toHaveAttribute('aria-expanded', 'false');
  await expect(stream.getByTestId('chief-live-notice')).toHaveCount(0);
  await expect(stream.getByTestId('chief-turn-tools')).toHaveCount(0);
  await dots.click();
  await expect(dots).toHaveAttribute('aria-expanded', 'true');
  await expect(stream.getByTestId('chief-turn-tools')).toBeVisible();
  await dots.click();
  await expect(stream.getByTestId('chief-turn-tools')).toHaveCount(0);
});

test('the task reference row and inline chip carry the spinner ring, with the state in the accessible name only', async ({
  page,
}) => {
  await page.goto('/app?scenario=chief-draft');
  const stream = page.getByTestId('chief-stream');
  const ref = stream.getByTestId('chief-task-ref');
  await expect(ref).not.toContainText('In progress');
  await expect(ref.locator('svg[data-glyph="progress"]')).toHaveCount(1);
  await expect(stream.locator('a.mention-chip svg[data-glyph="progress"]')).toHaveCount(1);
});
