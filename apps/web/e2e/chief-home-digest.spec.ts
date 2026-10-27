import { expect, test } from '@playwright/test';
import { HISTORY, mockLive, type Row, THREAD } from './chief-home-mock';
import { evidenceShot } from './evidence';

const MEMORY = {
  id: 'mem-1',
  agentId: 'agent-1',
  teamId: 't1',
  title: '发布卡住先查 npm 源',
  content: '发布卡住时先查 npm 源，再看代码',
  projectId: null,
  sourceTodoId: null,
  sourceBuildId: null,
  createdAt: 13,
  updatedAt: 13,
};

const digestRow = (reason: 'daily' | 'threshold', memoryId = MEMORY.id): Row => ({
  id: 'chief-digest-d1',
  role: 'system',
  content: JSON.stringify({
    kind: 'chief_digest',
    reason,
    coversUntil: 12,
    madeAt: 1_800_000_000_000,
    items: [
      {
        group: 'decided',
        text: '空列提示跟 [#9](todo:todo-1) 一起改',
        reason: '你说顺便改，和计数是同一处代码',
      },
      { group: 'done', text: 'cairn-cli 0.2.1 已发布', reason: '卡住的原因是 npm 源超时，不是代码问题' },
      { group: 'open', text: '[#9](todo:todo-1) 还在跑', reason: '等它跑完再确认计数' },
      {
        group: 'remembered',
        text: '发布卡住时先查 npm 源，再看代码',
        reason: '从这次发布学到的，已写进总管的记忆',
        memory: { id: memoryId, agentId: 'agent-1' },
      },
    ],
  }),
  createdAt: 12,
});

const withDigest = (reason: 'daily' | 'threshold', memoryId?: string): Row[] => [
  ...HISTORY.slice(0, 3),
  digestRow(reason, memoryId),
  ...HISTORY.slice(3),
];

async function mockDigest(page: Parameters<typeof mockLive>[0], messages: Row[]) {
  const memories = [MEMORY];
  const deleted: string[] = [];
  await mockLive(page, { threads: [THREAD], messages }, (p, route, json) => {
    if (p === '/api/teams/t1/agents/agent-1/memories') return json(memories);
    if (p.startsWith('/api/teams/t1/agents/agent-1/memories/') && route.request().method() === 'DELETE') {
      const id = p.split('/').pop() ?? '';
      deleted.push(id);
      memories.splice(
        memories.findIndex((m) => m.id === id),
        1,
      );
      return route.fulfill({ status: 204, body: '' });
    }
    return undefined;
  });
  return deleted;
}

