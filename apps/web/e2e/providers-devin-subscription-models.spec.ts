import { expect, type Page, test } from '@playwright/test';
import type { DevinSubscriptionListEntry, DevinSubscriptionModel } from '@cairn/shared';
import { mockLive } from './chief-home-mock';

const NOW = Date.now();
const DAY = 86_400_000;

const UPSTREAM = [
  { id: 'swe-2-high', name: 'SWE-2', family: 'SWE-2', costTier: 'High cost', contextTokens: 262_144 },
  {
    id: 'swe-2-flash-medium',
    name: 'SWE-2 Flash',
    family: 'SWE-2',
    costTier: 'Free',
    contextTokens: 262_144,
  },
  { id: 'adaptive', name: 'Adaptive', family: 'Adaptive', costTier: 'Free', contextTokens: 262_144 },
  {
    id: 'claude-opus-5-5-medium',
    name: 'Claude Opus 5.5',
    family: 'Claude Opus 5.5',
    costTier: 'High cost',
    contextTokens: 1_000_000,
    costSummary: '$4 / 1M Input · $20 / 1M Output',
  },
  { id: 'gemini-4-carbon', name: 'Gemini 4 Carbon', family: 'Gemini 4', costTier: 'Med cost', contextTokens: 1_000_000 },
  {
    id: 'fusion-opus-gpt',
    name: 'Fusion (Claude Opus 5.5 + GPT-6.1)',
    family: 'Fusion',
    costTier: 'High cost',
  },
];

const subscription = (models: DevinSubscriptionModel[]): DevinSubscriptionListEntry => ({
  id: 'sub-d1',
  kind: 'devin-subscription',
  label: 'Devin',
  expiresAt: NOW + 180 * DAY,
  createdAt: NOW - 6 * DAY,
  lastUsedAt: NOW - 3_600_000,
  stepsLast24h: 2,
  models,
});

const picked = () => [
  UPSTREAM[1],
  UPSTREAM[3],
];

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
    if (path === '/api/teams/t1/devin-subscriptions') return json([record]);
    if (path === '/api/teams/t1/claude-subscriptions') return json([]);
    if (path === '/api/teams/t1/model-sources')
      return json({
        sources: [
          {
            runtime: 'devin',
            installed: true,
            hostname: 'omarchy',
            machineId: 'm1',
            models: [
              { id: 'swe-2-high', name: 'SWE-2' },
              { id: 'swe-2-flash-medium', name: 'SWE-2 Flash' },
              { id: 'adaptive', name: 'Adaptive' },
            ],
          },
        ],
      });
    if (path === '/api/teams/t1/devin-subscriptions/sub-d1/upstream-models')
      return upstream === null
        ? json({ status: 'failed', failure: 'not-found', httpStatus: null })
        : json({ status: 'ok', models: upstream });
    if (path === '/api/teams/t1/devin-subscriptions/sub-d1' && route.request().method() === 'PATCH') {
      const body = route.request().postDataJSON();
      patches.push(body);
      record.models = body.models;
      return json(record);
    }
    return undefined;
  });

test('picked models render as chips with free badge, tier and context', async ({ page }) => {
  await mount(page, subscription(picked()));
  await page.goto('/app/resources/providers');
  await expect(detail(page)).toBeVisible();
  await expect(detail(page).getByTestId('subscription-models-summary')).toHaveText('2 个');
  await expect(pickedChip(page, 'swe-2-flash-medium')).toContainText('Free');
  await expect(pickedChip(page, 'swe-2-flash-medium')).toContainText('262K');
  await expect(pickedChip(page, 'claude-opus-5-5-medium')).toContainText('高价');
  await expect(pickedChip(page, 'claude-opus-5-5-medium')).toContainText('1M');
});

test('removing a chip persists the shortened model list', async ({ page }) => {
  const patches: object[] = [];
  await mount(page, subscription(picked()), UPSTREAM, patches);
  await page.goto('/app/resources/providers');
  await pickedChip(page, 'swe-2-flash-medium')
    .getByTestId('subscription-model-remove')
    .click();
  await expect
    .poll(() => patches)
    .toEqual([{ models: [expect.objectContaining({ id: 'claude-opus-5-5-medium' })] }]);
  await expect(pickedChip(page, 'swe-2-flash-medium')).toHaveCount(0);
  await expect(detail(page).getByTestId('subscription-models-summary')).toHaveText('1 个');
});

test('the upstream picker groups by vendor, filters free models and saves the picks', async ({
  page,
}) => {
  const patches: object[] = [];
  await mount(page, subscription([]), UPSTREAM, patches);
  await page.goto('/app/resources/providers');
  await expect(detail(page)).toContainText('还没勾选模型');
  await detail(page).getByTestId('subscription-fetch-upstream').click();
  const picker = page.getByRole('dialog', { name: '从上游选择模型' });
  const groupLabels = picker.getByTestId('upstream-group');
  await expect(groupLabels).toHaveText([
    'Devin 原生 · 3',
    'Claude · 1',
    'Gemini · 1',
    'Fusion 组合 · 1',
  ]);

  const search = picker.getByLabel('搜索模型');
  await search.fill('free');
  const rows = picker.getByTestId('upstream-model');
  await expect(rows).toHaveCount(2);
  await expect(rows.locator('code').allTextContents()).resolves.toEqual([
    'swe-2-flash-medium',
    'adaptive',
  ]);
  await expect(picker.getByTestId('upstream-model-free')).toHaveCount(2);

  await search.fill('');
  await rows
    .filter({ has: page.locator('code', { hasText: 'claude-opus-5-5-medium' }) })
    .click();
  await rows.filter({ has: page.locator('code', { hasText: 'adaptive' }) }).click();
  await picker.getByTestId('upstream-save').click();
  await expect.poll(() => patches).toHaveLength(1);
  expect(patches[0]).toEqual({
    models: expect.arrayContaining([
      expect.objectContaining({ id: 'claude-opus-5-5-medium' }),
      expect.objectContaining({ id: 'adaptive' }),
    ]),
  });
  await expect(pickedChip(page, 'adaptive')).toBeVisible();
});

test('a failed upstream fetch offers the by-id fallback', async ({ page }) => {
  const patches: object[] = [];
  await mount(page, subscription([]), null, patches);
  await page.goto('/app/resources/providers');
  await detail(page).getByTestId('subscription-fetch-upstream').click();
  const picker = page.getByRole('dialog', { name: '从上游选择模型' });
  await expect(picker.getByTestId('upstream-error')).toContainText('上游没有提供模型清单');
  const typed = picker.getByLabel('模型 ID');
  await typed.fill('swe-2-high');
  await typed.press('Enter');
  await picker.getByTestId('upstream-save').click();
  await expect
    .poll(() => patches)
    .toEqual([{ models: [{ id: 'swe-2-high', name: 'swe-2-high' }] }]);
});
