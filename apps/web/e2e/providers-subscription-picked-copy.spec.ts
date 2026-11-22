import { expect, test } from '@playwright/test';
import type { ClaudeSubscriptionListEntry } from '@cairn/shared';
import { mockLive } from './chief-home-mock';

const RUNNER_MODELS = [
  { id: 'claude-opus-5-5', name: 'claude-opus-5-5', slot: 'default' },
  { id: 'claude-sonnet-5-5', name: 'claude-sonnet-5-5', slot: 'sonnet' },
  { id: 'claude-haiku-5-5', name: 'claude-haiku-5-5', slot: 'haiku' },
];

async function openPage(
  page: import('@playwright/test').Page,
  record: ClaudeSubscriptionListEntry,
) {
  await mockLive(page, { threads: [], messages: [] }, (path, route, json) => {
    if (path === '/api/teams/t1/model-sources') {
      return json({
        sources: [
          {
            runtime: 'claude-code',
            installed: true,
            hostname: 'runner-1',
            machineId: 'm1',
            models: RUNNER_MODELS,
          },
        ],
      });
    }
    if (path === '/api/teams/t1/providers') return json({ presets: [], providers: [] });
    if (path === '/api/teams/t1/claude-subscriptions') return json([record]);
  });
  await page.goto('/app/resources/providers');
  return page.getByTestId('subscription-detail');
}

test('runner-reported chips show without claiming nothing is picked', async ({ page }) => {
  const record: ClaudeSubscriptionListEntry = {
    id: 'subscription-1',
    kind: 'claude-subscription',
    label: 'Personal Claude',
    expiresAt: Date.now() + 300 * 24 * 60 * 60 * 1000,
    createdAt: Date.now(),
  };
  const detail = await openPage(page, record);
  await expect(detail.locator('[data-testid="subscription-model"]')).toHaveCount(3);
  await expect(detail).not.toContainText('尚未勾选模型');
});

test('saved picks show without the no-picks claim either', async ({ page }) => {
  const record: ClaudeSubscriptionListEntry = {
    id: 'subscription-1',
    kind: 'claude-subscription',
    label: 'Personal Claude',
    expiresAt: Date.now() + 300 * 24 * 60 * 60 * 1000,
    createdAt: Date.now(),
    models: RUNNER_MODELS.map(({ id, name }) => ({ id, name })),
  };
  const detail = await openPage(page, record);
  await expect(detail.locator('[data-testid="subscription-model"]')).toHaveCount(3);
  await expect(detail).not.toContainText('尚未勾选模型');
});
