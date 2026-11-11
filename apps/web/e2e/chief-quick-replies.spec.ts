import { expect, type Page, test } from '@playwright/test';
import { type MockState, mockLive, type Row, THREAD, toolRow } from './chief-home-mock';

const REPLIES = ['好，等你汇报', '先只看 README'];

const TURN: Row[] = [
  { id: 'u1', role: 'user', content: '帮我看一遍这个仓库，建一个测试任务', createdAt: 10 },
  toolRow('c1', 'suggest_replies', { replies: REPLIES }, 11),
  {
    id: 'quick-replies-s1',
    role: 'system',
    content: JSON.stringify({ kind: 'quick_replies', stepId: 's1', replies: REPLIES }),
    createdAt: 12,
  },
  {
    id: 's1-e3',
    role: 'assistant',
    content: [{ type: 'text', text: '读完后我会汇报技术栈和最近的提交。要不要先只看 README？' }],
    createdAt: 13,
  },
];

const pendingQuestion: Row = {
  id: 'row-ask-0000000a',
  role: 'assistant',
  createdAt: 14,
  content: JSON.stringify({
    kind: 'ask_user_question',
    requestId: 'ask-0000000a',
    status: 'pending',
    questions: [{ header: '范围', question: '先看哪部分？', options: [{ label: 'README' }] }],
    answers: null,
  }),
};

const chips = (page: Page) =>
  page.getByTestId('home-c').getByTestId('chief-quick-replies').getByTestId('chief-quick-reply');

function state(over: Partial<MockState> = {}): MockState {
  return { threads: [THREAD], messages: [...TURN], todos: [], ...over };
}

test('shows the latest reply suggestions above the composer as keyboard-reachable buttons', async ({
  page,
}) => {
  await mockLive(page, state());
  await page.goto('/app');
  await expect(chips(page)).toHaveText(REPLIES);
  await expect(page.getByRole('group', { name: '建议回复' })).toBeVisible();
  await expect(page.getByText('suggest_replies')).toHaveCount(0);
  const group = await page.getByTestId('chief-quick-replies').boundingBox();
  const composer = await page.getByTestId('home-c').getByTestId('chief-composer-input').boundingBox();
  expect(group!.y + group!.height).toBeLessThanOrEqual(composer!.y);
  const card = await page.getByTestId('home-c').locator('.chief-composer').boundingBox();
  expect(card!.y - (group!.y + group!.height)).toBeGreaterThanOrEqual(6);
  expect(card!.y - (group!.y + group!.height)).toBeLessThanOrEqual(12);
  const reply = await page.getByTestId('home-c').getByText('要不要先只看 README？').boundingBox();
  expect(group!.y - (reply!.y + reply!.height)).toBeGreaterThanOrEqual(12);
  expect(group!.y - (reply!.y + reply!.height)).toBeLessThanOrEqual(32);
  await chips(page).first().focus();
  await expect(chips(page).first()).toBeFocused();
});

test('clicking a chip sends exactly its text as an owner message and the chips go away', async ({
  page,
}) => {
  const sent = await mockLive(page, state());
  await page.goto('/app');
  await chips(page).nth(1).click();
  await expect.poll(() => sent).toEqual(['先只看 README']);
  await expect(page.getByTestId('chief-quick-replies')).toHaveCount(0);
  await expect(page.getByTestId('home-c').getByTestId('chief-composer-input')).toHaveValue('');
});

test('a pending question hides the chips: the question dock wins', async ({ page }) => {
  await mockLive(page, state({ messages: [...TURN, pendingQuestion] }));
  await page.goto('/app');
  await expect(page.getByTestId('chief-composer-block').getByTestId('chief-question-card')).toBeVisible();
  await expect(page.getByTestId('chief-quick-replies')).toHaveCount(0);
});

const STREAM = `/api/conversations/${THREAD.id}/stream`;

async function runningActivity(page: Page, stepId: string) {
  await expect
    .poll(() => page.evaluate((u) => window.__es.some((es) => es.url.includes(u)), STREAM))
    .toBe(true);
  await page.evaluate(
    ([u, id]) =>
      window.__es
        .find((es) => es.url.includes(u as string))
        ?.emit({
          type: 'activity',
          activity: { stepId: id, at: Date.now(), phase: 'tool', tool: 'bash' },
        }),
    [STREAM, stepId] as const,
  );
}

test('chips stay while the turn that offered them is still running', async ({ page }) => {
  const running = [{ ...THREAD, activeRun: { phase: 'chief' } }];
  await mockLive(page, state({ threads: running as unknown as MockState['threads'] }));
  await page.goto('/app');
  await expect(page.getByTestId('home-c').getByText('要不要先只看 README？')).toBeVisible();
  await expect(page.getByTestId('chief-quick-replies')).toHaveCount(0);
  await runningActivity(page, 's1');
  await expect(chips(page)).toHaveText(REPLIES);
});

test('chips hide while a newer Coordinator turn is running', async ({ page }) => {
  const running = [{ ...THREAD, activeRun: { phase: 'chief' } }];
  await mockLive(page, state({ threads: running as unknown as MockState['threads'] }));
  await page.goto('/app');
  await expect(page.getByTestId('home-c').getByText('要不要先只看 README？')).toBeVisible();
  await runningActivity(page, 's2');
  await expect(page.getByTestId('home-c').getByText('正在运行命令')).toBeAttached();
  await expect(page.getByTestId('chief-quick-replies')).toHaveCount(0);
});

test('a failed chip send shows the error and keeps the chips', async ({ page }) => {
  let posts = 0;
  await mockLive(page, state(), (path, route, json) => {
    if (path === `/api/conversations/${THREAD.id}/messages` && route.request().method() === 'POST') {
      posts += 1;
      return json({ error: 'boom' }, 500);
    }
    return undefined;
  });
  await page.goto('/app');
  await chips(page).first().click();
  await expect(page.getByText('发送失败，请重试。')).toBeVisible();
  expect(posts).toBe(1);
  await expect(chips(page)).toHaveText(REPLIES);
  await expect(chips(page).first()).toBeEnabled();
});
