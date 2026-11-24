import { expect, test } from '@playwright/test';
import type { ClaudeSubscriptionListEntry } from '@cairn/shared';
import { mockLive } from './chief-home-mock';

const TOKEN = `sk-ant-oat01-${'e'.repeat(64)}`;

for (const locale of ['zh', 'en'] as const) {
test(`connects, verifies and deletes a subscription on the providers page (${locale})`, async ({ page }) => {
  await page.addInitScript((value) => localStorage.setItem('cairn.locale', value), locale);
  let rejectDelete = true;
  const connections: ClaudeSubscriptionListEntry[] = [];
  await mockLive(page, { threads: [], messages: [] }, (path, route, json) => {
    if (path === '/api/teams/t1/model-sources') return json({ sources: [] });
    if (path === '/api/teams/t1/providers') return json({ presets: [], providers: [] });
    if (path === '/api/teams/t1/claude-subscriptions') {
      if (route.request().method() === 'POST') {
        const body = route.request().postDataJSON();
        expect(body.token).toBe(TOKEN);
        const yearAhead = Date.now() + 365 * 24 * 60 * 60 * 1000;
        expect(Math.abs(body.expiresAt - yearAhead)).toBeLessThan(60_000);
        const connection: ClaudeSubscriptionListEntry = { id: 'subscription-1', kind: 'claude-subscription', label: body.label, expiresAt: body.expiresAt, createdAt: Date.now() };
        connections.push(connection);
        return json(connection, 201);
      }
      return json(connections);
    }
    if (path === '/api/teams/t1/claude-subscriptions/subscription-1/verify') return json({ ok: true });
    if (path === '/api/teams/t1/claude-subscriptions/subscription-1' && route.request().method() === 'DELETE') {
      if (rejectDelete) { rejectDelete = false; return json({ error: 'unavailable' }, 503); }
      connections.splice(0);
      return route.fulfill({ status: 204 });
    }
  });
  await page.goto('/app/resources/providers');
  await expect(page).toHaveURL(/\/app\/settings\/routing/);

  await page.getByTestId('routing-add-provider').click();
  const claudeRow = page.locator('[data-preset-id="claude-subscription"]');
  await expect(claudeRow).toContainText(locale === 'zh' ? 'Claude 订阅' : 'Claude subscription');
  const search = page.getByLabel(locale === 'zh' ? '搜索服务商...' : 'Search providers...');
  await search.fill(locale === 'zh' ? '订阅' : 'subscription');
  await expect(claudeRow).toBeVisible();
  await search.fill('');
  await expect(claudeRow.locator('svg')).toHaveCount(1);
  await claudeRow.click();
  const dialog = page.getByRole('dialog', {
    name: locale === 'zh' ? '添加 Claude 订阅' : 'Add Claude subscription',
  });
  await expect(dialog).toContainText('claude setup-token');
  await expect(dialog.locator('input[type="date"]')).toHaveCount(0);
  await dialog.getByTestId('subscription-label').fill('Personal Claude');
  await expect(dialog.getByTestId('subscription-token')).toHaveAttribute('type', 'password');
  await dialog.getByTestId('subscription-token').fill(TOKEN);
  await dialog.getByRole('button', { name: locale === 'zh' ? '保存' : 'Save', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const row = page.locator('[data-instance-id="subscription:subscription-1"]');
  await expect(row).toContainText('Personal Claude');
  await expect(page.locator('body')).not.toContainText(TOKEN);

  const detail = page.getByTestId('subscription-detail');
  const feedback = page.getByTestId('subscription-verify-feedback');
  await expect(feedback).toHaveAttribute('data-phase', 'passed');
  await expect(feedback).toContainText(
    locale === 'zh'
      ? '这个订阅的登录有效。'
      : 'This subscription’s sign-in is valid.',
  );
  await expect(detail.getByTestId('provider-rename')).toBeVisible();

  const remove = locale === 'zh' ? '移除' : 'Remove';
  const removeButton = detail.getByRole('button', { name: remove, exact: true });
  const confirm = page.getByRole('alertdialog');
  await removeButton.click();
  await expect(confirm).toContainText('Personal Claude');
  await confirm.getByRole('button', { name: locale === 'zh' ? '取消' : 'Cancel', exact: true }).click();
  await expect(row).toBeVisible();
  await removeButton.click();
  await confirm.getByRole('button', { name: remove, exact: true }).click();
  await expect(page.getByText(locale === 'zh' ? '移除失败，请重试。' : 'Could not remove. Try again.')).toBeVisible();
  await removeButton.click();
  await confirm.getByRole('button', { name: remove, exact: true }).click();
  await expect(row).toHaveCount(0);
});

}

test('a Claude subscription picks Opus 5.5 from upstream and a failed model test reads as its expired sign-in', async ({ page }) => {
  const record: ClaudeSubscriptionListEntry = {
    id: 'subscription-1',
    kind: 'claude-subscription',
    label: 'Personal Claude',
    expiresAt: Date.now() + 300 * 24 * 60 * 60 * 1000,
    createdAt: Date.now(),
    models: null,
  };
  const patches: unknown[] = [];
  await mockLive(page, { threads: [], messages: [] }, (path, route, json) => {
    if (path === '/api/teams/t1/model-sources') return json({ sources: [] });
    if (path === '/api/teams/t1/providers') return json({ presets: [], providers: [] });
    if (path === '/api/teams/t1/claude-subscriptions') return json([record]);
    if (path === '/api/teams/t1/claude-subscriptions/subscription-1/upstream-models')
      return json({
        status: 'ok',
        models: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'].map((id) => ({ id, name: id })),
      });
    if (path === '/api/teams/t1/claude-subscriptions/subscription-1' && route.request().method() === 'PATCH') {
      const body = route.request().postDataJSON();
      patches.push(body);
      record.models = body.models;
      return json(record);
    }
    if (path === '/api/teams/t1/claude-subscriptions/subscription-1/test') {
      const { model } = route.request().postDataJSON();
      return json(
        model === 'claude-opus-5-5'
          ? { status: 'ok', reason: null, failure: null, httpStatus: null, detail: null, latencyMs: 2100 }
          : { status: 'failed', reason: 'auth', failure: 'auth', httpStatus: null, detail: null, latencyMs: null },
      );
    }
  });
  await page.goto('/app/resources/providers');
  const detail = page.getByTestId('subscription-detail');
  await detail.getByTestId('subscription-pick-upstream').click();
  const picker = page.getByRole('dialog', { name: '从上游选择模型' });
  const rows = picker.getByTestId('upstream-model');
  await rows.filter({ has: page.locator('code', { hasText: 'claude-opus-5-5' }) }).click();
  await rows.filter({ has: page.locator('code', { hasText: 'claude-sonnet-5-5' }) }).click();
  await picker.getByTestId('upstream-save').click();
  await expect.poll(() => patches).toHaveLength(1);
  const chip = (id: string) => detail.locator(`[data-testid="subscription-model"][data-model-id="${id}"]`);
  await expect(chip('claude-opus-5-5')).toBeVisible();

  await detail.getByTestId('subscription-test-all').click();
  await expect(chip('claude-opus-5-5')).toHaveAttribute('data-check', 'ok');
  await expect(chip('claude-sonnet-5-5')).toHaveAttribute('data-check', 'failed');
  const report = page.getByTestId('model-test-result');
  await expect(report).toContainText('1/2 个模型未能连接：这个订阅的登录已失效。先移除它，再在终端运行 claude setup-token');
  await expect(page.getByTestId('model-test-detail').locator('dt:text-is("claude-sonnet-5-5") + dd')).toContainText('未通过 · 登录失效');
  await expect(report).not.toContainText('API key 无效');
  await expect(detail).not.toContainText('登录失效');
});

test('a retry leaves the fallback list and an in-flight press intact', async ({ page }) => {
  const record: ClaudeSubscriptionListEntry = {
    id: 'subscription-1',
    kind: 'claude-subscription',
    label: 'Personal Claude',
    expiresAt: Date.now() + 300 * 24 * 60 * 60 * 1000,
    createdAt: Date.now(),
    models: [{ id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5' }],
  };
  let calls = 0;
  const { promise: retry, resolve: settleRetry } = Promise.withResolvers<void>();
  await mockLive(page, { threads: [], messages: [] }, (path, _route, json) => {
    if (path === '/api/teams/t1/model-sources') return json({ sources: [] });
    if (path === '/api/teams/t1/providers') return json({ presets: [], providers: [] });
    if (path === '/api/teams/t1/claude-subscriptions') return json([record]);
    if (path === '/api/teams/t1/claude-subscriptions/subscription-1/upstream-models') {
      const first = ++calls === 1;
      const result = first
          ? {
              status: 'fallback',
              failure: 'auth',
              httpStatus: 401,
              models: [
                { id: 'claude-opus-5-5', name: 'Claude Opus 5.5' },
                { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5' },
              ],
            }
          : {
              status: 'ok',
              models: [
                { id: 'claude-fable-5-2', name: 'Claude Fable 5.2' },
                { id: 'claude-opus-5-5', name: 'claude-opus-5-5' },
              ],
            };
      return first ? json(result) : retry.then(() => json(result));
    }
  });
  await page.goto('/app/resources/providers');
  await page.getByTestId('subscription-detail').getByTestId('subscription-pick-upstream').click();
  const picker = page.getByRole('dialog', { name: '从上游选择模型' });
  await expect(picker.getByTestId('upstream-fallback').getByRole('alert')).toHaveText(
    '上游拒绝了这个订阅的登录，未能获取模型清单。请重新登录后重试。',
  );
  const headings = picker.getByTestId('upstream-group');
  await expect(headings).toHaveText(['打开时已选', '上游其他']);
  await expect(picker.getByTestId('upstream-provenance')).toHaveText([
    '备用清单，不是上游返回的',
    '备用清单，不是上游返回的',
  ]);
  await expect(picker.getByTestId('upstream-model')).toHaveCount(2);

  const opus = picker.locator('[data-model-id="claude-opus-5-5"]');
  const box = opus.getByRole('checkbox');
  const name = opus.getByText('Claude Opus 5.5', { exact: true });
  await expect(box).not.toBeChecked();
  await picker.getByRole('button', { name: '重试' }).click();
  await name.hover();
  await page.mouse.down();
  settleRetry();
  await expect(picker.getByTestId('upstream-model')).toHaveCount(3);
  await page.mouse.up();
  await expect(box).toBeChecked();
  await expect(name).toBeVisible();
  await expect(picker.getByTestId('upstream-fallback')).toHaveCount(1);
  await expect(headings).toHaveText(['打开时已选', '上游其他', '上游其他']);
  await expect(opus).toHaveAttribute('data-model-source', 'upstream');
  await expect(opus.getByTestId('upstream-provenance')).toBeEmpty();
  await expect(picker.locator('[data-model-id="claude-sonnet-5-5"]').getByTestId('upstream-provenance')).toHaveText('不在最新列表');
  await expect(picker.locator('[data-model-id="claude-fable-5-2"]')).toBeVisible();
});

test('a short picker scrolls its list, manual field and every retry notice in one body', async ({ page }) => {
  const models = [
    { id: 'claude-opus-5-5', name: 'Claude Opus 5.5' },
    { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5' },
  ];
  const record: ClaudeSubscriptionListEntry = {
    id: 'subscription-1',
    kind: 'claude-subscription',
    label: 'Personal Claude',
    expiresAt: Date.now() + 300 * 24 * 60 * 60 * 1000,
    createdAt: Date.now(),
    models,
  };
  let calls = 0;
  await mockLive(page, { threads: [], messages: [] }, (path, _route, json) => {
    if (path === '/api/teams/t1/model-sources') return json({ sources: [] });
    if (path === '/api/teams/t1/providers') return json({ presets: [], providers: [] });
    if (path === '/api/teams/t1/claude-subscriptions') return json([record]);
    if (path === '/api/teams/t1/claude-subscriptions/subscription-1/upstream-models') {
      switch (++calls) {
        case 1: return json({ status: 'fallback', models, failure: 'auth', httpStatus: 401 });
        case 2: return json({ status: 'failed', failure: 'timeout', httpStatus: 504 });
        default: return json({ status: 'ok', models: [] });
      }
    }
  });
  await page.goto('/app/resources/providers');
  await page.getByTestId('subscription-detail').getByTestId('subscription-pick-upstream').click();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 568, height: 320 });
  const picker = page.getByRole('dialog', { name: '从上游选择模型' });
  const body = picker.getByTestId('dialog-body');
  const retry = body.getByRole('button', { name: '重试' });
  const fallback = body.getByTestId('upstream-fallback').getByRole('alert');
  const failure = body.getByTestId('upstream-error').getByRole('alert');
  const empty = body.getByText('上游返回了空清单。', { exact: true });
  const omissions = body.getByText('第 2 次刷新：上游清单未列出 2 个模型', { exact: true });
  await retry.click();
  await expect(failure).toHaveCount(1);
  await retry.click();
  await expect(empty).toHaveCount(1);

  const firstRow = body.getByTestId('upstream-model').first();
  const list = firstRow.locator('xpath=../..');
  await firstRow.scrollIntoViewIfNeeded();
  await expect(firstRow).toBeInViewport();
  expect((await list.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(160);
  const beforeNotices = await body.evaluate((node) => node.scrollTop);
  for (const target of [body.getByRole('textbox', { name: '模型 ID' }), fallback, failure, empty, omissions]) {
    await target.scrollIntoViewIfNeeded();
    await expect(target).toBeVisible();
    expect((await target.boundingBox())?.height ?? 0).toBeGreaterThan(0);
    await expect(target).toBeInViewport({ ratio: 0.95 });
  }
  expect(await body.evaluate((node) => node.scrollTop)).toBeGreaterThan(beforeNotices);
});

test('the owner always sees Verify, Choose from upstream, Test all and each picked model test and remove controls', async ({ page }) => {
  const ids = ['claude-opus-5-5', 'claude-sonnet-5-5'];
  const record: ClaudeSubscriptionListEntry = {
    id: 'subscription-1',
    kind: 'claude-subscription',
    label: 'Personal Claude',
    expiresAt: Date.now() + 300 * 24 * 60 * 60 * 1000,
    createdAt: Date.now(),
    models: ids.map((id) => ({ id, name: id })),
  };
  await mockLive(page, { threads: [], messages: [] }, (path, _route, json) => {
    if (path === '/api/teams/t1/model-sources') return json({ sources: [] });
    if (path === '/api/teams/t1/providers') return json({ presets: [], providers: [] });
    if (path === '/api/teams/t1/claude-subscriptions') return json([record]);
  });
  await page.goto('/app/resources/providers');
  const detail = page.getByTestId('subscription-detail');
  await expect(detail.getByTestId('subscription-verify')).toBeVisible();
  await expect(detail.getByTestId('subscription-pick-upstream')).toBeVisible();
  await expect(detail.getByTestId('subscription-test-all')).toBeVisible();
  await expect(detail.getByTestId('subscription-model')).toHaveCount(ids.length);
  for (const id of ids) {
    await expect(detail.getByRole('button', { name: `测试 ${id}` })).toBeVisible();
    await expect(detail.getByRole('button', { name: `移除 ${id}` })).toBeVisible();
  }
});
