import { expect, type Page, test } from '@playwright/test';
import { evidencePanelShot } from './evidence';

const TEAM = { id: 'team-1', name: 'Team', createdAt: 0, plan: 'free', avatarStyle: null };
const USER = { id: 'user-1', displayName: '我', avatarUrl: null };
const PROJECT = {
  id: 'proj-1616',
  name: 'cairn',
  teamId: 'team-1',
  repoKind: 'hosted',
  repoName: 'cairn',
  githubRepo: null,
  localPath: null,
};
const STARTED_AT = Date.now() - 60_000;
const NO_PRICE_REASON = '无价格来源：模型未声明费率，或该运行未上报费用';

function wireCard(
  id: string,
  seqNum: number,
  title: string,
  extra: Record<string, unknown> = {},
) {
  return {
    id,
    teamId: 'team-1',
    projectId: PROJECT.id,
    title,
    spec: '',
    phase: 'building',
    phaseAt: STARTED_AT,
    seqNum,
    orderIndex: seqNum,
    tagIds: [],
    assignment: null,
    agent: { id: 'agent-1', displayName: 'r3-builder' },
    latestBuildId: `build-${id}`,
    lastRunAt: null,
    hasChanges: false,
    hasPlan: false,
    buildHistory: [{ buildId: `build-${id}`, createdAt: STARTED_AT }],
    sourceTodo: null,
    v: 1,
    ...extra,
  };
}

function usageRow(
  buildId: string,
  model: string,
  tokens: [input: number, output: number, cacheRead: number, cacheWrite: number],
  cost: [input: number, output: number, cacheRead: number, cacheWrite: number],
) {
  const [input, output, cacheRead, cacheWrite] = tokens;
  const [costInput, costOutput, costCacheRead, costCacheWrite] = cost;
  return {
    buildId,
    model,
    input,
    output,
    cacheRead,
    cacheWrite,
    costInput,
    costOutput,
    costCacheRead,
    costCacheWrite,
    costTotal: costInput + costOutput + costCacheRead + costCacheWrite,
  };
}

const USAGE_BY_BUILD: Record<string, ReturnType<typeof usageRow>[]> = {
  'build-todo-priced': [
    usageRow('build-todo-priced', 'r3-gw/claude-sonnet-5', [40_000, 20_000, 800_000, 8_000], [0.05, 0.3, 0.2, 0.025]),
    usageRow('build-todo-priced', 'r3-gw/claude-sonnet-5', [26_000, 13_000, 400_000, 4_000], [0.0325, 0.2, 0.1, 0.0125]),
  ],
  'build-todo-sub-cent': [
    usageRow('build-todo-sub-cent', 'r3-gw/claude-haiku-5', [900, 400, 2_000, 0], [0.001, 0.002, 0.001, 0]),
  ],
  'build-todo-unpriced': [
    usageRow('build-todo-unpriced', 'local/qwen3-coder', [18_000, 6_000, 120_000, 2_000], [0, 0, 0, 0]),
  ],
};

function usageCostOf(buildId: string) {
  const rows = USAGE_BY_BUILD[buildId] ?? [];
  const sum = (pick: (row: (typeof rows)[number]) => number) =>
    rows.reduce((acc, row) => acc + pick(row), 0);
  return {
    input: sum((r) => r.costInput),
    output: sum((r) => r.costOutput),
    cacheRead: sum((r) => r.costCacheRead),
    cacheWrite: sum((r) => r.costCacheWrite),
    total: sum((r) => r.costTotal),
  };
}

const PRICED = wireCard('todo-priced', 21, '有价格的票', {
  usageCost: usageCostOf('build-todo-priced'),
});
const SUB_CENT = wireCard('todo-sub-cent', 22, '不足一分的票', {
  usageCost: usageCostOf('build-todo-sub-cent'),
});
const UNPRICED = wireCard('todo-unpriced', 23, '没有价格来源的票', {
  usageCost: usageCostOf('build-todo-unpriced'),
});
const NEVER_RAN = wireCard('todo-never-ran', 24, '没跑过的票', {
  phase: 'todo',
  agent: null,
  latestBuildId: null,
  buildHistory: [],
});
const ALL = [PRICED, SUB_CENT, UNPRICED, NEVER_RAN];

async function stubWorld(page: Page) {
  await page.route('**/api/**', (route, request) => {
    if (request.method() !== 'GET') return route.fallback();
    return route.fulfill({ status: 500, json: { error: 'e2e stub: not the surface under test' } });
  });
  await page.route('**/api/teams', (route) => route.fulfill({ json: [TEAM] }));
  await page.route('**/api/user/me', (route) => route.fulfill({ json: USER }));
  await page.route('**/api/projects?*', (route) => route.fulfill({ json: [PROJECT] }));
  await page.route('**/api/todos?*', (route) => route.fulfill({ json: ALL }));
  await page.route('**/api/builds/*/usage', (route) => {
    const buildId = new URL(route.request().url()).pathname.split('/')[3] ?? '';
    return route.fulfill({ json: USAGE_BY_BUILD[buildId] ?? [] });
  });
  for (const todo of ALL) {
    await page.route(`**/api/todos/${todo.id}`, (route) => route.fulfill({ json: todo }));
  }
}

