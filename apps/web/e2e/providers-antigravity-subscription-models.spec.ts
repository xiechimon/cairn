import { expect, type Page, test } from '@playwright/test';
import type { AntigravitySubscriptionListEntry, AntigravitySubscriptionModel } from '@cairn/shared';
import { mockLive } from './chief-home-mock';

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});

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
  detail(page).locator(`[data-testid="subscription-model"][data-model-id="${id}"]`);

const mount = (
  page: Page,
  record: ReturnType<typeof subscription>,
  upstream: object | null = UPSTREAM,
  patches: object[] = [],
  probe?: (model: string) => Promise<object>,
) =>
  mockLive(page, { threads: [], messages: [] }, (path, route, json) => {
    if (path === '/api/teams/t1/antigravity-subscriptions') return json([record]);
    if (path === '/api/teams/t1/devin-subscriptions') return json([]);
    if (path === '/api/teams/t1/claude-subscriptions') return json([]);
    if (path === '/api/teams/t1/model-sources') return json({ sources: [] });
    if (path === '/api/teams/t1/antigravity-subscriptions/sub-a1/test' && probe)
      return probe(route.request().postDataJSON().model).then(json);
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

test('Antigravity models have the same test action as other providers', async ({ page }) => {
  const models: string[] = [];
  let finish!: (result: object) => void;
  const outcome = new Promise<object>((resolve) => { finish = resolve; });
  await mount(page, subscription(picked()), UPSTREAM, [], (model) => {
    models.push(model);
    return outcome;
  });
  await page.goto('/app/resources/providers');
  const play = pickedChip(page, 'gemini-4-carbon').getByRole('button', { name: '测试 gemini-4-carbon' });
  await expect(detail(page).getByRole('button', { name: '全部测试' })).toBeVisible();
  await play.click();
  const report = page.getByTestId('model-test-result');
  await expect(report).toHaveAttribute('data-phase', 'checking');
  await expect(play).toBeDisabled();
  finish({ status: 'ok', failure: null, reason: null, httpStatus: null, detail: null, latencyMs: 230 });
  await expect(report).toHaveAttribute('data-phase', 'passed');
  expect(models).toEqual(['gemini-4-carbon']);
  await page.keyboard.press('Escape');
  await expect(report).toHaveCount(0);
});

test('Antigravity Test all reports partial failure and a cooldown response per model', async ({ page }) => {
  const requests: string[] = [];
  await mockLive(page, { threads: [], messages: [] }, (path, route, json) => {
    if (path === '/api/teams/t1/antigravity-subscriptions') return json([subscription(picked())]);
    if (path === '/api/teams/t1/devin-subscriptions' || path === '/api/teams/t1/claude-subscriptions') return json([]);
    if (path === '/api/teams/t1/model-sources') return json({ sources: [] });
    if (path === '/api/teams/t1/antigravity-subscriptions/sub-a1/test') {
      const model = route.request().postDataJSON().model as string;
      requests.push(model);
      if (requests.length > 2) return route.fulfill({ status: 429, json: { error: 'Too many requests' } });
      return json(model === 'gemini-4-carbon'
        ? { status: 'ok', failure: null, reason: null, httpStatus: null, detail: null, latencyMs: 230 }
        : { status: 'failed', failure: 'not-found', reason: 'failed', httpStatus: 404, detail: '<img src=x onerror=alert(1)>', latencyMs: null });
    }
    return undefined;
  });
  await page.goto('/app/resources/providers');
  await detail(page).getByTestId('subscription-test-all').click();
  const report = page.getByTestId('model-test-result');
  const facts = page.getByTestId('model-test-detail');
  await expect(report).toHaveAttribute('data-phase', 'failed');
  await expect(facts.locator('dt:text-is("gemini-4-carbon") + dd')).toContainText('通过 · 230 ms');
  await expect(facts.locator('dt:text-is("claude-sonnet-4-6") + dd')).toContainText('未通过 · 模型不存在');
  await expect(report.locator('img')).toHaveCount(0);
  await expect(report).not.toContainText('onerror');
  expect(requests.slice(0, 2).sort()).toEqual(['claude-sonnet-4-6', 'gemini-4-carbon']);

  await page.keyboard.press('Escape');
  await detail(page).getByTestId('subscription-test-all').click();
  await expect(facts.locator('dt:text-is("gemini-4-carbon") + dd')).toContainText('测试未完成');
  await expect(facts.locator('dt:text-is("claude-sonnet-4-6") + dd')).toContainText('测试未完成');
  expect(requests.slice(2).sort()).toEqual(['claude-sonnet-4-6', 'gemini-4-carbon']);
});

test('switching subscriptions while an Antigravity probe is in flight does not leak its result', async ({ page }) => {
  const requests: string[] = [];
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  const first = subscription(picked());
  const second = { ...subscription(picked()), id: 'sub-b2', label: 'Antigravity second' };
  await mockLive(page, { threads: [], messages: [] }, (path, route, json) => {
    if (path === '/api/teams/t1/antigravity-subscriptions') return json([first, second]);
    if (path === '/api/teams/t1/devin-subscriptions' || path === '/api/teams/t1/claude-subscriptions') return json([]);
    if (path === '/api/teams/t1/model-sources') return json({ sources: [] });
    if (path === '/api/teams/t1/antigravity-subscriptions/sub-a1/test' || path === '/api/teams/t1/antigravity-subscriptions/sub-b2/test') {
      requests.push(`${path}:${route.request().postDataJSON().model}`);
      const result = { status: 'ok', failure: null, reason: null, httpStatus: null, detail: null, latencyMs: path.includes('sub-a1') ? 230 : 420 };
      return path.includes('sub-a1') ? held.then(() => json(result)) : json(result);
    }
    return undefined;
  });
  await page.goto('/app/resources/providers');
  await pickedChip(page, 'gemini-4-carbon').getByRole('button', { name: '测试 gemini-4-carbon' }).click();
  await expect(page.getByTestId('model-test-result')).toHaveAttribute('data-phase', 'checking');
  await page.locator('[data-testid="provider-instance"][data-instance-id="subscription:sub-b2"]').getByRole('button').first().click();
  await expect(detail(page)).toHaveAttribute('data-account-id', 'sub-b2');
  const finished = page.waitForResponse((response) => response.url().endsWith('/sub-a1/test'));
  release();
  await finished;
  await expect(page.getByTestId('model-test-result')).toHaveCount(0);
  await expect(pickedChip(page, 'gemini-4-carbon')).toHaveAttribute('data-check', 'none');
  await pickedChip(page, 'gemini-4-carbon').getByRole('button', { name: '测试 gemini-4-carbon' }).click();
  await expect(page.getByTestId('model-test-detail')).toContainText('通过 · 420 ms');
  expect(requests).toEqual([
    '/api/teams/t1/antigravity-subscriptions/sub-a1/test:gemini-4-carbon',
    '/api/teams/t1/antigravity-subscriptions/sub-b2/test:gemini-4-carbon',
  ]);
});

test('removing a chip persists the shortened model list', async ({ page }) => {
  const patches: object[] = [];
  await mount(page, subscription(picked()), UPSTREAM, patches);
  await page.goto('/app/resources/providers');
  await pickedChip(page, 'gemini-4-carbon').getByRole('button', { name: '移除 gemini-4-carbon' }).click();
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
  await expect(pickedChip(page, 'gemini-4-carbon')).toHaveCount(0);
  await expect(detail(page)).toContainText('尚未勾选模型');
  await detail(page).getByTestId('subscription-pick-upstream').click();
  const picker = page.getByRole('dialog', { name: '从上游选择模型' });
  await expect(picker.getByTestId('upstream-group')).toHaveText([
    'Claude · 1',
    'Gemini · 2',
    'GPT-OSS · 1',
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

for (const textScale of [1, 2]) {
  test(`C23: retry preserves every 568x320 row box at ${textScale * 100}% text scale and marks all four omissions`, async ({ page }) => {
    await page.setViewportSize({ width: 568, height: 320 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const [first, confirmed, ...rest] = [
      UPSTREAM[0]!,
      UPSTREAM[1]!,
      { id: 'gemini-4-pro-preview', name: 'Gemini 4 Pro Preview' },
      { id: 'gemini-4-flash-lite', name: 'Gemini 4 Flash Lite' },
      { id: 'gemini-4-flash-preview', name: 'Gemini 4 Flash Preview' },
    ] as const;
    const fallbackModels = [first, confirmed, ...rest];
    const { promise: retry, resolve: settleRetry } = Promise.withResolvers<void>();
    await mount(page, subscription([]));
    let calls = 0;
    await page.route('**/api/teams/t1/antigravity-subscriptions/sub-a1/upstream-models', async (route) => {
      if (++calls === 1) {
        await route.fulfill({ json: { status: 'fallback', models: fallbackModels, failure: 'network', httpStatus: null } });
        return;
      }
      await retry;
      await route.fulfill({ json: { status: 'ok', models: [confirmed] } });
    });
    await page.goto('/app/resources/providers');
    await detail(page).getByTestId('subscription-pick-upstream').click();
    const picker = page.getByRole('dialog', { name: '从上游选择模型' });
    const rows = picker.getByTestId('upstream-model');
    await expect(rows).toHaveCount(5);
    const modelId = rows.first().locator('code');
    const baseSize = await modelId.evaluate((node) => parseFloat(getComputedStyle(node).fontSize));
    await page.addStyleTag({ content: `:root { --type-scale: ${textScale} !important; }` });
    await expect(modelId).toHaveCSS('font-size', `${baseSize * textScale}px`);
    await page.evaluate(async () => { await document.fonts.ready; });
    const boxes = () => rows.evaluateAll((nodes) => nodes.map((node) => {
      const { height, top } = node.getBoundingClientRect();
      return { id: node.getAttribute('data-model-id'), height, top };
    }));
    await picker.getByRole('button', { name: '重试', exact: true }).click();
    await picker.getByTestId('dialog-body').evaluate((body) => { body.scrollTop = 0; });
    const before = await boxes();
    settleRetry();
    await expect(picker.getByText('已获取上游模型清单。', { exact: true })).toBeVisible();
    expect(await boxes()).toEqual(before);
    await expect(picker.getByTestId('upstream-group')).toHaveText('Gemini · 5');
    await expect(picker.getByText('第 1 次刷新：上游清单未列出 4 个模型', { exact: true })).toBeVisible();
    for (const model of [first, ...rest]) {
      const row = rows.and(picker.locator(`[data-model-id="${model.id}"]`));
      const mark = row.getByTestId('upstream-provenance');
      await expect(row).toHaveAttribute('data-model-source', 'missing');
      await expect(mark).toBeVisible();
      await expect(mark).toHaveText('不在最新列表');
      await expect(mark).toHaveAttribute('title', '不在最新列表');
      await expect(row.getByRole('checkbox')).toHaveAccessibleDescription('不在最新列表');
    }
    await expect(rows.nth(1)).toHaveAttribute('data-model-source', 'upstream');
    await expect(rows.nth(1).getByTestId('upstream-provenance')).toBeEmpty();
  });
}

test('all-selected fallback rows keep their own muted provenance at 568x320', async ({ page }) => {
  await page.setViewportSize({ width: 568, height: 320 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const fallbackModels = [UPSTREAM[2]!, UPSTREAM[0]!];
  await mount(page, subscription(fallbackModels));
  let calls = 0;
  await page.route('**/api/teams/t1/antigravity-subscriptions/sub-a1/upstream-models', (route) =>
    route.fulfill({
      json: ++calls === 1
        ? { status: 'fallback', models: fallbackModels, failure: 'network', httpStatus: null }
        : { status: 'ok', models: [fallbackModels[0]] },
    }),
  );
  await page.goto('/app/resources/providers');
  await detail(page).getByTestId('subscription-pick-upstream').click();
  const picker = page.getByRole('dialog', { name: '从上游选择模型' });
  await expect(picker.getByTestId('upstream-group')).toHaveText(['打开时已选']);
  await expect(picker.getByTestId('upstream-group').getByTestId('upstream-provenance')).toHaveCount(0);
  for (const model of fallbackModels) {
    const row = picker.locator(`[data-testid="upstream-model"][data-model-id="${model.id}"]`);
    const mark = row.getByTestId('upstream-provenance');
    await expect(row).toHaveAttribute('data-model-source', 'fallback');
    await expect(row.getByRole('checkbox')).toBeChecked();
    await expect(mark).toHaveText('备用清单，不是上游返回的');
    await expect(mark).toHaveAttribute('title', '备用清单，不是上游返回的');
    await expect(row.getByRole('checkbox')).toHaveAccessibleDescription('备用清单，不是上游返回的');
    await expect(mark).toHaveCSS('white-space', 'nowrap');
    await expect(mark).toHaveCSS('text-overflow', 'ellipsis');
    const lineHeight = await mark.evaluate((node) => parseFloat(getComputedStyle(node).lineHeight));
    expect((await mark.boundingBox())?.height).toBeCloseTo(lineHeight, 1);
    await expect(mark).toHaveClass(/text-meta/);
    await expect(mark).toHaveClass(/text-content-tertiary/);
    await row.scrollIntoViewIfNeeded();
    await expect(row).toBeInViewport({ ratio: 1 });
    await expect(mark).toBeInViewport({ ratio: 1 });
    const bounds = await row.locator('code').boundingBox();
    const markBounds = await mark.boundingBox();
    expect(bounds).not.toBeNull();
    expect(markBounds).not.toBeNull();
    expect(markBounds!.y).toBeGreaterThanOrEqual(bounds!.y + bounds!.height);
  }
  await picker.getByRole('button', { name: '重试', exact: true }).click();
  const confirmed = picker.locator(`[data-model-id="${fallbackModels[0]!.id}"]`);
  const omitted = picker.locator(`[data-model-id="${fallbackModels[1]!.id}"]`);
  await expect(confirmed).toHaveAttribute('data-model-source', 'upstream');
  await expect(confirmed.getByTestId('upstream-provenance')).toBeEmpty();
  await expect(omitted).toHaveAttribute('data-model-source', 'missing');
  await omitted.scrollIntoViewIfNeeded();
  const missingMark = omitted.getByTestId('upstream-provenance');
  await expect(missingMark).toHaveText('不在最新列表');
  await expect(missingMark).toBeInViewport({ ratio: 1 });
  await expect(omitted.getByRole('checkbox')).toBeChecked();
  await expect(picker.getByTestId('upstream-group')).toHaveText(['打开时已选']);
});

test('a failed upstream fetch offers the by-id fallback', async ({ page }) => {
  const patches: object[] = [];
  await mount(page, subscription([]), null, patches);
  await page.goto('/app/resources/providers');
  await detail(page).getByTestId('subscription-pick-upstream').click();
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
