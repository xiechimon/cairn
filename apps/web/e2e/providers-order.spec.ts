import { expect, type Locator, type Page, test } from '@playwright/test';
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

test('A10: single-pointer move buttons reorder providers without dragging (WCAG 2.5.7)', async ({
  page,
}) => {
  const saved: string[][] = [];
  await mount(page, saved);
  await page.goto('/app/resources/providers');
  await expect.poll(() => names(page)).toEqual(DEFAULT);

  const firstRow = page.locator('[data-instance-id="subscription:sub-d1"]');
  const firstRowDown = firstRow.getByTestId('sortable-move-down');
  await expect(firstRowDown).toHaveCSS('pointer-events', 'none');
  await firstRow.hover();
  await expect(firstRowDown).toHaveCSS('pointer-events', 'auto');
  await firstRowDown.click();
  const movedDown = ['provider:p-a', 'subscription:sub-d1', 'provider:p-b'];
  await expect.poll(() => names(page)).toEqual(movedDown);
  expect(saved).toEqual([movedDown]);

  const thirdRow = page.locator('[data-instance-id="provider:p-b"]');
  await thirdRow.hover();
  await thirdRow.getByTestId('sortable-move-up').click();
  const movedUp = ['provider:p-a', 'provider:p-b', 'subscription:sub-d1'];
  await expect.poll(() => names(page)).toEqual(movedUp);

  const secondRowMoveUp = page
    .locator('[data-instance-id="provider:p-b"]')
    .getByTestId('sortable-move-up');
  await secondRowMoveUp.focus();
  await secondRowMoveUp.press('Enter');
  const toTop = ['provider:p-b', 'provider:p-a', 'subscription:sub-d1'];
  await expect.poll(() => names(page)).toEqual(toTop);
  await expect(
    page.locator('[data-instance-id="provider:p-b"]').getByTestId('sortable-move-down'),
    'keyboard move to first row preserves focus on the row move control',
  ).toBeFocused();

  await page.reload();
  await expect.poll(() => names(page)).toEqual(toTop);
});

async function assertNoMoveButtonOverlap(row: Locator, label: string) {
  const report = await row.evaluate((rowEl) => {
    const rowRect = rowEl.getBoundingClientRect();
    const up = rowEl.querySelector('[data-testid="sortable-move-up"]');
    const down = rowEl.querySelector('[data-testid="sortable-move-down"]');
    const quota = rowEl.querySelector('[data-testid="subscription-quota-mini"]');
    const status = rowEl.querySelector('[data-testid="provider-status-mark"]');
    const issues: string[] = [];
    if (!(up instanceof HTMLElement) || !(down instanceof HTMLElement)) {
      return { issues: ['missing move buttons'] };
    }
    if (!(quota instanceof HTMLElement) || !(status instanceof HTMLElement)) {
      return { issues: ['missing quota or status element'] };
    }
    for (const [name, el] of [
      ['quota', quota],
      ['status', status],
    ] as const) {
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      if (
        rect.width <= 0 ||
        rect.height <= 0 ||
        style.visibility === 'hidden' ||
        Number(style.opacity) === 0
      ) {
        issues.push(`${name} is not visible`);
      }
    }
    const moveWrapper = up.parentElement;
    const moveBtns = [
      ['sortable-move-up', up],
      ['sortable-move-down', down],
    ] as const;
    for (const [key, btn] of moveBtns) {
      const rect = btn.getBoundingClientRect();
      const style = getComputedStyle(btn);
      if (style.pointerEvents !== 'auto') {
        issues.push(`${key} pointer-events=${style.pointerEvents}`);
      }
      if (rect.width < 23.5 || rect.height < 23.5) {
        issues.push(`${key} too small: ${Math.round(rect.width)}x${Math.round(rect.height)}`);
      }
      if (rect.left < rowRect.left - 0.5 || rect.right > rowRect.right + 0.5) {
        issues.push(
          `${key} out of row bounds (${Math.round(rect.left)}..${Math.round(rect.right)} vs ${Math.round(rowRect.left)}..${Math.round(rowRect.right)})`,
        );
      }
    }
    const contentBoxes: Array<{ label: string; rect: DOMRect }> = [];
    const walker = document.createTreeWalker(rowEl, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node !== null) {
      const text = node.textContent?.trim() ?? '';
      if (text.length > 0 && (moveWrapper === null || !moveWrapper.contains(node))) {
        const range = document.createRange();
        range.selectNodeContents(node);
        for (const rect of range.getClientRects()) {
          if (rect.width > 0.5 && rect.height > 0.5) {
            contentBoxes.push({ label: `text:${text}`, rect });
          }
        }
      }
      node = walker.nextNode();
    }
    for (const el of rowEl.querySelectorAll('svg, [role="img"]')) {
      if (moveWrapper !== null && moveWrapper.contains(el)) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width > 0.5 && rect.height > 0.5) {
        const name =
          el.getAttribute('data-testid') ?? el.getAttribute('aria-label') ?? el.tagName.toLowerCase();
        contentBoxes.push({ label: `icon:${name}`, rect });
      }
    }
    for (const [key, btn] of moveBtns) {
      const a = btn.getBoundingClientRect();
      for (const item of contentBoxes) {
        const b = item.rect;
        if (
          a.left < b.right - 0.5 &&
          a.right > b.left + 0.5 &&
          a.top < b.bottom - 0.5 &&
          a.bottom > b.top + 0.5
        ) {
          issues.push(
            `${key}(${Math.round(a.left)}..${Math.round(a.right)},${Math.round(a.top)}..${Math.round(a.bottom)}) overlaps ${item.label}(${Math.round(b.left)}..${Math.round(b.right)},${Math.round(b.top)}..${Math.round(b.bottom)})`,
          );
        }
      }
    }
    if (rowEl.scrollWidth > rowEl.clientWidth + 1) {
      issues.push(`row overflows horizontally (${rowEl.scrollWidth} > ${rowEl.clientWidth})`);
    }
    return { issues };
  });
  expect(report.issues, label).toEqual([]);
}

test('A10: hover and focus-revealed move buttons do not overlap quota text or status icons', async ({
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
  await assertNoMoveButtonOverlap(row, 'unselected hover');

  await page.mouse.move(0, 0);
  await row.getByTestId('sortable-move-up').focus();
  await assertNoMoveButtonOverlap(row, 'keyboard focus');

  await row.getByRole('button').first().click();
  await expect(row).toHaveAttribute('aria-current', 'true');
  await row.hover();
  await assertNoMoveButtonOverlap(row, 'selected hover');

  await row.evaluate((el) => {
    const active = document.activeElement;
    if (active instanceof HTMLElement && el.contains(active)) active.blur();
  });
  await page.mouse.move(0, 0);
  await expect(row.getByTestId('sortable-move-up')).toHaveCSS('pointer-events', 'none');
  const idleWrapperWidth = await row
    .getByTestId('sortable-move-up')
    .evaluate((btn) => btn.parentElement?.getBoundingClientRect().width ?? -1);
  expect(idleWrapperWidth, 'C3: collapsed hover controls take 0px width at rest').toBeLessThanOrEqual(
    0.5,
  );
});
