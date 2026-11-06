import { expect, test } from '@playwright/test';

const MACHINES = '/app/settings/machines?scenario=06';
const ITEM = '[data-testid="machine-item"]';
const PANE = '[data-testid="machine-detail"]';

const LOCAL_NAME = 'xmonsMac-3574.local';
const LOCAL_ID = 'TlZ2sSD4EJCxjNJqVhdo_';

test('local machine pinned first and selected: data-kind=local + id handle + hostname canon', async ({ page }) => {
  await page.goto(MACHINES);
  const first = page.locator(ITEM).first();
  await expect(first).toBeVisible();
  await expect(first).toHaveAttribute('data-kind', 'local');
  await expect(first).toHaveAttribute('data-machine-id', LOCAL_ID);
  await expect(first).toHaveAttribute('aria-current', 'true');
  await expect(first.getByText(LOCAL_NAME)).toHaveText(LOCAL_NAME);
  await expect(page.locator(PANE)).toHaveAttribute('data-machine-id', LOCAL_ID);
});

test('managed facade row removed (spec 11 A8 negative)', async ({ page }) => {
  await page.goto(MACHINES);
  await expect(page.locator(`${ITEM}[data-kind="local"]`)).toBeVisible();
  await expect(page.getByTestId('settings-content')).not.toContainText('Cairn 托管机器');
});

test('runtimes are labelled rows with a switch each, monochrome, enabled state from enabledRuntimes', async ({ page }) => {
  await page.goto(MACHINES);
  const pi = page.locator(`${PANE} [data-runtime="pi"]`);
  const cc = page.locator(`${PANE} [data-runtime="claude-code"]`);
  await expect(pi).toBeVisible();
  await expect(cc).toBeVisible();
  await expect(pi).toContainText('pi');
  await expect(cc).toContainText('Claude Code');
  await expect(pi).toHaveAttribute('data-enabled', 'true');
  await expect(cc).toHaveAttribute('data-enabled', 'false');
  await expect(pi.getByRole('switch')).toBeChecked();
  await expect(cc.getByRole('switch')).not.toBeChecked();
  await expect(page.locator(`${PANE} svg[fill^="#"], ${PANE} [data-runtime] svg path[fill^="#"]`)).toHaveCount(0);
});

test('concurrency is a labelled control in the capacity section; no remote-shell switch (#1796)', async ({ page }) => {
  await page.goto(MACHINES);
  await expect(page.locator(PANE)).not.toContainText('远程 shell');
  await expect(page.locator(PANE)).not.toContainText('Remote shell');
  await expect(page.locator(`${PANE} [data-machine-col="shell"]`)).toHaveCount(0);
  await expect(page.locator(`${PANE} button[aria-label^="并发上限"]`)).toHaveCount(1);
});

test('local machine not deletable from its list item: no delete-class control in the list (negative)', async ({ page }) => {
  await page.goto(MACHINES);
  await expect(page.locator(`${ITEM}[data-kind="local"]`)).toBeVisible();
  await expect(page.getByTestId('machine-list').locator('button')).toHaveCount(0);
  await expect(page.getByTestId('machine-list').locator('[aria-haspopup="menu"]')).toHaveCount(0);
});

test('list item is a link that selects the machine and keeps the scenario query (#1259)', async ({ page }) => {
  await page.goto(MACHINES);
  await expect(page.locator(`${ITEM}[data-kind="local"]`)).toBeVisible();
  await expect(page.locator(`${ITEM}[role="button"]`)).toHaveCount(0);
  const remote = page.locator(ITEM).filter({ hasText: 'mea-wsl' });
  await expect(remote).toHaveAttribute('href', /scenario=06/);
  await expect(remote).toHaveAttribute('href', /machine=Kd8fG2hJ4mN9pQ1rStUvWx3/);
});

test('list rows keep one density: every item the same height', async ({ page }) => {
  await page.goto(MACHINES);
  await expect(page.locator(ITEM).first()).toBeVisible();
  const heights = await page
    .locator(ITEM)
    .evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().height)));
  expect(Math.max(...heights) - Math.min(...heights)).toBeLessThanOrEqual(1);
});
