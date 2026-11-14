import { expect, test } from '@playwright/test';

const CHIEF_STATE = '/app/settings/machines?scenario=machines-chief-state';
const CANON = '/app/settings/machines?scenario=06';
const SHELL = '[data-testid="settings-content"]';
const ITEM = '[data-testid="machine-item"]';
const PANE = '[data-testid="machine-detail"]';

test('chief host tag: a quiet text tag on the host list item (data-orchestration=host + copy)', async ({ page }) => {
  await page.goto(CHIEF_STATE);
  const host = page.locator(`${ITEM}[data-kind="local"]`).locator('[data-orchestration="host"]');
  await expect(host).toHaveText('Coordinator 主机');
  await expect(page.locator(`${SHELL} [data-orchestration="host"]`)).toHaveCount(1);
});

test('chief mid-turn: running status in the detail of the online remote', async ({ page }) => {
  await page.goto(CHIEF_STATE);
  await page.locator(ITEM).filter({ hasText: 'mea-wsl' }).getByTestId('machine-toggle').click();
  await expect(page.locator(`${PANE} [data-orchestration="running"]`)).toHaveText(
    'Coordinator 回合进行中',
  );
});

test('chief waiting for a machine: waiting status in the detail of the offline remote, next to the offline state', async ({ page }) => {
  await page.goto(CHIEF_STATE);
  await page.locator(ITEM).filter({ hasText: 'vps-relay' }).getByTestId('machine-toggle').click();
  await expect(page.locator(`${PANE} [data-orchestration="waiting"]`)).toHaveText(
    'Coordinator 等待 Runner',
  );
  await expect(page.locator(ITEM).filter({ hasText: 'vps-relay' }).getByTestId('machine-item-status')).toHaveText('离线');
});

test('read state zero controls: the role annotations are plain text, no buttons or menus', async ({ page }) => {
  await page.goto(CHIEF_STATE);
  await expect(page.locator(`${SHELL} [data-orchestration]`).first()).toBeVisible();
  await expect(page.locator(`${SHELL} [data-orchestration] button`)).toHaveCount(0);
  await expect(page.locator(`${SHELL} [data-orchestration] [role="menu"]`)).toHaveCount(0);
  await expect(page.locator(`${SHELL} [data-orchestration][role="button"]`)).toHaveCount(0);
});

test('legacy zero drift: no annotation data (06 canon face) grows no annotation nodes', async ({ page }) => {
  await page.goto(CANON);
  await expect(page.locator(ITEM).first()).toBeVisible();
  await expect(page.locator(`${SHELL} [data-orchestration]`)).toHaveCount(0);
});
