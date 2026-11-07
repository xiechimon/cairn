import { expect, test } from '@playwright/test';
import { mockLive } from './chief-home-mock';

const URL = '/app/settings/providers?scenario=model-routing';
const STATUS_WORDS = ['可用', '验证中', '验证失败', '冷却', '额度用尽', '已过期'];

for (const width of [1440, 375]) {
  test(`subscription rows at ${width}px: kind, one status, no placeholder dashes`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(URL);
    const rows = page.locator('[data-testid="provider-instance"][data-instance-id^="subscription:"]');
    await expect(rows).toHaveCount(3);
    await expect(page.getByTestId('provider-list')).not.toContainText('—');
    const count = await rows.count();
    for (let i = 0; i < count; i += 1) {
      const row = rows.nth(i);
      await expect(row).toContainText('订阅');
      const text = (await row.textContent()) ?? '';
      const named = STATUS_WORDS.filter((word) => text.includes(word));
      expect(named, text).toHaveLength(1);
      const box = await row.boundingBox();
      expect(box?.height ?? 0).toBeLessThanOrEqual(84);
    }
  });
}

test('the Personal detail reads status, last use, steps and each quota window in one place', async ({
  page,
}) => {
  await page.goto(URL);
  const detail = page.getByTestId('subscription-detail');
  await expect(detail.getByTestId('subscription-status')).toHaveText('可用');
  await expect(detail).toContainText('最近使用');
  await expect(detail).toContainText('24 小时步骤');
  await expect(detail.getByRole('progressbar')).toHaveCount(2);
  await expect(detail).not.toContainText('还没有额度读数');
  await expect(detail).not.toContainText('—');
});

test('an account nobody has used says so once, and still has a quota line of its own', async ({
  page,
}) => {
  await mockLive(page, { threads: [], messages: [] }, (path, _route, json) => {
    if (path === '/api/teams/t1/claude-subscriptions')
      return json([{ id: 's1', kind: 'claude-subscription', label: 'Fresh', expiresAt: null, createdAt: 0, plan: null }]);
    if (path === '/api/teams/t1/providers') return json({ presets: [], providers: [] });
    if (path === '/api/teams/t1/model-sources') return json({ sources: [] });
    return undefined;
  });
  await page.goto('/app/settings/providers');
  const row = page.getByTestId('provider-instance');
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('订阅 · 可用');
  await expect(row).not.toContainText('最近使用');
  const detail = page.getByTestId('subscription-detail');
  await expect(detail.getByText('还没用过')).toHaveCount(1);
  await expect(detail).toContainText('还没有额度读数');
  await expect(detail).not.toContainText('—');
});
