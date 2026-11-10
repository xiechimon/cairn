import { expect, test } from '@playwright/test';
import { mockLive, THREAD } from './chief-home-mock';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('cairn.locale', 'en'));
});

test('a quiet stamp separates messages more than ten minutes apart and not closer ones', async ({
  page,
}) => {
  const now = Date.now();
  const minutes = (n: number) => now - n * 60_000;
  await mockLive(page, {
    threads: [THREAD],
    messages: [
      { id: 'm1', role: 'user', content: 'First question', createdAt: minutes(90) },
      { id: 'm2', role: 'assistant', content: 'First answer', createdAt: minutes(89) },
      { id: 'm3', role: 'user', content: 'Second question', createdAt: minutes(30) },
      { id: 'm4', role: 'assistant', content: 'Second answer', createdAt: minutes(29) },
    ],
    todos: [],
    tasks: [],
  });
  await page.goto('/app');
  const dividers = page.getByTestId('chief-time-divider');
  await expect(page.getByText('Second answer')).toBeVisible();
  await expect(dividers).toHaveCount(1);
  await expect(dividers.first()).toHaveText(/^(Today|Yesterday) \d{2}:\d{2}$/);
  const before = await page.getByText('First answer').boundingBox();
  const stamp = await dividers.first().boundingBox();
  const after = await page.getByText('Second question').boundingBox();
  expect(stamp!.y).toBeGreaterThan(before!.y);
  expect(stamp!.y).toBeLessThan(after!.y);
});
