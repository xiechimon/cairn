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

test('the state word stays under the mark for as long as the turn runs', async ({ page }) => {
  await page.clock.install();
  await page.goto('/app?scenario=chief-draft');
  const word = page.getByTestId('chief-status-pill');
  await expect(word).toHaveAttribute('data-visible', 'true');
  await expect(word).toHaveText('Running a command');
  await page.clock.runFor(10_000);
  await expect(word).toHaveAttribute('data-visible', 'true');
});

test('a running task word carries the spinner ring, with the state in the accessible name only', async ({
  page,
}) => {
  await page.goto('/app?scenario=chief-draft');
  const stream = page.getByTestId('chief-stream');
  const word = stream.locator('a[data-slot="task-mention"]').filter({ has: page.locator('svg[data-glyph="working"]') });
  await expect(word).toHaveCount(1);
  await expect(word).not.toContainText('Running');
  await expect(word).toHaveAccessibleName(/Running/);
});
