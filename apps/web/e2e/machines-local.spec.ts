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
  await expect(first).toHaveAttribute('data-expanded', 'true');
  await expect(first.getByText(LOCAL_NAME)).toHaveText(LOCAL_NAME);
  await expect(page.locator(PANE)).toHaveAttribute('data-machine-id', LOCAL_ID);
});

test('managed facade row removed (spec 11 A8 negative)', async ({ page }) => {
  await page.goto(MACHINES);
  await expect(page.locator(`${ITEM}[data-kind="local"]`)).toBeVisible();
  await expect(page.getByTestId('settings-content')).not.toContainText('Cairn 托管执行机');
});

test('runtimes are labelled rows without switches, monochrome, showing what the Runner detected', async ({ page }) => {
  await page.goto(`${MACHINES}&machine=${LOCAL_ID}`);
  const pi = page.locator(`${PANE} [data-runtime="pi"]`);
  const cc = page.locator(`${PANE} [data-runtime="claude-code"]`);
  const gemini = page.locator(`${PANE} [data-runtime="gemini"]`);
  await expect(pi).toBeVisible();
  await expect(cc).toBeVisible();
  await expect(pi).toContainText('pi');
  await expect(cc).toContainText('Claude Code');
  await expect(pi).toHaveAttribute('data-available', 'true');
  await expect(cc).toHaveAttribute('data-available', 'false');
  await expect(pi.getByTestId('provider-availability')).toHaveText('可用');
  await expect(cc.getByTestId('provider-availability')).toHaveText('没有检测到，装好后重启执行机');
  await expect(gemini.getByTestId('provider-availability')).toHaveText('接入命令闸前不能用');
  await expect(page.locator(`${PANE} [data-testid="machine-runtimes"] [role="switch"]`)).toHaveCount(0);
  await expect(page.locator(`${PANE} svg[fill^="#"], ${PANE} [data-runtime] svg path[fill^="#"]`)).toHaveCount(0);
});

test('no remote-shell switch (#1796)', async ({ page }) => {
  await page.goto(`${MACHINES}&machine=${LOCAL_ID}`);
  await expect(page.locator(PANE)).not.toContainText('远程 shell');
  await expect(page.locator(PANE)).not.toContainText('Remote shell');
  await expect(page.locator(`${PANE} [data-machine-col="shell"]`)).toHaveCount(0);
  await expect(page.locator(`${PANE} button[aria-label^="并发上限"]`)).toHaveCount(0);
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

test('a row header expands the machine and keeps the scenario query (#1259)', async ({ page }) => {
  await page.goto(MACHINES);
  await expect(page.locator(`${ITEM}[data-kind="local"]`)).toBeVisible();
  const remote = page.locator(ITEM).filter({ hasText: 'mea-wsl' });
  await remote.getByTestId('machine-toggle').click();
  await expect(page).toHaveURL(/scenario=06/);
  await expect(page).toHaveURL(/machine=Kd8fG2hJ4mN9pQ1rStUvWx3/);
  await expect(remote).toHaveAttribute('data-expanded', 'true');
});

test('collapsed rows keep one density: every item the same height', async ({ page }) => {
  await page.goto(MACHINES);
  await expect(page.locator(ITEM).first()).toBeVisible();
  const heights = await page
    .locator(ITEM)
    .evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().height)));
  expect(Math.max(...heights) - Math.min(...heights)).toBeLessThanOrEqual(1);
});
