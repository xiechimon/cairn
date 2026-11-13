import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('cairn.locale', 'en'));
});

test('the working row is typing dots with no text label and no steps control', async ({ page }) => {
  await page.goto('/app?scenario=chief-draft');
  const stream = page.getByTestId('chief-stream');
  await expect(stream.getByTestId('typing-dots')).toBeVisible();
  await expect(stream.getByRole('button', { name: 'View steps' })).toHaveCount(0);
  await expect(stream.getByTestId('chief-live-notice')).toHaveCount(0);
  await expect(stream.getByTestId('chief-turn-tools')).toHaveCount(0);
  await expect(page.getByTestId('chief-status-mark')).toHaveAttribute('data-state', 'run');
});

test('the task reference row carries the one spinner ring, with the state in the accessible name only', async ({
  page,
}) => {
  await page.goto('/app?scenario=chief-draft');
  const stream = page.getByTestId('chief-stream');
  const ref = stream.getByTestId('chief-task-ref');
  await expect(ref).not.toContainText('In progress');
  await expect(ref.locator('svg[data-glyph="progress"]')).toHaveCount(1);
  await expect(stream.locator('svg[data-glyph="progress"]')).toHaveCount(1);
  await expect(stream.locator('a.mention-chip')).toHaveCount(0);
});
