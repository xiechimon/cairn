import { expect, type Locator, type Page, test } from '@playwright/test';
import type { ClaudeSubscriptionListEntry } from '@cairn/shared';
import { mockLive } from './chief-home-mock';

test.use({ viewport: { width: 800, height: 500 } });

const CAP = 500 - 48;

async function expectShellCapped(dialog: Locator) {
  const box = await dialog.boundingBox();
  expect(box).not.toBeNull();
  if (box == null) return;
  expect(box.height).toBeLessThanOrEqual(CAP + 0.5);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(500.5);
}

async function expectBodyOverflows(dialog: Locator) {
  const size = await dialog
    .getByTestId('dialog-body')
    .evaluate((el) => ({ scroll: el.scrollHeight, client: el.clientHeight }));
  expect(size.scroll).toBeGreaterThan(size.client);
}

test('provider: 3 model chips overflow the body, submit pinned to the bottom and does not move on scroll', async ({ page }) => {
  await page.goto('/app/resources/providers?scenario=01');
  await page.getByTestId('routing-add-provider').click();
  const dialog = page.getByRole('dialog', { name: '添加服务商' });
  await expect(dialog).toBeVisible();

  await expectBodyOverflows(dialog);
  await expectShellCapped(dialog);

  await dialog.getByRole('button', { name: '自定义端点' }).click();
  for (const id of ['relay-a', 'relay-b', 'relay-c']) {
    await dialog.getByRole('button', { name: '添加模型', exact: true }).click();
    await page.getByLabel('搜索模型或输入 ID').fill(id);
    await page.keyboard.press('Enter');
  }
  await expect(dialog.locator('[data-model-chip]')).toHaveCount(3);
  await expectBodyOverflows(dialog);
  await expectShellCapped(dialog);
  const submit = dialog.getByRole('button', { name: '添加服务商' });
  await expect(submit).toBeInViewport();

  const before = await submit.boundingBox();
  await dialog.getByTestId('dialog-body').evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  const after = await submit.boundingBox();
  expect(after).toEqual(before);
  await expect(submit).toBeInViewport();
});

test('C23: a retry that makes the dialog body scroll keeps both row edges and the click in place', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 732 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const model = {
    id: 'claude-sonnet-preview',
    name: 'Claude Sonnet extended context preview for long-running agent workloads',
  };
  const extra = Array.from({ length: 12 }, (_, index) => {
    const id = `claude-sonnet-preview-${index + 1}`;
    return { id, name: id };
  });
  const subscription: ClaudeSubscriptionListEntry = {
    id: 'subscription-1',
    kind: 'claude-subscription',
    label: 'Personal Claude',
    expiresAt: Date.now() + 300 * 24 * 60 * 60 * 1000,
    createdAt: Date.now(),
    models: null,
  };
  let calls = 0;
  const retry = Promise.withResolvers<void>();
  await mockLive(page, { threads: [], messages: [] }, (path, _route, json) => {
    if (path === '/api/teams/t1/model-sources') return json({ sources: [] });
    if (path === '/api/teams/t1/providers') return json({ presets: [], providers: [] });
    if (path === '/api/teams/t1/claude-subscriptions') return json([subscription]);
    if (path !== '/api/teams/t1/claude-subscriptions/subscription-1/upstream-models') return;
    if (++calls === 1) {
      return json({ status: 'fallback', failure: 'auth', httpStatus: 401, models: [model] });
    }
    return retry.promise.then(() => json({ status: 'ok', models: [model, ...extra] }));
  });
  await page.goto('/app/resources/providers');
  await page.addStyleTag({ content: '[data-testid="dialog-body"]::-webkit-scrollbar { width: 24px; }' });
  await page.getByTestId('subscription-detail').getByTestId('subscription-pick-upstream').click();
  const dialog = page.getByRole('dialog', { name: '从上游选择模型' });
  const body = dialog.getByTestId('dialog-body');
  const rows = body.getByTestId('upstream-model');
  const row = rows.and(body.locator(`[data-model-id="${model.id}"]`));
  const checkbox = row.getByRole('checkbox');
  const name = row.getByText(model.name, { exact: true });
  const edges = () => row.evaluate((el) => {
    const { x, right } = el.getBoundingClientRect();
    return { x, right };
  });

  await expect(checkbox).not.toBeChecked();
  await body.getByRole('button', { name: '重试' }).click();
  await expect(name).toBeInViewport();
  expect(await body.evaluate((el) => el.scrollHeight <= el.clientHeight)).toBe(true);
  const before = await edges();
  const hit = await name.evaluate((el) => {
    const { right, y, height } = el.getBoundingClientRect();
    return { x: right - 1, y: y + height / 2 };
  });
  expect(before.right - hit.x).toBeLessThan(24);
  await page.mouse.move(hit.x, hit.y);
  await page.mouse.down();
  retry.resolve();
  await expect(rows).toHaveCount(extra.length + 1);
  await expectBodyOverflows(dialog);
  expect(await body.evaluate((el) => el.offsetWidth - el.clientWidth)).toBe(24);
  const after = await edges();
  await page.mouse.up();
  expect(after).toEqual(before);
  await expect(checkbox).toBeChecked();
});

