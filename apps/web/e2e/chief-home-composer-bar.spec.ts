import { expect, test } from '@playwright/test';

test.describe('Coordinator home composer bar', () => {
  test('composer bar carries the attach tool and the send button', async ({ page }) => {
    await page.goto('/app?scenario=111');
    const bar = page.getByTestId('home-c').locator('.chief-composer');
    await expect(bar.locator('button[aria-label="语音输入"]')).toHaveCount(0);
    await expect(bar.locator('button[aria-label="添加附件"]')).toBeVisible();
    await expect(bar.locator('button[aria-label="发送"]')).toBeVisible();
  });

  test('composer grows to the six-line cap and an empty face keeps the base track (#860)', async ({
    page,
  }) => {
    await page.goto('/app?scenario=114');
    const composer = page.getByTestId('home-c').getByTestId('chief-composer-input');
    await expect(composer).toBeVisible();
    const face = () =>
      composer.evaluate((el) => ({
        cssHeight: getComputedStyle(el).height,
        overflowY: getComputedStyle(el).overflowY,
      }));
    expect(await face()).toEqual({ cssHeight: '36px', overflowY: 'auto' });
    await composer.fill(Array.from({ length: 10 }, (_, i) => `line ${i + 1}`).join('\n'));
    await expect.poll(face).toEqual({ cssHeight: '120px', overflowY: 'auto' });
  });
});
