import { expect, type Page, test } from '@playwright/test';
import { mockLive, TASK, THREAD } from './chief-home-mock';

const now = Date.now();

const note = '优惠现在按整单只算一次，再分摊到每一行。';

const glance = {
  todoId: TASK.id,
  path: 'apps/server/src/services/coupon-split.ts',
  lines: [
    { kind: 'context', old: 15, new: 15, text: 'export function splitCoupon(lines, coupon) {' },
    { kind: 'del', old: 16, text: '  return lines.map((line) => roundCents(line.total * coupon.rate))' },
    { kind: 'add', new: 16, text: '  const orderTotal = lines.reduce((sum, line) => sum + line.total, 0)' },
    { kind: 'note', text: note },
    { kind: 'gap', text: '' },
    { kind: 'add', new: 44, text: '  shares[shares.length - 1] += gap' },
  ],
};

const chart = {
  type: 'bar',
  title: '接口 p95 延迟，改前与改后',
  unit: '毫秒',
  categories: ['任务列表', '构建详情', '搜索'],
  series: [
    { name: '改前', values: [820, 1240, 960], role: 'before' },
    { name: '改后', values: [210, 380, 450], role: 'after' },
  ],
  summary: '三个接口平均降了 64%。',
};

const blockRow = (id: string, name: string, block: unknown, at: number, pending = false) => ({
  id,
  role: 'assistant',
  content: {
    kind: 'toolcall',
    call: {
      id: `c-${id}`,
      name,
      arguments: {},
      startedAt: at,
      ...(pending
        ? {}
        : { result: [{ type: 'text', text: JSON.stringify(block) }], endedAt: at + 200 }),
    },
  },
  createdAt: at,
});

const user = { id: 'u1', role: 'user', content: '把改动给我看一眼', createdAt: now - 60_000 };

async function open(page: Page, messages: unknown[], routes?: () => Promise<void>) {
  await mockLive(page, { threads: [THREAD], messages: messages as never, todos: [TASK] });
  await routes?.();
  await page.goto('/app');
  await expect(page.getByTestId('chief-stream')).toBeVisible();
}

test('a show_diff reply shows one file, its key lines with +/− marks, the one-sentence note under the lines it explains, and a way to open the task', async ({
  page,
}) => {
  await open(page, [
    user,
    blockRow('d1', 'show_diff', { block: 'diff', glance, fallbackMarkdown: '' }, now - 50_000),
    { id: 'r1', role: 'assistant', content: '你看没问题我就合并。', createdAt: now - 49_000 },
  ]);
  const block = page.getByTestId('diff-glance');
  await expect(block.getByTestId('glance-head')).toContainText('coupon-split.ts');
  await expect(block.getByTestId('glance-head')).toContainText('apps/server/src/services');
  await expect(block.locator('[data-kind="add"]')).toHaveCount(2);
  await expect(block.locator('[data-kind="add"] [data-slot="diff-mark"]').first()).toHaveText('+');
  await expect(block.getByTestId('glance-note')).toHaveText(note);
  const addBottom = await block.locator('[data-kind="add"]').first().boundingBox();
  const noteBox = await block.getByTestId('glance-note').boundingBox();
  const secondAdd = await block.locator('[data-kind="add"]').last().boundingBox();
  expect(noteBox?.y ?? 0).toBeGreaterThan((addBottom?.y ?? 0) + (addBottom?.height ?? 0) - 1);
  expect(noteBox?.y ?? 0).toBeLessThan(secondAdd?.y ?? 0);
  await expect(block.getByRole('button')).toHaveCount(0);
  await block.getByTestId('glance-open').click();
  await expect(page).toHaveURL(new RegExp(`thread=${TASK.id}`));
});

test('a show_diff still running shows the skeleton in the same place', async ({ page }) => {
  await open(page, [user, blockRow('d1', 'show_diff', null, now - 50_000, true)]);
  await expect(page.getByTestId('diff-glance-skeleton')).toBeVisible();
});

test('a diff fence the Coordinator writes uses the same glance, named by its +++ line', async ({
  page,
}) => {
  const fence = [
    '改了代理端口：',
    '',
    '```diff',
    '--- a/apps/web/vite.config.ts',
    '+++ b/apps/web/vite.config.ts',
    '@@ -18,3 +18,3 @@',
    '   proxy: {',
    "-    '/api': 'http://localhost:8787',",
    "+    '/api': 'http://localhost:8791',",
    '```',
  ].join('\n');
  await open(page, [user, { id: 'r1', role: 'assistant', content: fence, createdAt: now - 50_000 }]);
  const block = page.getByTestId('diff-glance');
  await expect(block).toContainText('vite.config.ts');
  await expect(block.locator('[data-kind="del"]')).toHaveCount(1);
  await expect(page.getByTestId('md-code-block')).toHaveCount(0);
  const column = await page.getByTestId('chief-reply').boundingBox();
  const width = (await block.boundingBox())?.width ?? 0;
  expect(width, 'a fenced diff spans the chat column like a show_diff block').toBeCloseTo(
    column?.width ?? -1,
    0,
  );
});

test('a show_chart reply draws the chart, toggles a series and opens the same data as a table', async ({
  page,
}) => {
  await open(page, [
    user,
    blockRow('c1', 'show_chart', { block: 'chart', chart, fallbackMarkdown: '' }, now - 50_000),
  ]);
  const figure = page.getByTestId('chat-chart');
  await expect(figure).toContainText('接口 p95 延迟');
  const pills = figure.getByTestId('chat-chart-series');
  await expect(pills).toHaveCount(2);
  await pills.first().click();
  await expect(pills.first()).toHaveAttribute('aria-pressed', 'false');
  await pills.last().click();
  await expect(pills.last()).toHaveAttribute('aria-pressed', 'true');
  await figure.getByTestId('chat-chart-table-toggle').click();
  await expect(figure.getByTestId('chat-chart-table').last()).toBeVisible();
  await expect(figure.getByTestId('chat-chart-table').last()).toContainText('1,240');
});