for (const anchor of ['visible row', 'pressed row with the manual field visible'] as const) {
  test(`C23: retry keeps the ${anchor} fixed when new models append`, async ({ page }) => {
    const pressing = anchor === 'pressed row with the manual field visible';
    if (pressing) await page.setViewportSize({ width: 568, height: 320 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const models = Array.from({ length: 16 }, (_, index) => ({
      id: `claude-preview-${index + 1}`,
      name: `Claude Preview ${index + 1}`,
    }));
    const extra = Array.from({ length: 12 }, (_, index) => ({
      id: `claude-extra-${index + 1}`,
      name: `Claude Extra ${index + 1}`,
    }));
    const subscription: ClaudeSubscriptionListEntry = {
      id: 'subscription-1',
      kind: 'claude-subscription',
      label: 'Personal Claude',
      expiresAt: Date.now() + 300 * 24 * 60 * 60 * 1000,
      createdAt: Date.now(),
      models: null,
    };
    let calls = 0;
    const retry = Promise.withResolvers<void>();
    await mockLive(page, { threads: [], messages: [] }, (path, _route, json) => {
      if (path === '/api/teams/t1/model-sources') return json({ sources: [] });
      if (path === '/api/teams/t1/providers') return json({ presets: [], providers: [] });
      if (path === '/api/teams/t1/claude-subscriptions') return json([subscription]);
      if (path !== '/api/teams/t1/claude-subscriptions/subscription-1/upstream-models') return;
      if (++calls === 1) {
        return json({ status: 'fallback', failure: 'auth', httpStatus: 401, models });
      }
      return retry.promise.then(() => json({ status: 'ok', models: [...models, ...extra] }));
    });
    await page.goto('/app/resources/providers');
    await page.getByTestId('subscription-detail').getByTestId('subscription-pick-upstream').click();
    const dialog = page.getByRole('dialog', { name: '从上游选择模型' });
    const body = dialog.getByTestId('dialog-body');
    const rows = body.getByTestId('upstream-model');
    const model = pressing ? models.at(-1)! : models[5]!;
    const row = body.locator(`[data-model-id="${model.id}"]`);
    const checkbox = row.getByRole('checkbox');
    const manual = body.getByRole('textbox', { name: '模型 ID', exact: true });
    await expect(rows).toHaveCount(models.length);
    await expectBodyOverflows(dialog);
    await body.getByRole('button', { name: '重试' }).click();
    if (pressing) {
      await manual.evaluate((field) => {
        const scroller = field.closest('[data-testid="dialog-body"]')!;
        scroller.scrollTop +=
          field.getBoundingClientRect().top - scroller.getBoundingClientRect().bottom + 16;
      });
      await row.getByText(model.name, { exact: true }).hover();
      await page.mouse.down();
      await expect(checkbox).not.toBeChecked();
      await expect(manual).toBeInViewport();
    } else {
      await row.scrollIntoViewIfNeeded();
    }
    await expect(row).toBeInViewport({ ratio: 1 });
    if (!pressing) await expect(manual).not.toBeInViewport();
    expect(await body.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    if (!pressing) await row.hover();
    const measureTop = () => row.evaluate((el) => el.getBoundingClientRect().top);
    const before = await measureTop();
    retry.resolve();
    await expect(rows).toHaveCount(models.length + extra.length);
    const after = await measureTop();
    if (pressing) await page.mouse.up();
    expect(after).toBe(before);
    await expect(row).toBeInViewport({ ratio: 1 });
    if (pressing) {
      await expect(checkbox).toBeChecked();
      await expect(rows.getByRole('checkbox', { checked: true })).toHaveCount(1);
    } else {
      await expect(body.locator('[data-model-id]:hover')).toHaveAttribute('data-model-id', model.id);
    }
  });
}

test('C23: retry does not anchor to a focused manual field when new models append', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const models = Array.from({ length: 16 }, (_, index) => ({
    id: `claude-preview-${index + 1}`,
    name: `Claude Preview ${index + 1}`,
  }));
  const extra = Array.from({ length: 12 }, (_, index) => ({
    id: `claude-extra-${index + 1}`,
    name: `Claude Extra ${index + 1}`,
  }));
  const subscription: ClaudeSubscriptionListEntry = {
    id: 'subscription-1',
    kind: 'claude-subscription',
    label: 'Personal Claude',
    expiresAt: Date.now() + 300 * 24 * 60 * 60 * 1000,
    createdAt: Date.now(),
    models: null,
  };
  let calls = 0;
  const retry = Promise.withResolvers<void>();
  await mockLive(page, { threads: [], messages: [] }, (path, _route, json) => {
    if (path === '/api/teams/t1/model-sources') return json({ sources: [] });
    if (path === '/api/teams/t1/providers') return json({ presets: [], providers: [] });
    if (path === '/api/teams/t1/claude-subscriptions') return json([subscription]);
    if (path !== '/api/teams/t1/claude-subscriptions/subscription-1/upstream-models') return;
    if (++calls === 1) {
      return json({ status: 'fallback', failure: 'auth', httpStatus: 401, models });
    }
    return retry.promise.then(() => json({ status: 'ok', models: [...models, ...extra] }));
  });
  await page.goto('/app/resources/providers');
  await page.getByTestId('subscription-detail').getByTestId('subscription-pick-upstream').click();
  const dialog = page.getByRole('dialog', { name: '从上游选择模型' });
  const body = dialog.getByTestId('dialog-body');
  const rows = body.getByTestId('upstream-model');
  const lastRow = body.locator(`[data-model-id="${models.at(-1)!.id}"]`);
  const manual = body.getByRole('textbox', { name: '模型 ID', exact: true });
  await expect(rows).toHaveCount(models.length);
  await expectBodyOverflows(dialog);
  await body.getByRole('button', { name: '重试' }).click();
  await manual.click();
  await expect(manual).toBeInViewport({ ratio: 1 });
  await expect(manual).toBeFocused();
  await expect(lastRow).toBeInViewport({ ratio: 1 });
  const beforeScrollTop = await body.evaluate((el) => el.scrollTop);
  expect(beforeScrollTop).toBeGreaterThan(0);
  const beforeRowTop = await lastRow.evaluate((el) => el.getBoundingClientRect().top);
  const beforeManualTop = await manual.evaluate((el) => el.getBoundingClientRect().top);

  retry.resolve();
  await expect(rows).toHaveCount(models.length + extra.length);
  expect(await body.evaluate((el) => el.scrollTop)).toBe(beforeScrollTop);
  expect(await lastRow.evaluate((el) => el.getBoundingClientRect().top)).toBe(beforeRowTop);
  expect(await manual.evaluate((el) => el.getBoundingClientRect().top)).toBeGreaterThan(beforeManualTop);
  await expect(manual).toBeFocused();
});

for (const opening of ['mouse', 'keyboard'] as const) {
  for (const userScrolled of [false, true]) {
    test(`C23: slow initial picker load opened by ${opening} ${userScrolled ? 'preserves user scrolling' : 'keeps the first row visible at scrollTop zero'}`, async ({ page }) => {
      await page.setViewportSize({ width: 568, height: 320 });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      const models = [
        { id: 'claude-sonnet', name: 'Claude Sonnet' },
        { id: 'claude-opus', name: 'Claude Opus' },
        { id: 'claude-haiku', name: 'Claude Haiku' },
      ];
      const subscription: ClaudeSubscriptionListEntry = {
        id: 'subscription-1',
        kind: 'claude-subscription',
        label: 'Personal Claude',
        expiresAt: null,
        createdAt: 0,
        models: [],
      };
      const requested = Promise.withResolvers<void>();
      const response = Promise.withResolvers<void>();
      await mockLive(page, { threads: [], messages: [] }, (path, _route, json) => {
        if (path === '/api/teams/t1/model-sources') return json({ sources: [] });
        if (path === '/api/teams/t1/providers') return json({ presets: [], providers: [] });
        if (path === '/api/teams/t1/claude-subscriptions') return json([subscription]);
        if (path !== '/api/teams/t1/claude-subscriptions/subscription-1/upstream-models') return;
        requested.resolve();
        return response.promise.then(() => json({ status: 'ok', models }));
      });
      await page.goto('/app/resources/providers');
      const trigger = page.getByTestId('subscription-detail').getByTestId('subscription-pick-upstream');
      if (opening === 'mouse') {
        await trigger.click();
      } else {
        await trigger.focus();
        await page.keyboard.press('Enter');
      }
      await requested.promise;
      const dialog = page.getByRole('dialog', { name: '从上游选择模型' });
      const body = dialog.getByTestId('dialog-body');
      const search = body.getByRole('textbox', { name: '搜索模型', exact: true });
      await expect(body.getByTestId('upstream-loading')).toBeVisible();
      await expect(search).toBeFocused();
      expect(await body.evaluate((el) => el.scrollTop)).toBe(0);
      const scrollTop = userScrolled ? 32 : 0;
      if (userScrolled) {
        await body.evaluate((el, offset) => { el.scrollTop = offset; }, scrollTop);
        expect(await body.evaluate((el) => el.scrollTop)).toBe(scrollTop);
      }
      await expect(body.getByRole('textbox', { name: '模型 ID', exact: true })).not.toBeInViewport();
      response.resolve();
      const rows = body.getByTestId('upstream-model');
      await expect(rows).toHaveCount(models.length);
      await expect(body.getByTestId('upstream-loading')).toHaveCount(0);
      await expect(search).toBeFocused();
      await body.evaluate(() => new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }));
      expect(await body.evaluate((el) => el.scrollTop)).toBe(scrollTop);
      if (!userScrolled) {
        const first = rows.first();
        await expect(first).toHaveAttribute('data-model-id', models[0]!.id);
        await expect(first).toBeInViewport();
        const bounds = await first.evaluate((el) => {
          const row = el.getBoundingClientRect();
          const body = el.closest('[data-testid="dialog-body"]')!.getBoundingClientRect();
          return { rowTop: row.top, rowBottom: row.bottom, bodyTop: body.top, bodyBottom: body.bottom };
        });
        expect(bounds.rowTop).toBeGreaterThanOrEqual(bounds.bodyTop);
        expect(bounds.rowTop).toBeLessThan(bounds.bodyBottom);
        expect(bounds.rowBottom).toBeGreaterThan(bounds.bodyTop);
      }
    });
  }
}

