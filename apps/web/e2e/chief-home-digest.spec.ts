import { expect, test } from '@playwright/test';
import { HISTORY, mockLive, type Row, THREAD } from './chief-home-mock';

const digestRow = (id: string, reason: 'daily' | 'threshold'): Row => ({
  id,
  role: 'system',
  content: JSON.stringify({
    kind: 'chief_digest',
    reason,
    coversUntil: 12,
    madeAt: 1_800_000_000_000,
    items: [
      { group: 'decided', text: '空列提示跟计数一起改', reason: '你说顺便改' },
      { group: 'open', text: '计数还在跑', reason: '等它跑完再确认' },
    ],
  }),
  createdAt: 12,
});

test('the Coordinator keeps its chat summaries to itself: no summary row, the original messages stay', async ({
  page,
}) => {
  await mockLive(page, {
    threads: [THREAD],
    messages: [
      ...HISTORY.slice(0, 3),
      digestRow('chief-digest-d1', 'daily'),
      ...HISTORY.slice(3),
      digestRow('chief-digest-d2', 'threshold'),
    ],
  });
  await page.goto('/app');
  const stream = page.getByTestId('home-c').getByTestId('chief-stream');
  await expect(stream).toContainText('看板拖完卡片计数不对，修一下');
  await expect(stream).toContainText('已经补给它了');
  await expect(stream).not.toContainText('摘要');
  await expect(stream).not.toContainText('空列提示跟计数一起改');
  await expect(stream).not.toContainText('chief_digest');
});
