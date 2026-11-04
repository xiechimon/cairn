import { expect, test } from '@playwright/test';

test('focused w-full input: focus ring is not clipped by the dialog (ring-room invariant)', async ({ page }) => {
  await page.goto('/app/resources/machines/Kd8fG2hJ4mN9pQ1rStUvWx3?scenario=06');
  await page.getByRole('button', { name: '创建 Agent' }).click();
  const dlg = page.getByRole('dialog', { name: '创建 agent' });
  await expect(dlg).toBeVisible();
  const input = dlg.locator('#dlg-agent-name');

  await expect(input).toBeFocused();
  const m = await page.evaluate(() => {
    const el = document.querySelector('#dlg-agent-name');
    const body = document.querySelector('[data-testid="dialog-body"]');
    if (!el || !body) return null;
    const ir = el.getBoundingClientRect();
    const br = body.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const width = Number.parseFloat(cs.outlineWidth);
    const offset = Number.parseFloat(cs.outlineOffset);
    return {
      inputL: ir.left,
      inputR: ir.right,
      bodyL: br.left,
      bodyR: br.right,
      spread: width + offset,
    };
  });
  expect(m).not.toBeNull();

  expect(m!.inputL - m!.spread).toBeGreaterThanOrEqual(m!.bodyL);
  expect(m!.inputR + m!.spread).toBeLessThanOrEqual(m!.bodyR);
});
