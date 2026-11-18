import { expect, type Page, test } from '@playwright/test';
import type { AntigravitySubscriptionListEntry, AntigravitySubscriptionModel } from '@cairn/shared';
import { mockLive } from './chief-home-mock';

const NOW = Date.now();
const DAY = 86_400_000;

const UPSTREAM = [
  { id: 'gemini-4-carbon', name: 'Gemini 4 Carbon' },
  { id: 'gemini-4-argon', name: 'Gemini 4 Argon' },
  { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6 (Thinking)' },
  { id: 'gpt-oss-120b-medium', name: 'GPT-OSS 120B (Medium)' },
];

const subscription = (
  models: AntigravitySubscriptionModel[],
): AntigravitySubscriptionListEntry => ({
  id: 'sub-a1',
  kind: 'antigravity-subscription',
  label: 'Antigravity',
  hasToken: false,
  expiresAt: null,
  enabled: true,
  enabledAt: NOW - DAY,
  createdAt: NOW - 6 * DAY,
  lastUsedAt: NOW - 3_600_000,
  stepsLast24h: 2,
  models,
});

const picked = () => [UPSTREAM[0], UPSTREAM[2]];

const detail = (page: Page) => page.getByTestId('subscription-detail');
const pickedChip = (page: Page, id: string) =>
  detail(page).locator(`[data-testid="subscription-picked-model"][data-model-id="${id}"]`);

const mount = (
  page: Page,
  record: ReturnType<typeof subscription>,
  upstream: object | null = UPSTREAM,
  patches: object[] = [],
) =>
  mockLive(page, { threads: [], messages: [] }, (path, route, json) => {
    if (path === '/api/teams/t1/antigravity-subscriptions') return json([record]);
    if (path === '/api/teams/t1/devin-subscriptions') return json([]);
    if (path === '/api/teams/t1/claude-subscriptions') return json([]);
    if (path === '/api/teams/t1/model-sources')
      return json({
        sources: [
          {
            runtime: 'antigravity',
            installed: true,
            hostname: 'agy-mac',
            machineId: 'm1',
            models: UPSTREAM.map(({ id, name }) => ({ id, name })),
          },
        ],
      });
    if (path === '/api/teams/t1/antigravity-subscriptions/sub-a1/upstream-models')
      return upstream === null
        ? json({ status: 'failed', failure: 'upstream', httpStatus: null })
        : json({ status: 'ok', models: upstream });
    if (
      path === '/api/teams/t1/antigravity-subscriptions/sub-a1' &&
      route.request().method() === 'PATCH'
    ) {
      const body = route.request().postDataJSON();
      patches.push(body);
      record.models = body.models;
      return json(record);
    }
    return undefined;
  });

test('picked models render as chips on the subscription detail', async ({ page }) => {
  await mount(page, subscription(picked()));
  await page.goto('/app/resources/providers');
  await expect(detail(page)).toBeVisible();
  await expect(detail(page).getByTestId('subscription-models-summary')).toHaveText('2 个');
  await expect(pickedChip(page, 'gemini-4-carbon')).toBeVisible();
  await expect(pickedChip(page, 'claude-sonnet-4-6')).toBeVisible();
});

test('removing a chip persists the shortened model list', async ({ page }) => {
  const patches: object[] = [];
  await mount(page, subscription(picked()), UPSTREAM, patches);
  await page.goto('/app/resources/providers');
  await pickedChip(page, 'gemini-4-carbon').getByTestId('subscription-model-remove').click();
  await expect
    .poll(() => patches)
    .toEqual([{ models: [expect.objectContaining({ id: 'claude-sonnet-4-6' })] }]);
  await expect(pickedChip(page, 'gemini-4-carbon')).toHaveCount(0);
  await expect(detail(page).getByTestId('subscription-models-summary')).toHaveText('1 个');
});

test('the upstream picker groups by vendor and saves the picks', async ({ page }) => {
  const patches: object[] = [];
  await mount(page, subscription([]), UPSTREAM, patches);
  await page.goto('/app/resources/providers');
  await expect(detail(page)).toContainText('还没勾选模型');
  await detail(page).getByTestId('subscription-fetch-upstream').click();
  const picker = page.getByRole('dialog', { name: '从上游选择模型' });
  await expect(picker.getByTestId('upstream-group')).toHaveText([
    'Claude · 1',
    'Gemini · 2',
    'GPT · 1',
  ]);

  const rows = picker.getByTestId('upstream-model');
  await rows
    .filter({ has: page.locator('code', { hasText: 'gemini-4-carbon' }) })
    .click();
  await rows.filter({ has: page.locator('code', { hasText: 'gpt-oss-120b-medium' }) }).click();
  await picker.getByTestId('upstream-save').click();
  await expect.poll(() => patches).toHaveLength(1);
  expect(patches[0]).toEqual({
    models: expect.arrayContaining([
      expect.objectContaining({ id: 'gemini-4-carbon' }),
      expect.objectContaining({ id: 'gpt-oss-120b-medium' }),
    ]),
  });
  await expect(pickedChip(page, 'gemini-4-carbon')).toBeVisible();
});

test('a failed upstream fetch offers the by-id fallback', async ({ page }) => {
  const patches: object[] = [];
  await mount(page, subscription([]), null, patches);
  await page.goto('/app/resources/providers');
  await detail(page).getByTestId('subscription-fetch-upstream').click();
  const picker = page.getByRole('dialog', { name: '从上游选择模型' });
  await expect(picker.getByTestId('upstream-error')).toContainText('上游返回了错误');
  const typed = picker.getByLabel('模型 ID');
  await typed.fill('gemini-4-carbon');
  await typed.press('Enter');
  await picker.getByTestId('upstream-save').click();
  await expect
    .poll(() => patches)
    .toEqual([{ models: [{ id: 'gemini-4-carbon', name: 'gemini-4-carbon' }] }]);
});