const card = (page: Page, todoId: string) => page.locator(`[data-todo-id="${todoId}"]`);

async function openTokenSection(page: Page, todoId: string) {
  await page.goto(`/app/todo/${todoId}`);
  await page.locator('.doc-select-wrap .doc-pane-select').click();
  await page.getByRole('menuitemradio', { name: 'Token 用量' }).click();
  return page.getByTestId('detail-right').getByRole('group', { name: '花费' });
}

for (const theme of ['light', 'dark'] as const) {
  test.describe(theme, () => {
    test.beforeEach(async ({ page }) => {
      await page.addInitScript((t) => localStorage.setItem('cairn-theme', t), theme);
    });

    test('board cards show the summed amount, 「—」 with a reason, or nothing', async ({ page }) => {
      await stubWorld(page);
      await page.goto('/app');
      await expect(card(page, NEVER_RAN.id)).toBeVisible();
      await evidencePanelShot(page, `card-cost-${theme}.png`, card(page, PRICED.id));

      await expect(card(page, PRICED.id).getByTestId('card-cost')).toHaveText('$0.92');
      await expect(card(page, SUB_CENT.id).getByTestId('card-cost')).toHaveText('<$0.01');
      const unpriced = card(page, UNPRICED.id).getByTestId('card-cost');
      await expect(unpriced).toHaveText('—');
      await expect(unpriced).toHaveAttribute('title', NO_PRICE_REASON);
      await expect(card(page, NEVER_RAN.id).getByTestId('card-cost')).toHaveCount(0);

      for (const todo of [PRICED, SUB_CENT, UNPRICED]) {
        const gaps = await card(page, todo.id).evaluate((root) => {
          const amount = root.querySelector('[data-testid="card-cost"]')?.getBoundingClientRect();
          const strip = root.querySelector('.todo-card-meta > div')?.getBoundingClientRect();
          const cardBox = root.getBoundingClientRect();
          if (!amount || !strip) throw new Error('card meta not rendered');
          return { pastStrip: amount.right - strip.right, pastCard: amount.right - cardBox.right };
        });
        expect(gaps.pastStrip).toBeLessThanOrEqual(0);
        expect(gaps.pastCard).toBeLessThanOrEqual(0);
      }
    });

    test('detail: total plus 缓存读取 / 输入 / 输出 from the cost columns', async ({ page }) => {
      await stubWorld(page);
      const cost = await openTokenSection(page, PRICED.id);
      await expect(cost).toBeVisible();
      await evidencePanelShot(page, `detail-cost-${theme}.png`, page.getByTestId('detail-main'), 0);

      const right = page.getByTestId('detail-right');
      await expect(page.getByTestId('detail-title')).toContainText('有价格的票');
      await expect(right).toContainText('r3-gw/claude-sonnet-5');
      await expect(right).toContainText('1200k');
      await expect(cost.getByTestId('cost-total')).toHaveText('$0.92');
      await expect(cost.getByTestId('cost-cache-read')).toHaveText('$0.30');
      await expect(cost.getByTestId('cost-input')).toHaveText('$0.12');
      await expect(cost.getByTestId('cost-output')).toHaveText('$0.50');
      await expect(cost.getByText(NO_PRICE_REASON)).toHaveCount(0);

      const layout = await cost.evaluate((group) => {
        const rows = [...group.children].map((el) => el.getBoundingClientRect());
        const overlaps = rows.slice(1).filter((box, i) => box.top < (rows[i]?.bottom ?? 0) - 0.5);
        const clipped = [...group.querySelectorAll('*')].filter(
          (el) => el.scrollWidth > el.clientWidth + 1,
        );
        const pane = group.closest('[data-testid="detail-right"]')?.getBoundingClientRect();
        const outside = rows.filter((box) => !pane || box.right > pane.right + 0.5);
        return { overlaps: overlaps.length, clipped: clipped.length, outside: outside.length };
      });
      expect(layout).toEqual({ overlaps: 0, clipped: 0, outside: 0 });
    });

    test('detail: no price source reads 「—」 and says why, never $0.00', async ({ page }) => {
      await stubWorld(page);
      const cost = await openTokenSection(page, UNPRICED.id);
      await expect(cost).toBeVisible();
      await expect(cost.getByTestId('cost-total')).toHaveText('—');
      await expect(cost.getByText(NO_PRICE_REASON)).toBeVisible();
      await expect(cost.getByText('$0.00')).toHaveCount(0);
      await expect(cost.getByTestId('cost-input')).toHaveCount(0);
      const reason = await cost.getByText(NO_PRICE_REASON).evaluate((el) => ({
        clipped: el.scrollWidth > el.clientWidth + 1,
        height: el.getBoundingClientRect().height,
      }));
      expect(reason.clipped).toBe(false);
      expect(reason.height).toBeGreaterThan(0);
    });
  });
}

test('detail: a sub-cent total is not rounded to $0.00', async ({ page }) => {
  await stubWorld(page);
  const cost = await openTokenSection(page, SUB_CENT.id);
  await expect(cost.getByTestId('cost-total')).toHaveText('<$0.01');
});