async function openNarrowUpstreamPicker(
  page: Page,
  models: Promise<{ id: string; name: string }[]>,
  selected: ClaudeSubscriptionListEntry['models'] = [],
) {
  await page.setViewportSize({ width: 568, height: 320 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const subscription: ClaudeSubscriptionListEntry = {
    id: 'subscription-1',
    kind: 'claude-subscription',
    label: 'Personal Claude',
    expiresAt: null,
    createdAt: 0,
    models: selected,
  };
  await mockLive(page, { threads: [], messages: [] }, (path, _route, json) => {
    if (path === '/api/teams/t1/model-sources') return json({ sources: [] });
    if (path === '/api/teams/t1/providers') return json({ presets: [], providers: [] });
    if (path === '/api/teams/t1/claude-subscriptions') return json([subscription]);
    if (path !== '/api/teams/t1/claude-subscriptions/subscription-1/upstream-models') return;
    return models.then((result) => json({ status: 'ok', models: result }));
  });
  await page.goto('/app/resources/providers');
  await page.getByTestId('subscription-detail').getByTestId('subscription-pick-upstream').click();
  return page.getByRole('dialog', { name: '从上游选择模型' }).getByTestId('dialog-body');
}

test('A1: adjacent upstream row edges hit only their own label in a narrow dialog', async ({ page }) => {
  const models = [
    { id: 'claude-sonnet', name: 'Claude Sonnet' },
    { id: 'claude-opus', name: 'Claude Opus' },
    { id: 'claude-haiku', name: 'Claude Haiku' },
  ];
  const body = await openNarrowUpstreamPicker(page, Promise.resolve(models));
  await expect(body.getByTestId('upstream-model')).toHaveCount(models.length);

  const hits = await body.evaluate((scroller) => {
    const rows = Array.from(scroller.querySelectorAll('[data-testid="upstream-model"]'));
    return rows.slice(1).flatMap((lower, index) => {
      const upper = rows[index]!;
      const viewport = scroller.getBoundingClientRect();
      scroller.scrollTop += lower.getBoundingClientRect().top - (viewport.top + viewport.height / 2);
      const edges = [{ row: upper, edge: 'bottom' }, { row: lower, edge: 'top' }] as const;
      return edges.map(({ row, edge }) => {
        const box = row.querySelector('[role="checkbox"]')!.getBoundingClientRect();
        const bounds = row.getBoundingClientRect();
        const y = edge === 'bottom' ? bounds.bottom - 1 : bounds.top + 1;
        const hit = document.elementFromPoint(box.left + box.width / 2, y);
        return { model: row.getAttribute('data-model-id'), edge, inside: row.contains(hit) };
      });
    });
  });
  expect(hits).toEqual(models.slice(1).flatMap((model, index) => [
    { model: models[index]!.id, edge: 'bottom', inside: true },
    { model: model.id, edge: 'top', inside: true },
  ]));
});

for (const [count, openingSelections] of [[0, 0], [1, 0], [1, 2], [30, 0]] as const) {
  test(`C23: ${count} returned models and ${openingSelections} opening selections keep scrollTop fixed without anchoring to the manual field`, async ({ page }) => {
    const response = Promise.withResolvers<{ id: string; name: string }[]>();
    const models = Array.from({ length: count }, (_, index) => ({
      id: `claude-preview-${index + 1}`,
      name: `Claude Preview ${index + 1}`,
    }));
    const selected = Array.from({ length: openingSelections }, (_, index) => ({
      id: `claude-local-${index + 1}`,
      name: `Claude Local ${index + 1}`,
    }));
    const body = await openNarrowUpstreamPicker(page, response.promise, selected);
    const loading = body.getByTestId('upstream-loading');
    const manual = body.getByRole('textbox', { name: '模型 ID', exact: true });
    await expect(loading).toBeVisible();
    await expect(body.getByTestId('upstream-model')).toHaveCount(openingSelections);
    await expect(body.getByRole('textbox', { name: '搜索模型', exact: true })).toBeFocused();
    await body.evaluate((el) => {
      el.scrollTop = el.scrollHeight - el.clientHeight - 8;
    });
    await expect(manual).toBeInViewport({ ratio: 1 });
    await manual.focus();
    const beforeScrollTop = await body.evaluate((el) => el.scrollTop);
    expect(beforeScrollTop).toBeGreaterThan(0);
    const beforeManualTop = await manual.evaluate((field) => field.getBoundingClientRect().top);
    const firstOpeningRow = openingSelections > 0 ? body.getByTestId('upstream-model').first() : null;
    const beforeRowTop = firstOpeningRow
      ? await firstOpeningRow.evaluate((el) => el.getBoundingClientRect().top)
      : null;

    response.resolve(models);
    await expect(loading).toHaveCount(0);
    await expect(body.getByTestId('upstream-model')).toHaveCount(count + openingSelections);
    await expect(body.getByTestId('upstream-group')).toHaveCount(
      Number(count > 0) + Number(openingSelections > 0),
    );
    expect(await body.evaluate((el) => el.scrollTop)).toBe(beforeScrollTop);
    if (firstOpeningRow && beforeRowTop !== null) {
      expect(await firstOpeningRow.evaluate((el) => el.getBoundingClientRect().top)).toBe(beforeRowTop);
    }
    if (count === 30) {
      expect(await manual.evaluate((field) => field.getBoundingClientRect().top)).toBeGreaterThan(beforeManualTop);
    }
  });
}

test('slow initial picker load shows a typed manual pick and lets the user uncheck it before settlement', async ({ page }) => {
  const response = Promise.withResolvers<{ id: string; name: string }[]>();
  const body = await openNarrowUpstreamPicker(page, response.promise);
  const dialog = page.getByRole('dialog', { name: '从上游选择模型' });
  const loading = body.getByTestId('upstream-loading');
  const manual = body.getByRole('textbox', { name: '模型 ID', exact: true });
  await expect(loading).toBeVisible();

  await manual.fill('custom-preview');
  await manual.press('Enter');
  await expect(loading).toBeVisible();
  const row = body.locator('[data-testid="upstream-model"][data-model-id="custom-preview"]');
  const checkbox = row.getByRole('checkbox');
  await expect(row).toBeVisible();
  await expect(checkbox).toBeChecked();
  await expect(dialog.getByTestId('dialog-foot')).toContainText('已选 1 个');

  await checkbox.click();
  await expect(checkbox).not.toBeChecked();
  await expect(dialog.getByTestId('dialog-foot')).toContainText('已选 0 个');
  await expect(loading).toBeVisible();

  await checkbox.click();
  await expect(checkbox).toBeChecked();
  await row.scrollIntoViewIfNeeded();
  const beforeTop = await row.evaluate((el) => el.getBoundingClientRect().top);

  response.resolve([
    { id: 'claude-sonnet', name: 'Claude Sonnet' },
    { id: 'claude-opus', name: 'Claude Opus' },
  ]);
  await expect(loading).toHaveCount(0);
  await expect(body.getByTestId('upstream-model')).toHaveCount(3);
  await expect(body.getByTestId('upstream-model').first()).toHaveAttribute('data-model-id', 'custom-preview');
  expect(await row.evaluate((el) => el.getBoundingClientRect().top)).toBe(beforeTop);
  await expect(checkbox).toBeChecked();
});

test('secret: static-form face submit stays in the viewport', async ({ page }) => {
  await page.goto('/app/resources/secrets?scenario=secrets-list');
  await page.getByRole('button', { name: '新建', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '添加密钥或环境变量' });
  await expect(dialog).toBeVisible();
  await expectShellCapped(dialog);

  await expect(dialog.getByRole('button', { name: '添加', exact: true })).toBeInViewport();
});

test('machine: disclosure expanded (tallest content state) bottom link stays in the viewport', async ({ page }) => {
  await page.goto('/app/resources/machines?scenario=06');
  await page.getByRole('button', { name: '添加执行机' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: '在云服务器上运行？改用 API key 注册' }).click();
  const keylink = dialog.getByRole('link', { name: '获取 API key →' });
  await expect(keylink).toBeVisible();
  await expectShellCapped(dialog);
  await expect(keylink).toBeInViewport();
});

test('schedules `新建定时` editor (900×420): capped to the viewport, its body scrolls inside to reach `取消`/save (#1037)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 900, height: 420 });
  await page.goto('/app?scenario=home-c&pane=tasks&tab=scheduled');
  await page.getByTestId('schedule-new').click();
  const popover = page.getByTestId('schedule-popover');
  await expect(popover).toBeVisible();
  await popover.getByRole('radio', { name: '单次' }).click();
  const box = await popover.boundingBox();
  expect(box).not.toBeNull();
  if (box == null) return;
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(420.5);
  const body = popover.locator('.overflow-y-auto').first();
  expect(await body.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  await body.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await expect(popover.getByRole('button', { name: '保存' })).toBeInViewport();
  await expect(popover.getByRole('button', { name: '取消' })).toBeInViewport();
});
