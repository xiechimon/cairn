import { expect, test } from '@playwright/test';

const DETAIL_LONG_MODELS = '/app/resources/agents/r3-builder?scenario=agent-detail-long-models';
const LONG_IDS = [
  'deepseek-v4-pro[1M]',
  'qwen3.8-max-0902[1M]',
  'vendor/very-long-model-id-for-clipping-check-2026-10[1M]',
];

test('long model id: overview tab model popover does not clip horizontally, longest id fully visible (#1301)', async ({ page }) => {
  await page.goto(DETAIL_LONG_MODELS);
  const detail = page.locator('.agent-detail');
  const trigger = detail.locator('.agent-model-select');
  await expect(trigger).toContainText('qwen3.8-max-0902[1M]');
  await trigger.click();
  const menu = page.locator('.agent-model-menu');
  await expect(menu).toBeVisible();
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished)));

  const m = await menu.evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth }));
  expect(m.sw).toBeLessThanOrEqual(m.cw);

  for (const id of LONG_IDS) {
    const row = menu.locator('.agent-model-row', { hasText: id });
    await expect(row).toHaveCount(1);
    const fit = await row.evaluate((el) => {
      const text = el.querySelector(':scope > *:first-child') as HTMLElement;
      return {
        textRight: text.getBoundingClientRect().right,
        rowRight: el.getBoundingClientRect().right,
        textSw: text.scrollWidth,
        textCw: text.clientWidth,
      };
    });
    expect(fit.textRight).toBeLessThanOrEqual(fit.rowRight + 0.5);
    expect(fit.textSw).toBeLessThanOrEqual(fit.textCw);
  }

  const viewport = page.viewportSize();
  const mb = await menu.boundingBox();
  const tb = await trigger.boundingBox();
  if (viewport === null || mb === null || tb === null) throw new Error('missing geometry');
  expect(mb.x).toBeGreaterThanOrEqual(-0.5);
  expect(mb.x + mb.width).toBeLessThanOrEqual(viewport.width + 0.5);
  expect(mb.width).toBeGreaterThanOrEqual(tb.width - 0.5);
});
