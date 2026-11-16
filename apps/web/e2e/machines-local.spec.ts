import { expect, test } from '@playwright/test';

const MACHINES = '/app/settings/machines?scenario=06';
const ITEM = '[data-testid="machine-item"]';
const PANE = '[data-testid="machine-detail"]';

const LOCAL_NAME = 'xmonsMac-3574.local';
const LOCAL_ID = 'TlZ2sSD4EJCxjNJqVhdo_';

test('local machine pinned first: data-kind=local + id handle + hostname canon', async ({ page }) => {
  await page.goto(`${MACHINES}&machine=${LOCAL_ID}`);
  const first = page.locator(ITEM).first();
  await expect(first).toBeVisible();
  await expect(first).toHaveAttribute('data-kind', 'local');
  await expect(first).toHaveAttribute('data-machine-id', LOCAL_ID);
  await expect(first.getByText(LOCAL_NAME)).toHaveText(LOCAL_NAME);
  await expect(page.locator(PANE)).toHaveCount(0);
});

test('managed facade row removed (spec 11 A8 negative)', async ({ page }) => {
  await page.goto(MACHINES);
  await expect(page.locator(`${ITEM}[data-kind="local"]`)).toBeVisible();
  await expect(page.getByTestId('settings-content')).not.toContainText('Cairn 托管执行机');
});

test('local machine can be migrated or deleted only through its menu, and the row has no switch', async ({ page }) => {
  await page.goto(MACHINES);
  const local = page.locator(`${ITEM}[data-kind="local"]`);
  await expect(local).toBeVisible();
  await expect(local.getByRole('switch')).toHaveCount(0);
  await local.getByTestId('machine-menu').click();
  await expect(page.getByTestId('machine-menu-evacuate')).toBeVisible();
  await expect(page.getByTestId('machine-menu-delete')).toBeVisible();
});

test('machine rows keep one density: every item the same height', async ({ page }) => {
  await page.goto(MACHINES);
  await expect(page.locator(ITEM).first()).toBeVisible();
  const heights = await page
    .locator(ITEM)
    .evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().height)));
  expect(Math.max(...heights) - Math.min(...heights)).toBeLessThanOrEqual(1);
});
