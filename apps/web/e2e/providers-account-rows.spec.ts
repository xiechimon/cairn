import { expect, test } from '@playwright/test';
import type { ClaudeSubscriptionListEntry } from '@cairn/shared';
import { mockLive } from './chief-home-mock';

const URL = '/app/settings/routing?scenario=model-routing';
const CHECK_WORDS = ['可用', '未验证', '验证中', '验证失败', '登录失效'];
const ACCOUNT_WORDS = ['冷却', '额度用尽', '已过期'];

for (const width of [1440, 375]) {
  test(`subscription rows at ${width}px: kind, no check status, at most one account state, no placeholder dashes`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(URL);
    const rows = page.locator('[data-testid="provider-instance"][data-instance-id^="subscription:"]');
    await expect(rows).toHaveCount(4);
    await expect(page.getByTestId('provider-list')).not.toContainText('—');
    const count = await rows.count();
    for (let i = 0; i < count; i += 1) {
      const row = rows.nth(i);
      await expect(row).toContainText('订阅');
      const text = (await row.textContent()) ?? '';
      expect(CHECK_WORDS.filter((word) => text.includes(word)), text).toEqual([]);
      expect(ACCOUNT_WORDS.filter((word) => text.includes(word)).length, text).toBeLessThanOrEqual(1);
      const box = await row.boundingBox();
      expect(box?.height ?? 0).toBeLessThanOrEqual(84);
    }
  });
}

test('the Personal detail reads last use, models and each quota window in one place, with no check status', async ({
  page,
}) => {
  await page.goto(URL);
  const detail = page.getByTestId('subscription-detail');
  await expect(detail.getByTestId('subscription-status')).toHaveCount(0);
  await expect(detail).not.toContainText('可用');
  await expect(detail).toContainText('最近使用');
  await expect(detail.getByTestId('subscription-model')).toHaveCount(4);
  await expect(detail.getByTestId('subscription-model').first()).toContainText('claude-opus-4-5');
  await expect(detail.getByRole('progressbar')).toHaveCount(2);
  await expect(detail).not.toContainText('还没有额度读数');
  await expect(detail).not.toContainText('—');
});

test('the Devin subscription lists its catalog models and shows no quota section', async ({
  page,
}) => {
  await page.goto(URL);
  const row = page.locator('[data-instance-id="subscription:sub-devin"]');
  await expect(row).toContainText('订阅 · 5 个模型 · 最近使用');
  await row.click();
  const detail = page.getByTestId('subscription-detail');
  await expect(detail.getByTestId('subscription-model')).toHaveCount(5);
  await expect(detail.getByTestId('subscription-model').first()).toContainText('SWE-2');
  await expect(detail.getByTestId('subscription-model').first()).toContainText('swe-2-high');
  await expect(detail).not.toContainText('额度');
  await expect(detail).not.toContainText('—');
});

test('subscriptions whose Runner reports nothing: Claude reads 0 models and warns, the Devin catalog still shows', async ({
  page,
}) => {
  await page.goto('/app/settings/routing?scenario=model-routing-no-runner');
  const row = page.locator('[data-instance-id="subscription:sub-personal"]');
  await expect(row).toContainText('订阅 · Max · 0 个模型');
  await expect(row).toHaveAttribute('data-tone', 'warn');
  await row.click();
  const detail = page.getByTestId('subscription-detail');
  await expect(detail).toContainText('尚未勾选模型。从上游获取模型清单后勾选。');
  const devin = page.locator('[data-instance-id="subscription:sub-devin"]');
  await expect(devin).toContainText('订阅 · 5 个模型 · 最近使用');
  await expect(devin).toHaveAttribute('data-tone', 'ok');
  await devin.click();
  await expect(detail.getByTestId('subscription-model')).toHaveCount(5);
});

test('an account nobody has used says so once, and still has a quota line of its own', async ({
  page,
}) => {
  await mockLive(page, { threads: [], messages: [] }, (path, _route, json) => {
    if (path === '/api/teams/t1/claude-subscriptions')
      return json([
        {
          id: 's1',
          kind: 'claude-subscription',
          label: 'Fresh',
          expiresAt: null,
          createdAt: 0,
        } satisfies ClaudeSubscriptionListEntry,
      ]);
    if (path === '/api/teams/t1/providers') return json({ presets: [], providers: [] });
    if (path === '/api/teams/t1/model-sources') return json({ sources: [] });
    return undefined;
  });
  await page.goto('/app/settings/routing');
  const row = page.getByTestId('provider-instance');
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('订阅 · 0 个模型');
  await expect(row).not.toContainText('未验证');
  await expect(row).not.toContainText('最近使用');
  const detail = page.getByTestId('subscription-detail');
  await expect(detail.getByText('尚未使用')).toHaveCount(1);
  await expect(detail).toContainText('尚未勾选模型。从上游获取模型清单后勾选。');
  await expect(detail.getByTestId('subscription-status')).toHaveCount(0);
  await expect(detail.getByTestId('subscription-verify-feedback')).toHaveCount(0);
  await expect(detail.getByTestId('subscription-quota')).toHaveCount(0);
  await expect(detail).not.toContainText('—');
});
