import { expect, test } from '@playwright/test';

test('with a pending question and a task thread open at 1440 the header keeps its screen-reader title and every button inside the chat column', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/app?scenario=home-c&thread=home-c-working-a');
  const header = page.getByTestId('home-c-pane-buttons');
  await expect(header).toBeVisible();
  await expect(page.getByTestId('side-chat')).toBeVisible();
  await expect(page.getByTestId('chief-question')).toBeVisible();
  const column = (await page.getByTestId('home-c').boundingBox())!;
  await expect(header.getByRole('heading', { level: 1 })).toHaveText('Coordinator');
  await expect(header.getByRole('heading', { level: 1 })).toHaveClass(/sr-only/);
  for (const name of ['任务', '成果', '电脑']) {
    const box = (await header.getByRole('button', { name }).boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(column.x);
    expect(box.x + box.width).toBeLessThanOrEqual(column.x + column.width + 1);
  }
  expect(column.width).toBeGreaterThanOrEqual(400);
  await page.screenshot({ path: testInfo.outputPath('d122-bugs-n13.png') });
});
