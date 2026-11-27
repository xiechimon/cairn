import { expect, type Page, test } from '@playwright/test';
import type { ClaudeSubscriptionListEntry, DevinSubscriptionListEntry } from '@cairn/shared';
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

function mount(
  page: Page,
  saved: string[][],
  failSave = false,
  options?: {
    devin?: DevinSubscriptionListEntry[];
    claude?: ClaudeSubscriptionListEntry[];
    initialOrder?: string[] | null;
  },
) {
  let order: string[] | null = options?.initialOrder ?? null;
  return mockLive(page, { threads: [], messages: [] }, (path, route, json) => {
    if (path === '/api/teams/t1/devin-subscriptions') return json(options?.devin ?? [DEVIN]);
    if (path === '/api/teams/t1/claude-subscriptions') return json(options?.claude ?? []);
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

test('dragging a provider row moves it and the order survives a reload', async ({ page }) => {
  const saved: string[][] = [];
  await mount(page, saved);
  await page.goto('/app/resources/providers');
  await expect.poll(() => names(page)).toEqual(DEFAULT);

  const target = await page.locator('[data-instance-id="subscription:sub-d1"]').boundingBox();
  const from = await page.locator('[data-instance-id="provider:p-b"]').boundingBox();
  if (target === null || from === null) throw new Error('rows not laid out');
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + 400, target.y - 300, { steps: 12 });
  const held = await page.locator('[data-instance-id="provider:p-b"]').boundingBox();
  expect(held?.x ?? 0, 'the dragged row stays in its column').toBeCloseTo(from.x, 0);
  expect(held?.y ?? 0, 'the dragged row stops at the top of the list').toBeCloseTo(target.y, 0);
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
    .locator('button')
    .first()
    .focus();
  await page.keyboard.press('Space');
  await expect(page.locator('[data-dragging="true"]')).toHaveCount(1);
  const dragged = page.locator('[data-instance-id="provider:p-a"]');
  await expect
    .poll(async () => {
      await page.keyboard.press('ArrowDown');
      return dragged.getAttribute('style');
    })
    .toMatch(/translate3d\(0px, -/);
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
    .locator('button')
    .first()
    .focus();
  await page.keyboard.press('Space');
  await expect(page.locator('[data-dragging="true"]')).toHaveCount(1);
  const shifted = page.locator('[data-instance-id="subscription:sub-d1"]');
  await expect
    .poll(async () => {
      await page.keyboard.press('ArrowUp');
      return shifted.getAttribute('style');
    })
    .toMatch(/translate3d\(0px, [1-9]/);
  await page.keyboard.press('Space');

  await expect(page.getByText('顺序未能保存，已恢复原来的顺序。')).toBeVisible();
  await expect.poll(() => names(page)).toEqual(DEFAULT);
  expect(saved).toHaveLength(1);
});

test('A10: hovering or focusing a provider row adds no move buttons and leaves quota and status unobstructed', async ({
  page,
}) => {
  const saved: string[][] = [];
  const claude: ClaudeSubscriptionListEntry = {
    id: 'sub-claude',
    kind: 'claude-subscription',
    label: 'Claude 订阅',
    expiresAt: null,
    createdAt: NOW - 86_400_000,
    windows: [{ name: 'billing_period', utilization: 0.3, resetsAt: null, observedAt: NOW }],
    lastUsedAt: null,
    stepsLast24h: 0,
  };
  await mount(page, saved, false, {
    devin: [],
    claude: [claude],
    initialOrder: ['provider:p-a', 'subscription:sub-claude', 'provider:p-b'],
  });
  await page.goto('/app/settings/routing');

  const row = page.locator('[data-instance-id="subscription:sub-claude"]');
  await expect(row.getByTestId('subscription-quota-mini')).toHaveText('剩 70%');
  await expect(row.getByTestId('provider-status-mark')).toBeVisible();

  await row.hover();
  await expect(row.getByTestId('sortable-move-up')).toHaveCount(0);
  await expect(row.getByTestId('sortable-move-down')).toHaveCount(0);
  await expect(row.getByTestId('subscription-quota-mini')).toBeVisible();
  await expect(row.getByTestId('provider-status-mark')).toBeVisible();
  const overflow = await row.evaluate((el) => el.scrollWidth > el.clientWidth + 1);
  expect(overflow).toBe(false);

  const rowButton = row.locator('button').first();
  await rowButton.focus();
  await page.keyboard.press('Space');
  await expect(page.locator('[data-dragging="true"]')).toHaveCount(1);
  const shifted = page.locator('[data-instance-id="provider:p-a"]');
  await expect
    .poll(async () => {
      await page.keyboard.press('ArrowUp');
      return shifted.getAttribute('style');
    })
    .toMatch(/translate3d\(0px, [1-9]/);
  await page.keyboard.press('Space');

  const moved = ['subscription:sub-claude', 'provider:p-a', 'provider:p-b'];
  await expect.poll(() => names(page)).toEqual(moved);
  expect(saved).toEqual([moved]);
  await page.reload();
  await expect.poll(() => names(page)).toEqual(moved);
});