test.describe('long-chat summaries on the home chat (T7)', () => {
  test('a divider after the covered messages expands to four groups with reasons; originals stay', async ({
    page,
  }) => {
    await mockDigest(page, withDigest('daily'));
    await page.goto('/app');
    const stream = page.getByTestId('chief-home').getByTestId('chief-stream');
    const toggle = stream.getByRole('button', { name: '总管把昨天的对话整理成了 4 条摘要' });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(stream).toContainText('看板拖完卡片计数不对，修一下');
    await expect(stream).toContainText('已经补给它了');
    const order = await stream.evaluate((el) => {
      const text = el.textContent ?? '';
      return [
        text.indexOf('看板拖完卡片计数不对'),
        text.indexOf('总管把昨天的对话'),
        text.indexOf('顺便把空列的提示'),
      ];
    });
    expect(order[0]).toBeLessThan(order[1] ?? -1);
    expect(order[1]).toBeLessThan(order[2] ?? -1);
    const card = stream.getByTestId('chief-digest-card');
    await expect(card).toBeHidden();
    await evidenceShot(page, 'digest-divider.png');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(card).toBeVisible();
    await expect(card).toContainText('昨天的摘要');
    const groups = card.getByTestId('chief-digest-group');
    await expect(groups).toHaveCount(4);
    await expect(groups.nth(0)).toContainText('决定');
    await expect(groups.nth(0)).toContainText('你说顺便改，和计数是同一处代码');
    await expect(groups.nth(1)).toContainText('完成');
    await expect(groups.nth(1)).toContainText('不是代码问题');
    await expect(groups.nth(2)).toContainText('还开着');
    await expect(groups.nth(3)).toContainText('记住了');
    await expect(groups.nth(3)).toContainText('已写进总管的记忆');
    await expect(card).toContainText('原文都还在');
    await expect(card.locator('a.mention-chip--todo').first()).toHaveAttribute('data-phase', 'building');
    await toggle.evaluate((el) => el.scrollIntoView({ block: 'start' }));
    await evidenceShot(page, 'digest-open.png');
  });

  test('a remembered item links to its memory row and can be deleted from the card', async ({
    page,
  }) => {
    const deleted = await mockDigest(page, withDigest('daily'));
    await page.goto('/app');
    const stream = page.getByTestId('chief-home').getByTestId('chief-stream');
    await stream.getByRole('button', { name: /整理成了 4 条摘要/ }).click();
    const item = stream.getByTestId('chief-digest-item').filter({ hasText: '先查 npm 源' });
    await expect(item.getByRole('link', { name: '查看这条记忆' })).toHaveAttribute(
      'href',
      '/app/resources/agents/agent-1?tab=memory#memory-mem-1',
    );
    await item.getByRole('button', { name: '让总管忘掉这条' }).click();
    await expect.poll(() => deleted).toEqual(['mem-1']);
    await expect(item).toHaveAttribute('data-gone', '');
    await expect(item).toContainText('已忘掉');
    await expect(item.getByRole('button', { name: '让总管忘掉这条' })).toHaveCount(0);
    await evidenceShot(page, 'digest-forgot.png');
  });

  test('the memory link opens the memory tab with that row in view', async ({ page }) => {
    await mockDigest(page, withDigest('daily'));
    await page.goto('/app');
    const stream = page.getByTestId('chief-home').getByTestId('chief-stream');
    await stream.getByRole('button', { name: /整理成了 4 条摘要/ }).click();
    await stream.getByRole('link', { name: '查看这条记忆' }).click();
    await expect(page).toHaveURL(/\/app\/resources\/agents\/agent-1\?tab=memory#memory-mem-1$/);
    await expect(page.locator('#memory-mem-1')).toBeVisible();
    await expect(page.locator('#memory-mem-1')).toContainText('发布卡住时先查 npm 源');
  });

  test('a memory deleted elsewhere shows as forgotten without a delete button', async ({ page }) => {
    await mockDigest(page, withDigest('daily', 'mem-gone'));
    await page.goto('/app');
    const stream = page.getByTestId('chief-home').getByTestId('chief-stream');
    await stream.getByRole('button', { name: /整理成了 4 条摘要/ }).click();
    const item = stream.getByTestId('chief-digest-item').filter({ hasText: '先查 npm 源' });
    await expect(item).toHaveAttribute('data-gone', '');
    await expect(item.getByRole('button', { name: '让总管忘掉这条' })).toHaveCount(0);
  });

  test('a threshold digest says the chat got long', async ({ page }) => {
    await mockDigest(page, withDigest('threshold'));
    await page.goto('/app');
    const stream = page.getByTestId('chief-home').getByTestId('chief-stream');
    await stream.getByRole('button', { name: '对话太长了，总管把上面的内容整理成了 4 条摘要' }).click();
    await expect(stream.getByTestId('chief-digest-card')).toContainText('上面内容的摘要');
  });

  test('a digest with nothing worth keeping shows no divider', async ({ page }) => {
    const empty = { ...digestRow('daily'), content: JSON.stringify({ kind: 'chief_digest', reason: 'daily', coversUntil: 12, madeAt: 1, items: [] }) };
    await mockDigest(page, [...HISTORY.slice(0, 3), empty, ...HISTORY.slice(3)]);
    await page.goto('/app');
    const stream = page.getByTestId('chief-home').getByTestId('chief-stream');
    await expect(stream).toContainText('已经补给它了');
    await expect(stream.getByTestId('chief-digest')).toHaveCount(0);
  });

  test('phone width: the open card fits the screen', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockDigest(page, withDigest('daily'));
    await page.goto('/app');
    const stream = page.getByTestId('chief-home').getByTestId('chief-stream');
    await stream.getByRole('button', { name: /整理成了 4 条摘要/ }).click();
    await stream.getByTestId('chief-digest-card').scrollIntoViewIfNeeded();
    const width = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(width).toBeLessThanOrEqual(390);
    await evidenceShot(page, 'digest-phone.png');
  });
});
