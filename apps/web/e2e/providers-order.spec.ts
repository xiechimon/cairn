import { expect, type Page, test } from '@playwright/test';
import type { DevinSubscriptionListEntry } from '@cairn/shared';
import { mockLive } from './chief-home-mock';

const NOW = Date.now();

const DEVIN: DevinSubscriptionListEntry = {
  id: 'sub-d1',
  kind: 'devin-subscription',
  label: 'Devin 订阅',
  expiresAt: null,
  createdAt: NOW - 86_400_000,
  lastUsedAt: null,
  stepsLast24h: 0,
  models: [],
};

const provider = (id: string, label: string) => ({
  id,
  providerId: label,
  label,
  kind: 'custom',
  baseUrl: 'http://127.0.0.1:8798/v1',
  api: 'openai-completions',
  models: [{ id: 'glm', name: 'glm' }],
});

const names = (page: Page) =>
  page.getByTestId('provider-instance').evaluateAll((rows) =>
    rows.map((row) => row.getAttribute('data-instance-id')),
  );

function mount(page: Page, saved: string[][], failSave = false) {
  let order: string[] | null = null;
  return mockLive(page, { threads: [], messages: [] }, (path, route, json) => {
    if (path === '/api/teams/t1/devin-subscriptions') return json([DEVIN]);
    if (path === '/api/teams/t1/claude-subscriptions') return json([]);
    if (path === '/api/teams/t1/antigravity-subscriptions') return json([]);
    if (path === '/api/teams/t1/model-sources') return json({ sources: [] });
    if (path === '/api/teams/t1/providers')
      return json({
        presets: [],
        providers: [provider('p-a', 'workbuddy'), provider('p-b', 'anthropic-max')],
        order,
      });
    if (path === '/api/teams/t1/provider-order' && route.request().method() === 'PUT') {
      const body = route.request().postDataJSON() as { order: string[] };
      saved.push(body.order);
      if (failSave) return route.fulfill({ status: 500, body: '{"error":"boom"}' });
      order = body.order;
      return json({ order });
    }
    return undefined;
  });
}

const DEFAULT = ['subscription:sub-d1', 'provider:p-a', 'provider:p-b'];

test('dragging a provider by its handle moves it and the order survives a reload', async ({
  page,
}) => {
  const saved: string[][] = [];
  await mount(page, saved);
  await page.goto('/app/resources/providers');
  await expect.poll(() => names(page)).toEqual(DEFAULT);

  const handle = page
    .locator('[data-instance-id="provider:p-b"]')
    .getByTestId('provider-drag-handle');
  await expect(handle).toHaveAccessibleName('拖动调整顺序：anthropic-max');
  const target = await page.locator('[data-instance-id="subscription:sub-d1"]').boundingBox();
  const from = await handle.boundingBox();
  if (target === null || from === null) throw new Error('rows not laid out');
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2, target.y + 4, { steps: 12 });
  await page.mouse.up();

  const moved = ['provider:p-b', 'subscription:sub-d1', 'provider:p-a'];
  await expect.poll(() => names(page)).toEqual(moved);
  expect(saved).toEqual([moved]);
  await page.reload();
  await expect.poll(() => names(page)).toEqual(moved);
});

test('the keyboard moves a provider with Space and the arrow keys', async ({ page }) => {
  const saved: string[][] = [];
  await mount(page, saved);
  await page.goto('/app/resources/providers');
  await expect.poll(() => names(page)).toEqual(DEFAULT);

  await page
    .locator('[data-instance-id="subscription:sub-d1"]')
    .getByTestId('provider-drag-handle')
    .focus();
  await page.keyboard.press('Space');
  await expect(page.locator('[data-dragging="true"]')).toHaveCount(1);
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('[data-instance-id="provider:p-a"]')).toHaveAttribute('style', /translate3d\(0px, -/);
  await page.keyboard.press('Space');

  const moved = ['provider:p-a', 'subscription:sub-d1', 'provider:p-b'];
  await expect.poll(() => names(page)).toEqual(moved);
  expect(saved).toEqual([moved]);
});

test('a failed save puts the previous order back and says so', async ({ page }) => {
  const saved: string[][] = [];
  await mount(page, saved, true);
  await page.goto('/app/resources/providers');
  await expect.poll(() => names(page)).toEqual(DEFAULT);

  await page
    .locator('[data-instance-id="provider:p-a"]')
    .getByTestId('provider-drag-handle')
    .focus();
  await page.keyboard.press('Space');
  await expect(page.locator('[data-dragging="true"]')).toHaveCount(1);
  await page.keyboard.press('ArrowUp');
  await expect(page.locator('[data-instance-id="subscription:sub-d1"]')).toHaveAttribute('style', /translate3d\(0px, [1-9]/);
  await page.keyboard.press('Space');

  await expect(page.getByText('顺序没能保存，已恢复原来的顺序。')).toBeVisible();
  await expect.poll(() => names(page)).toEqual(DEFAULT);
  expect(saved).toHaveLength(1);
});
