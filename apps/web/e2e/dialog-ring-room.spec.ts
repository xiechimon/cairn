import { expect, test } from '@playwright/test';

test('focused w-full input: focus ring is not clipped by the dialog (ring-room invariant)', async ({ page }) => {
  await page.goto('/app/resources/skills?scenario=01');
  await page.getByTestId('resource-empty').getByRole('button', { name: '新建技能' }).click();
  const dlg = page.getByRole('dialog', { name: '新建技能' });
  await expect(dlg).toBeVisible();
  const input = dlg.locator('#dlg-skill-name');
  await input.focus();
  await expect(input).toBeFocused();
  const m = await page.evaluate(() => {
    const el = document.querySelector('#dlg-skill-name');
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
