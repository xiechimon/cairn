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
      ? 'Claude 回复了这次模型请求，订阅能用。'
      : 'Claude answered the model request; the subscription works.',
  );
  await expect(detail.getByLabel(locale === 'zh' ? '名称' : 'Name')).toBeVisible();

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
  await expect(chip('claude-sonnet-5-5')).toContainText('登录失效');
  await expect(detail.getByTestId('subscription-model-failures')).toContainText('订阅的登录已失效');
  await expect(detail).not.toContainText('key 无效');
});

test('a failed upstream model list says why and labels the fallback list', async ({ page }) => {
  const record: ClaudeSubscriptionListEntry = {
    id: 'subscription-1',
    kind: 'claude-subscription',
    label: 'Personal Claude',
    expiresAt: Date.now() + 300 * 24 * 60 * 60 * 1000,
    createdAt: Date.now(),
    models: null,
  };
  let calls = 0;
  await mockLive(page, { threads: [], messages: [] }, (path, _route, json) => {
    if (path === '/api/teams/t1/model-sources') return json({ sources: [] });
    if (path === '/api/teams/t1/providers') return json({ presets: [], providers: [] });
    if (path === '/api/teams/t1/claude-subscriptions') return json([record]);
    if (path === '/api/teams/t1/claude-subscriptions/subscription-1/upstream-models') {
      calls += 1;
      return json(
        calls === 1
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
                { id: 'claude-opus-5-5', name: 'Claude Opus 5.5' },
              ],
            },
      );
    }
  });
  await page.goto('/app/resources/providers');
  await page.getByTestId('subscription-detail').getByTestId('subscription-pick-upstream').click();
  const picker = page.getByRole('dialog', { name: '从上游选择模型' });
  await expect(picker.getByTestId('upstream-fallback').getByRole('alert')).toHaveText(
    '上游拒绝了这个订阅的登录，没拿到模型清单。重新登录后重试。',
  );
  await expect(picker.getByTestId('upstream-group')).toHaveText('备用清单，不是上游返回的');
  await expect(picker.getByTestId('upstream-model')).toHaveCount(2);
  await expect(picker).not.toContainText('上游其他');

  await picker.getByRole('button', { name: '重试' }).click();
  await expect(picker.getByTestId('upstream-fallback')).toHaveCount(0);
  await expect(picker.getByTestId('upstream-group')).toHaveText('上游其他');
  await expect(picker.locator('[data-model-id="claude-fable-5-2"]')).toBeVisible();
});
