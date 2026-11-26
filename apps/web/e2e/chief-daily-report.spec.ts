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

const ZONE = 'Asia/Shanghai';
const TODAY = new Intl.DateTimeFormat('en-CA', { timeZone: ZONE }).format(Date.now());

test.describe('read-only historical daily reports', () => {
  test.use({ viewport: { width: 1280, height: 1500 }, timezoneId: ZONE });

  test('the historical document preserves facts and task links without offering decisions', async ({
    page,
  }) => {
    const decisions: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/retro-proposals/')) decisions.push(request.url());
    });
    await mockLive(page, { threads: [THREAD], messages: [...HISTORY, reportRow()] });
    await page.goto('/app');
    const row = page.getByTestId('home-c').getByTestId('chief-report');
    await expect(row.getByTestId('chief-report-sentence')).toHaveText(
      '2026-10-27 的历史日报：完成 1 · 合并 1 · 失败 1',
    );
    await expect(row.getByRole('button')).toHaveCount(1);
    const card = row.getByTestId('research-report-card');
    await expect(card).toHaveText('2026-10-27');
    await expect(card).not.toHaveAttribute('data-stage');
    await row.scrollIntoViewIfNeeded();
    await evidencePanelShot(page, 'daily-report.png', row);
    await card.click();
    const doc = page.getByTestId('research-report-doc');
    await expect(page.getByTestId('research-report-meta')).toHaveText(/^历史日报/);
    await expect(page.getByTestId('research-report-meta')).not.toContainText('定稿');
    await expect(doc).toContainText('昨天（2026-10-26）的进展');
    await expect(doc).toContainText(
      '完成 1 · 合并 1 · 失败 1 · 重新运行 2 · 等额度 0 · 审查通过 3 / 拦下 1',
    );
    await expect(doc.getByRole('link', { name: 'PR 77 · 修复看板拖拽后计数不刷新' })).toHaveAttribute(
      'href',
      'https://github.com/o/r/pull/77',
    );
    await expect(doc).toContainText('写日报时有 2 件等你，现在的情况看任务面板。');
    const items = doc.getByTestId('md-list-ordered').locator(':scope > li');
    await expect(items).toHaveCount(2);
    await expect(items.first()).toContainText('看板计数加回归测试 · 未处理（只读）');
    await expect(items.first()).toContainText('防护：加一个 e2e 断言计数与服务端一致');
    await expect(items.first().getByRole('link', { name: '#9 修复看板拖拽后计数不刷新' })).toHaveAttribute(
      'href',
      '/app?thread=todo-1',
    );
    await expect(items.nth(1)).toContainText('协调者先查状态再答 · 未处理（只读）');
    await expect(doc).toContainText('历史记录，仅供查看；日报已停用，不再生成或处理建议。');
    await expect(doc).not.toContainText('第 1 条建线程');
    await expect(doc).not.toContainText('待你决定');
    await expect(doc).toContainText('这些来源太长，只读了后面的部分：#12 大线程。');
    await expect(doc.getByRole('button', { name: '建成线程' })).toHaveCount(0);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await evidencePanelShot(page, 'daily-report-document.png', page.getByTestId('artifact-panel'));
    expect(decisions).toEqual([]);
  });

  test('old outside developments stay hidden while retro suggestions keep their numbering', async ({ page }) => {
    const retro = [{ ...proposal('rp-1', '复盘 1'), status: 'accepted', todoId: 'todo-1' }];
    await mockLive(page, {
      threads: [THREAD],
      messages: [
        ...HISTORY,
        reportRow({
          retro,
          intake: [
            intakeItem('in-1', 'accepted', 'todo-in-1'),
            intakeItem('in-2', 'dismissed'),
            intakeItem('in-3', 'draft'),
            intakeItem('in-4', 'draft'),
            intakeItem('in-5', 'draft'),
          ],
        }),
      ],
    });
    await page.goto('/app');
    const row = page.getByTestId('home-c').getByTestId('chief-report');
    await expect(row.getByTestId('chief-report-sentence')).not.toContainText('等你决定');
    await row.getByTestId('research-report-card').click();
    const doc = page.getByTestId('research-report-doc');
    const lists = doc.getByTestId('md-list-ordered');
    await expect(lists).toHaveCount(1);
    await expect(lists.locator(':scope > li')).toHaveCount(1);
    await expect(doc).not.toContainText('第 1 条不用了');
    await expect(doc.getByRole('link', { name: '复盘 1' })).toHaveAttribute('href', '/app?thread=todo-1');
    await expect(doc).toContainText('已建成任务');
    await expect(doc).not.toContainText('外部动态');
    await expect(doc.getByRole('link', { name: 'example.com' })).toHaveCount(0);
    await evidencePanelShot(page, 'daily-report-retired-intake.png', page.getByTestId('artifact-panel'));
  });

  test('a failed run says so in the chat line and the document has the raw numbers only', async ({
    page,
  }) => {
    await mockLive(page, {
      threads: [THREAD],
      messages: [...HISTORY, reportRow({ status: 'retrying', retro: [], retroRan: false, truncated: [] })],
    });
    await page.goto('/app');
    const row = page.getByTestId('home-c').getByTestId('chief-report');
    await expect(row.getByTestId('chief-report-sentence')).toHaveText(
      '2026-10-27 的历史日报未完成：完成 1 · 合并 1 · 失败 1',
    );
    await row.getByTestId('research-report-card').click();
    const doc = page.getByTestId('research-report-doc');
    await expect(doc).toContainText('历史记录，仅供查看；日报已停用，不再生成或处理建议。');
    await expect(doc).not.toContainText('再试');
    await expect(doc).toContainText('完成 1');
    await expect(doc).not.toContainText('复盘建议');
  });

  test('even a record dated today is shown as historical, not a new daily promise', async ({
    page,
  }) => {
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
    const sentence = page
      .getByTestId('home-c')
      .getByTestId('chief-report')
      .getByTestId('chief-report-sentence');
    await mockLive(page, {
      threads: [THREAD],
      messages: [
        ...HISTORY,
        reportRow({ day: TODAY, yesterday: quiet, retro: [], truncated: [] }),
      ],
    });
    await page.goto('/app');
    await expect(sentence).toHaveText(`${TODAY} 的历史日报：完成 0 · 合并 0 · 失败 0`);
    await mockLive(page, {
      threads: [THREAD],
      messages: [...HISTORY, reportRow({ yesterday: quiet, retro: [], truncated: [] })],
    });
    await page.goto('/app');
    await expect(sentence).toHaveText('2026-10-27 的历史日报：完成 0 · 合并 0 · 失败 0');
  });
});
