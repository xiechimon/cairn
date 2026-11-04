import { expect, test } from '@playwright/test';

const CHIEF_STATE = '/app/resources/machines?scenario=machines-chief-state';
const CANON = '/app/resources/machines?scenario=06';
const SHELL = '[data-route="/app/resources/machines"]';
const ROW = `${SHELL} div[data-kind]`;
const HOST_ROW = `${ROW}[data-kind="local"]`;
const ORCH = `${ROW} [data-orchestration]`;

test('chief host badge: pinned on the host row (data-orchestration=host + copy)', async ({ page }) => {
  await page.goto(CHIEF_STATE);
  const host = page.locator(HOST_ROW).locator('[data-orchestration="host"]');
  await expect(host).toHaveText('总管主机');

  await expect(page.locator(`${ROW} [data-orchestration="host"]`)).toHaveCount(1);
});

test('chief mid-turn: running status row on the online remote row', async ({ page }) => {
  await page.goto(CHIEF_STATE);
  const running = page.locator(ROW).filter({ hasText: 'mea-wsl' }).locator('[data-orchestration="running"]');
  await expect(running).toHaveText('总管回合进行中');
});

test('chief waiting for a machine: waiting status row on the offline remote row (coexists orthogonally with the offline grey dot)', async ({ page }) => {
  await page.goto(CHIEF_STATE);
  const row = page.locator(ROW).filter({ hasText: 'vps-relay' });
  const waiting = row.locator('[data-orchestration="waiting"]');
  await expect(waiting).toHaveText('总管等待机器');

  await expect(row.locator('[data-on]')).toHaveAttribute('data-on', 'false');
});

test('read state zero controls: zero button / zero menu semantics inside the annotation container (dead-button discipline holds)', async ({ page }) => {
  await page.goto(CHIEF_STATE);
  await expect(page.locator(ORCH).first()).toBeVisible();
  await expect(page.locator(`${ORCH} button`)).toHaveCount(0);
  await expect(page.locator(`${ORCH} [role="menu"]`)).toHaveCount(0);

  await expect(page.locator(`${SHELL} [data-orchestration][role="button"]`)).toHaveCount(0);

  await expect(page.locator(`${ROW} [role="switch"]`)).toHaveCount(0);
});

test('legacy zero drift: no annotation data (06 canon face) grows no annotation nodes', async ({ page }) => {
  await page.goto(CANON);
  await expect(page.locator(ROW).first()).toBeVisible();
  await expect(page.locator(`${SHELL} [data-orchestration]`)).toHaveCount(0);
});

test('row-height contract holds: annotation rows do not break the Paper settings row height (52 per row, divider included)', async ({ page }) => {
  await page.goto(CHIEF_STATE);
  const rows = page.locator(ROW);
  await expect(rows).toHaveCount(3);
  const heights = await rows.evaluateAll((els) =>
    els.map((el) => el.getBoundingClientRect().height),
  );
  expect(heights).toEqual([52, 52, 52]);
});
