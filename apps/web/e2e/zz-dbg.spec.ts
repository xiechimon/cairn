import { expect, test } from '@playwright/test';
test('dbg wheel', async ({ page }) => {
  await page.goto('/app?scenario=chief-scroll-park');
  await expect(page.locator('.chief-drawer')).toBeVisible();
  const body = page.getByTestId('chief-body');
  await page.waitForTimeout(300);
  const g0 = await body.evaluate((el) => ({ st: el.scrollTop, sh: el.scrollHeight, ch: el.clientHeight }));
  console.log('initial', g0);
  const box = await page.locator('.chief-drawer').evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
  const vpBox = await body.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
  console.log('vpBox', vpBox);
  for (let i = 0; i < 10; i++) {
    await page.mouse.wheel(box.x + box.width / 2, box.y + box.height / 2, { deltaY: -200 });
    await page.waitForTimeout(40);
  }
  await page.waitForTimeout(250);
  console.log('after wheel-up scrollTop', await body.evaluate((el) => el.scrollTop));
  console.log('scroller attrs', await page.locator('[data-slot="message-scroller"]').evaluate((el) => ({
    scrollable: el.getAttribute('data-scrollable'),
    autoscrolling: el.hasAttribute('data-autoscrolling'),
  })));
});
