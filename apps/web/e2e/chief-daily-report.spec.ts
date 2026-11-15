import { expect, test } from '@playwright/test';
import { HISTORY, mockLive, type Row, THREAD } from './chief-home-mock';
import { evidenceShot } from './evidence';

const ledger = {
  finished: [{ id: 'todo-1', seq: 9, title: '修复看板拖拽后计数不刷新' }],
  finishedCount: 1,
  merged: [
    {
      id: 'todo-1',
      seq: 9,
      title: '修复看板拖拽后计数不刷新',
      prNumber: 77,
      prUrl: 'https://github.com/o/r/pull/77',
    },
  ],
  mergedCount: 1,
  failed: [{ id: 'todo-2', seq: 10, title: '迁移脚本' }],
  failedCount: 1,
  retries: 2,
  quotaWaits: 0,
  verdicts: { pass: 3, block: 1 },
};

const proposal = (id: string, title: string) => ({
  id,
  title,
  what: 'ian 纠正了计数的数据来源',
  why: '没有测试比对前后端计数',
  safeguard: '加一个 e2e 断言计数与服务端一致',
  source: { kind: 'thread', id: 'm-ian', label: '#9 修复看板拖拽后计数不刷新', todoId: 'todo-1' },
  projectId: 'proj-1',
  status: 'draft',
  todoId: null,
});

const intakeItem = (id: string, status: string, todoId: string | null = null) => ({
  id,
  url: `https://example.com/posts/${id}`,
  claim: `外部动态 ${id}：新的并行评审做法`,
  matches: '#9 修复看板拖拽后计数不刷新',
  action: '在评审步骤里试一次并行评审',
  projectId: 'proj-1',
  status,
  todoId,
});

const reportRow = (overrides: Record<string, unknown> = {}): Row => ({
  id: 'chief-report-r1',
  role: 'system',
  content: JSON.stringify({
    kind: 'chief_daily_report',
    day: '2026-10-27',
    covers: '2026-10-26',
    status: 'posted',
    madeAt: Date.now(),
    yesterday: ledger,
    needsYou: { count: 2, todos: [{ id: 'todo-2', seq: 10, title: '迁移脚本' }], questions: 1 },
    retro: [proposal('rp-1', '看板计数加回归测试'), proposal('rp-2', '协调者先查状态再答')],
    retroRan: true,
    truncated: ['#12 大线程'],
    ...overrides,
  }),
  createdAt: 30,
});

const decideRoute =
  (decisions: string[], answer: (id: string, accepted: boolean) => unknown) =>
  (p: string, route: { request: () => { method: () => string } }, json: (body: unknown) => unknown) => {
    const match = /^\/api\/teams\/t1\/chief\/retro-proposals\/([^/]+)\/(accept|dismiss)$/.exec(p);
    if (match === null || route.request().method() !== 'POST') return undefined;
    decisions.push(`${match[1]}:${match[2]}`);
    return json(answer(match[1] ?? '', match[2] === 'accept'));
  };

