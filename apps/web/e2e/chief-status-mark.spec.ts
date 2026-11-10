import { expect, test } from '@playwright/test';

test('an idle Coordinator shows the mark at the top centre of the chat with no status pill', async ({
  page,
}) => {
  await page.goto('/app?scenario=home-c');
  const mark = page.getByTestId('chief-status-mark');
  await expect(mark).toBeVisible();
  await expect(page.getByTestId('chief-status-pill')).toHaveCount(0);

  const chat = await page.getByTestId('home-c').boundingBox();
  const box = await mark.boundingBox();
  if (chat === null || box === null) throw new Error('chat or mark has no box');
  expect(Math.abs(box.x + box.width / 2 - (chat.x + chat.width / 2))).toBeLessThanOrEqual(1);
  expect(box.y - chat.y).toBeLessThanOrEqual(16);
});

test('a working Coordinator names its status in a pill under the mark, in the words of the stream', async ({
  page,
}) => {
  await page.goto('/app?scenario=chief-working');
  const pill = page.getByTestId('chief-status-pill');
  await expect(pill).toBeVisible();
  const status = (await pill.textContent()) ?? '';
  expect(status.length).toBeGreaterThan(0);
  await expect(page.getByTestId('home-c').getByText(status, { exact: true })).toHaveCount(2);
});

test('the mark never takes a click meant for the header controls', async ({ page }) => {
  await page.goto('/app?scenario=chief-working');
  await expect(page.getByTestId('chief-status-mark')).toHaveCSS('pointer-events', 'none');
});
