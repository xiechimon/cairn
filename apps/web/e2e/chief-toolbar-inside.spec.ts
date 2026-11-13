import { expect, test } from '@playwright/test';

for (const size of [
  { name: '700px window', width: 700, height: 900 },
  { name: '390px window', width: 390, height: 844 },
]) {
  test(`with a mouse, the hover toolbar beside a wide bubble stays fully inside the conversation (${size.name})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    await page.goto('/app?scenario=chief-md-ref');
    const body = page.getByTestId('chief-body');
    await expect(body).toBeVisible();
    const blocks = page
      .getByTestId('chief-stream')
      .locator('[data-slot="reply-block"]')
      .filter({ has: page.locator('[data-placement="right"], [data-placement="left"]') });
    const count = await blocks.count();
    expect(count).toBeGreaterThan(0);
    let checked = 0;
    for (let n = count - 1; n >= 0 && checked < 4; n -= 1) {
      const block = blocks.nth(n);
      await block.scrollIntoViewIfNeeded();
      if (!(await block.isVisible())) continue;
      const bubble = (await block.boundingBox())!;
      await page.mouse.move(bubble.x + Math.min(20, bubble.width / 2), bubble.y + bubble.height / 2);
      const toolbar = block.locator('> [data-placement="right"], > [data-placement="left"]');
      await expect(toolbar).toHaveCSS('opacity', '1');
      const frame = (await body.boundingBox())!;
      const box = (await toolbar.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(Math.max(0, frame.x) - 0.5);
      expect(box.x + box.width).toBeLessThanOrEqual(Math.min(size.width, frame.x + frame.width) + 0.5);
      checked += 1;
    }
    expect(checked).toBeGreaterThan(0);
  });
}
