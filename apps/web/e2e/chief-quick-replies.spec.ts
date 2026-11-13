import { expect, type Page, test } from '@playwright/test';
import { type MockState, mockLive, PROJECT, type Row, THREAD, toolRow } from './chief-home-mock';

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

test('shows the latest reply suggestions under the reply as outlined, keyboard-reachable pills', async ({
  page,
}) => {
  await mockLive(page, state());
  await page.goto('/app');
  await expect(chips(page)).toHaveText(REPLIES);
  await expect(page.getByRole('group', { name: '建议回复' })).toBeVisible();
  await expect(page.getByText('suggest_replies')).toHaveCount(0);
  await expect(page.getByTestId('chief-stream').getByTestId('chief-quick-replies')).toHaveCount(1);
  const group = await page.getByTestId('chief-quick-replies').boundingBox();
  const reply = await page
    .getByTestId('home-c')
    .getByTestId('chief-reply-bubble')
    .filter({ hasText: '要不要先只看 README？' })
    .boundingBox();
  expect(group!.y - (reply!.y + reply!.height)).toBeGreaterThanOrEqual(12);
  expect(group!.y - (reply!.y + reply!.height)).toBeLessThanOrEqual(32);
  expect(Math.abs(group!.x - reply!.x)).toBeLessThanOrEqual(2);
  const composer = await page.getByTestId('home-c').locator('.chief-composer').boundingBox();
  expect(group!.y + group!.height).toBeLessThanOrEqual(composer!.y);
  const first = chips(page).first();
  const look = await first.evaluate((el) => {
    const css = getComputedStyle(el);
    return {
      height: el.getBoundingClientRect().height,
      border: css.borderTopWidth,
      fill: css.backgroundColor,
      weight: css.fontWeight,
    };
  });
  expect(look).toEqual({ height: 28, border: '1px', fill: 'rgba(0, 0, 0, 0)', weight: '400' });
  const boxes = await chips(page).evaluateAll((els) => els.map((el) => el.getBoundingClientRect()));
  expect(Math.round(boxes[1]!.x - (boxes[0]!.x + boxes[0]!.width))).toBe(12);
  await first.focus();
  await expect(first).toBeFocused();
});

test('hovering or focusing a chip previews its text in the empty composer and leaving restores it', async ({
  page,
}) => {
  await mockLive(page, state());
  await page.goto('/app');
  const placeholder = page.getByTestId('home-c').getByTestId('chief-composer-placeholder');
  const before = await placeholder.textContent();
  await chips(page).nth(1).hover();
  await expect(placeholder).toHaveText('先只看 README');
  await page.mouse.move(0, 0);
  await expect(placeholder).toHaveText(before ?? '');
  await chips(page).first().focus();
  await expect(placeholder).toHaveText('好，等你汇报');
  await page.getByTestId('home-c').getByTestId('chief-composer-input').focus();
  await expect(placeholder).toHaveText(before ?? '');
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

test('a pending question hides the suggested replies: the question chips win', async ({ page }) => {
  await mockLive(page, state({ messages: [...TURN, pendingQuestion] }));
  await page.goto('/app');
  await expect(page.getByTestId('chief-stream').getByTestId('chief-question-chips')).toBeVisible();
  await expect(page.getByTestId('chief-quick-replies')).toHaveCount(0);
});

test('question chips and suggested-reply chips share one look', async ({ page }) => {
  const look = (locator: ReturnType<Page['locator']>) =>
    locator.evaluate((el) => {
      const style = getComputedStyle(el);
      return [
        style.height,
        style.borderTopWidth,
        style.borderTopColor,
        style.borderTopLeftRadius,
        style.backgroundColor,
        style.fontSize,
        style.fontWeight,
        style.color,
        style.paddingLeft,
      ].join(' ');
    });
  await mockLive(page, state());
  await page.goto('/app');
  const reply = await look(chips(page).first());
  await mockLive(page, state({ messages: [...TURN, pendingQuestion] }));
  await page.goto('/app');
  const option = page.getByTestId('chief-question-option-0-0');
  await expect(option).toBeVisible();
  expect(await look(option)).toBe(reply);
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

const OTHER = { ...PROJECT, id: 'proj-2', name: 'landing' };
const OTHER_TURNS: Row[] = [
  { id: 'b1', role: 'user', content: '看一下落地页', createdAt: 2, projectId: OTHER.id },
  { id: 'b2', role: 'assistant', content: '落地页看过了，没有问题。', createdAt: 3, projectId: OTHER.id },
];

function projectState(projectRows: Row[] = TURN): MockState {
  return state({
    projects: [PROJECT, OTHER],
    channels: { [OTHER.id]: OTHER_TURNS, [PROJECT.id]: projectRows },
  });
}

test('suggestions belong to the channel that made them: another project channel does not show them', async ({
  page,
}) => {
  await mockLive(page, projectState());
  await page.goto(`/app?project=${OTHER.id}&chat=1`);
  await expect(page.getByTestId('chief-stream')).toContainText('落地页看过了');
  await expect(page.getByTestId('chief-quick-replies')).toHaveCount(0);
  await page.goto('/app');
  await expect(chips(page)).toHaveText(REPLIES);
});

test("in the owning project's channel the suggestions show and send with that project", async ({ page }) => {
  const bodies: { content?: string; projectId?: string }[] = [];
  await mockLive(page, projectState(), (path, route) => {
    if (route.request().method() === 'POST' && /\/messages$|\/chief\/threads$/.test(path))
      bodies.push(route.request().postDataJSON() as { content?: string; projectId?: string });
    return undefined;
  });
  await page.goto(`/app?project=${PROJECT.id}&chat=1`);
  await expect(chips(page)).toHaveText(REPLIES);
  await chips(page).nth(1).click();
  await expect.poll(() => bodies.at(-1)).toMatchObject({ content: '先只看 README', projectId: PROJECT.id });
});

test("a pending question from another project channel is not answerable from this channel", async ({
  page,
}) => {
  const question = { ...pendingQuestion, createdAt: 14 };
  await mockLive(page, projectState([...TURN, question]));
  await page.goto(`/app?project=${OTHER.id}&chat=1`);
  await expect(page.getByTestId('chief-stream')).toContainText('落地页看过了');
  await expect(page.getByTestId('chief-question')).toHaveCount(0);
  await page.goto(`/app?project=${PROJECT.id}&chat=1`);
  await expect(page.getByTestId('chief-question')).toBeVisible();
});