test.describe('daily 08:00 report in the Coordinator chat (#2592)', () => {
  test('the report is one line; its drafts open in a dialog where ian decides them', async ({ page }) => {
    const decisions: string[] = [];
    await mockLive(
      page,
      { threads: [THREAD], messages: [...HISTORY, reportRow()] },
      decideRoute(decisions, (id, accepted) => ({
        ...proposal(id, 'x'),
        status: accepted ? 'accepted' : 'dismissed',
        todoId: accepted ? 'todo-new' : null,
      })),
    );
    await page.goto('/app');
    const stream = page.getByTestId('home-c').getByTestId('chief-stream');
    const line = stream.getByTestId('chief-report');
    await expect(line).toHaveText('今天的日报：完成 1 · 合并 1 · 失败 1 · 2 条建议等你决定 →');
    await expect(stream).not.toContainText('为什么没拦住');
    await expect(stream).not.toContainText('等你的事');
    await evidenceShot(page, 'daily-report-line.png');
    const viewport = page.locator('[data-slot="message-scroller-viewport"]').first();
    const before = await viewport.evaluate((el) => el.scrollTop);
    await line.getByTestId('chief-report-open').click();
    const dialog = page.getByRole('dialog', { name: '等你决定的建议' });
    await expect(dialog).toContainText('来自 2026-10-26 的日报');
    const proposals = dialog.getByTestId('chief-report-proposal');
    await expect(proposals).toHaveCount(2);
    await expect(proposals.first()).toContainText('为什么没拦住：没有测试比对前后端计数');
    await expect(proposals.first()).toContainText('防护：加一个 e2e 断言计数与服务端一致');
    expect(await viewport.evaluate((el) => el.scrollTop)).toBe(before);
    await evidenceShot(page, 'daily-report-dialog.png');
    await proposals.first().getByRole('button', { name: '建成线程' }).click();
    await expect(proposals.first()).toHaveAttribute('data-status', 'accepted');
    await expect(proposals.first().getByRole('link', { name: '已建成线程' })).toHaveAttribute(
      'href',
      '/app?thread=todo-new',
    );
    await proposals.nth(1).getByRole('button', { name: '不用了' }).click();
    await expect(proposals.nth(1)).toHaveAttribute('data-status', 'dismissed');
    expect(decisions).toEqual(['rp-1:accept', 'rp-2:dismiss']);
  });

  test('the dialog lists only undecided outside developments, decided like retro items', async ({
    page,
  }) => {
    const decisions: string[] = [];
    await mockLive(
      page,
      {
        threads: [THREAD],
        messages: [
          ...HISTORY,
          reportRow({
            retro: [],
            intake: [
              intakeItem('in-1', 'accepted', 'todo-in-1'),
              intakeItem('in-2', 'dismissed'),
              intakeItem('in-3', 'draft'),
            ],
          }),
        ],
      },
      decideRoute(decisions, (id, accepted) => ({
        ...intakeItem(id, accepted ? 'accepted' : 'dismissed'),
        todoId: accepted ? 'todo-in-3' : null,
      })),
    );
    await page.goto('/app');
    const line = page.getByTestId('home-c').getByTestId('chief-report');
    await expect(line).toContainText('1 条建议等你决定 →');
    await line.getByTestId('chief-report-open').click();
    const dialog = page.getByRole('dialog', { name: '等你决定的建议' });
    await expect(dialog.getByTestId('chief-report-retro')).toHaveCount(0);
    const items = dialog.getByTestId('chief-report-intake-item');
    await expect(items).toHaveCount(1);
    const link = items.first().getByRole('link', { name: 'example.com' });
    await expect(link).toHaveAttribute('href', 'https://example.com/posts/in-3');
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    await expect(items.first()).toContainText('建议动作：在评审步骤里试一次并行评审');
    await items.first().getByRole('button', { name: '建成线程' }).click();
    await expect(items.first().getByRole('link', { name: '已建成线程' })).toHaveAttribute(
      'href',
      '/app?thread=todo-in-3',
    );
    expect(decisions).toEqual(['in-3:accept']);
  });

  test('a report older than a week keeps its numbers but offers no drafts', async ({ page }) => {
    await mockLive(page, {
      threads: [THREAD],
      messages: [...HISTORY, reportRow({ madeAt: Date.now() - 8 * 24 * 60 * 60 * 1000 })],
    });
    await page.goto('/app');
    const line = page.getByTestId('home-c').getByTestId('chief-report');
    await expect(line).toHaveText('今天的日报：完成 1 · 合并 1 · 失败 1');
    await expect(line.getByTestId('chief-report-open')).toHaveCount(0);
  });

  test('a failed run is one line with the raw numbers', async ({ page }) => {
    await mockLive(page, {
      threads: [THREAD],
      messages: [...HISTORY, reportRow({ status: 'retrying', retro: [], retroRan: false, truncated: [] })],
    });
    await page.goto('/app');
    const line = page.getByTestId('home-c').getByTestId('chief-report');
    await expect(line).toHaveText('日报没写成，昨天：完成 1 · 合并 1 · 失败 1');
  });

  test('a quiet yesterday is one line', async ({ page }) => {
    const quiet = {
      finished: [],
      finishedCount: 0,
      merged: [],
      mergedCount: 0,
      failed: [],
      failedCount: 0,
      retries: 0,
      quotaWaits: 0,
      verdicts: { pass: 0, block: 0 },
    };
    await mockLive(page, {
      threads: [THREAD],
      messages: [
        ...HISTORY,
        reportRow({ yesterday: quiet, needsYou: { count: 1, todos: [], questions: 1 }, retro: [], truncated: [] }),
      ],
    });
    await page.goto('/app');
    await expect(page.getByTestId('home-c').getByTestId('chief-report')).toHaveText(
      '今天的日报：昨天没有新进展',
    );
  });

  test('phone width: the line and the dialog fit the screen', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockLive(page, { threads: [THREAD], messages: [...HISTORY, reportRow()] });
    await page.goto('/app');
    await page.getByTestId('home-c').getByTestId('chief-report-open').click();
    await expect(page.getByRole('dialog', { name: '等你决定的建议' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  });
});
