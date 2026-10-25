import { expect, type Page, test } from '@playwright/test';
import { evidenceShot } from './evidence';

async function openAccept(page: Page) {
  await page.goto('/app?scenario=34');

  const dialog = page.getByRole('dialog', { name: '完成任务' });
  await expect(dialog).toBeVisible();
  // #656: the dialog enter animation (tw-animate-css zoom-in-95) scales the panel
  // from 0.95 — settle it so interior-geometry measures ride the laid-out box
  // (the same getAnimations().finished wait the drawer specs use).
  await dialog.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
  return dialog;
}

async function openProviderForm(page: Page) {
  await page.goto('/app/resources/providers?scenario=01');
  await page.getByRole('button', { name: '新建', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '添加模型服务' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: '自定义端点' }).click();
  await expect(dialog.locator('#dlg-provider-id')).toBeVisible();
  // #677 wired tw-animate-css: same enter-animation settle as openAccept so
  // evidence shots and geometry never ride a transient scale.
  await dialog.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
  return dialog;
}

test('accept: native input renders with the official mask (no Mac checkbox painted)', async ({ page }) => {
  const dialog = await openAccept(page);
  const input = dialog.locator('input[type="checkbox"]');
  await expect(input).toBeChecked();

  const box = await input.boundingBox();
  expect(box).not.toBeNull();
  if (box == null) return;
  expect(box.width).toBeLessThanOrEqual(1);
  expect(box.height).toBeLessThanOrEqual(1);
  await expect(input).toHaveCSS('clip-path', 'inset(50%)');
  await evidenceShot(page, 'accept-checked.png');
});

test('accept: unchecked state shows no check', async ({ page }) => {
  const dialog = await openAccept(page);
  const input = dialog.locator('input[type="checkbox"]');
  const tile = dialog.locator('[data-slot="checkbox"]');
  await tile.click();
  await expect(input).not.toBeChecked();
  await expect(tile.locator('svg')).toHaveCount(0);
  await evidenceShot(page, 'accept-unchecked.png');
});

test('accept: whole row clickable (text is also a click target)', async ({ page }) => {
  const dialog = await openAccept(page);
  const input = dialog.locator('input[type="checkbox"]');
  const label = dialog.getByText('将改动合并到默认分支');
  await label.click();
  await expect(input).not.toBeChecked();
  await label.click();
  await expect(input).toBeChecked();
});

test('accept: box geometry = 16×16 / radius 4px / gap to text 8 / text 13.5px', async ({
  page,
}) => {
  const dialog = await openAccept(page);
  const tile = dialog.locator('[data-slot="checkbox"]');
  const box = await tile.boundingBox();
  expect(box).not.toBeNull();
  if (box == null) return;
  expect(box.width).toBeGreaterThan(15.5);
  expect(box.width).toBeLessThan(16.5);
  expect(box.height).toBeGreaterThan(15.5);
  expect(box.height).toBeLessThan(16.5);
  await expect(tile).toHaveCSS('border-radius', '4px');
  const label = dialog.getByText('将改动合并到默认分支');
  await expect(label).toHaveCSS('font-size', '13.5px');
  const lb = await label.boundingBox();
  expect(lb).not.toBeNull();
  if (lb == null) return;
  const gap = lb.x - (box.x + box.width);
  expect(gap).toBeGreaterThan(7.5);
  expect(gap).toBeLessThan(8.5);
});

test('provider: unchecked state shows no white check (#dlg-provider-authheader id survives)', async ({
  page,
}) => {
  const dialog = await openProviderForm(page);
  const input = dialog.locator('#dlg-provider-authheader');
  await expect(input).toBeChecked();
  await evidenceShot(page, 'provider-checked.png');

  await dialog.locator('[data-slot="checkbox"]').click();
  await expect(input).not.toBeChecked();
  await expect(dialog.locator('[data-slot="checkbox"] svg')).toHaveCount(0);
  await evidenceShot(page, 'provider-unchecked.png');
});

test('accept: Space toggles with focus on the Root itself', async ({ page }) => {
  const dialog = await openAccept(page);
  const input = dialog.locator('input[type="checkbox"]');
  const tile = dialog.locator('[data-slot="checkbox"]');
  await tile.focus();
  await page.keyboard.press('Space');
  await expect(input).not.toBeChecked();
  await page.keyboard.press('Space');
  await expect(input).toBeChecked();
});
