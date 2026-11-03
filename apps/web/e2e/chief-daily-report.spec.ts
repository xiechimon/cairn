import { expect, test } from '@playwright/test';
import { HISTORY, mockLive, type Row, THREAD } from './chief-home-mock';
import { evidencePanelShot } from './evidence';

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

const reportRow = (overrides: Record<string, unknown> = {}): Row => ({
  id: 'chief-report-r1',
  role: 'system',
  content: JSON.stringify({
    kind: 'chief_daily_report',
    day: '2026-10-27',
    covers: '2026-10-26',
    status: 'posted',
    madeAt: 30,
    yesterday: ledger,
    needsYou: { count: 2, todos: [{ id: 'todo-2', seq: 10, title: '迁移脚本' }], questions: 1 },
    retro: [proposal('rp-1', '看板计数加回归测试'), proposal('rp-2', '协调者先查状态再答')],
    retroRan: true,
    truncated: ['#12 大线程'],
    ...overrides,
  }),
  createdAt: 30,
});

test.describe('daily 08:00 report in the Coordinator chat (#2592)', () => {
  test.use({ viewport: { width: 1280, height: 1500 } });

  test('shows yesterday, needs-you count, and draft retro proposals that ian decides', async ({
    page,
  }) => {
    const decisions: string[] = [];
    await mockLive(page, { threads: [THREAD], messages: [...HISTORY, reportRow()] }, (p, route, json) => {
      const match = /^\/api\/teams\/t1\/chief\/retro-proposals\/([^/]+)\/(accept|dismiss)$/.exec(p);
      if (match === null || route.request().method() !== 'POST') return undefined;
      decisions.push(`${match[1]}:${match[2]}`);
      return json({
        ...proposal(match[1] ?? '', 'x'),
        status: match[2] === 'accept' ? 'accepted' : 'dismissed',
        todoId: match[2] === 'accept' ? 'todo-new' : null,
      });
    });
    await page.goto('/app');
    const card = page.getByTestId('home-c').getByTestId('chief-report');
    await expect(card).toContainText('今天的日报 · 昨天（2026-10-26）');
    await expect(card.getByTestId('chief-report-yesterday')).toContainText(
      '完成 1 · 合并 1 · 失败 1 · 重跑 2 · 等额度 0 · 审查通过 3 / 拦下 1',
    );
    await expect(card.getByRole('link', { name: /PR 77/ })).toHaveAttribute(
      'href',
      'https://github.com/o/r/pull/77',
    );
    await expect(card.getByTestId('chief-report-needs-you')).toContainText('2 件等你，去处理');
    await expect(card).toContainText('这些来源太长，只读了后面的部分：#12 大线程。');
    const proposals = card.getByTestId('chief-report-proposal');
    await expect(proposals).toHaveCount(2);
    await expect(proposals.first()).toContainText('防护：加一个 e2e 断言计数与服务端一致');
    await card.scrollIntoViewIfNeeded();
    await evidencePanelShot(page, 'daily-report.png', card);
    await proposals.first().getByRole('button', { name: '建成线程' }).click();
    await expect(proposals.first()).toHaveAttribute('data-status', 'accepted');
    await expect(proposals.first().getByRole('link', { name: '已建成线程' })).toHaveAttribute(
      'href',
      '/app?thread=todo-new',
    );
    await proposals.nth(1).getByRole('button', { name: '不用了' }).click();
    await expect(proposals.nth(1)).toHaveAttribute('data-status', 'dismissed');
    expect(decisions).toEqual(['rp-1:accept', 'rp-2:dismiss']);
    await card.scrollIntoViewIfNeeded();
    await evidencePanelShot(page, 'daily-report-decided.png', card);
  });

  test('a failed run shows the notice with the raw numbers and no retro', async ({ page }) => {
    await mockLive(page, {
      threads: [THREAD],
      messages: [...HISTORY, reportRow({ status: 'retrying', retro: [], retroRan: false, truncated: [] })],
    });
    await page.goto('/app');
    const card = page.getByTestId('home-c').getByTestId('chief-report');
    await expect(card.getByTestId('chief-report-notice')).toContainText('日报没写成');
    await expect(card.getByTestId('chief-report-yesterday')).toContainText('完成 1');
    await expect(card.getByTestId('chief-report-retro')).toHaveCount(0);
    await card.scrollIntoViewIfNeeded();
    await evidencePanelShot(page, 'daily-report-notice.png', card);
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
        reportRow({
          yesterday: quiet,
          needsYou: { count: 1, todos: [], questions: 1 },
          retro: [],
          truncated: [],
        }),
      ],
    });
    await page.goto('/app');
    const line = page.getByTestId('home-c').getByTestId('chief-report');
    await expect(line).toHaveAttribute('data-variant', 'one-line');
    await expect(line).toHaveText('今天的日报：昨天没有新进展。1 件等你');
  });
});
