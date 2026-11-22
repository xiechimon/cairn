import { expect, type Page, test } from '@playwright/test';
import { HISTORY, mockLive, TASK, THREAD } from './chief-home-mock';

const LAST_REPLY = '这条和 #9 是同一处，已经补给它了。';

async function openChat(page: Page) {
  const state = { threads: [THREAD], messages: [...HISTORY] };
  const sent = await mockLive(page, state, (path, _route, json) =>
    path === '/api/todos/todo-1' ? json(TASK) : undefined,
  );
  await page.goto('/app');
  const stream = page.getByTestId('home-c').getByTestId('chief-stream');
  await expect(stream).toContainText(LAST_REPLY);
  return { sent, stream };
}

async function dragSelect(page: Page, sourceId: string) {
  const box = await page.locator(`[data-reply-source="${sourceId}"]`).boundingBox();
  if (box === null) throw new Error('no box');
  await page.mouse.move(box.x + 4, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 4, box.y + box.height / 2, { steps: 6 });
  await page.mouse.up();
}

test('selecting a reply shows the pill; R opens the quote box and Enter stages the quote with the typed text', async ({
  page,
}) => {
  const { sent } = await openChat(page);
  await dragSelect(page, 'm6');
  const pill = page.getByTestId('selection-reply-bar');
  await expect(pill).toBeVisible();
  await expect(pill).toHaveAttribute('data-source', 'm6');
  await expect(pill.getByTestId('selection-ask-side-chat')).toHaveText('问侧聊');
  await expect(pill.getByTestId('selection-quote')).toContainText('引用');

  await page.keyboard.press('r');
  const box = page.getByTestId('selection-quote-box');
  await expect(box).toBeVisible();
  await expect(pill).toHaveCount(0);
  await expect(box.getByTestId('selection-quote-text')).toHaveText(LAST_REPLY);
  await expect(box.getByTestId('selection-quote-hint')).toContainText('加到输入框');
  await expect(box.getByTestId('selection-quote-hint')).toContainText('直接发送');
  const input = box.getByTestId('selection-quote-input');
  await expect(input).toBeFocused();
  await input.fill('拖拽的 e2e 也补上');
  await input.press('Enter');

  await expect(box).toHaveCount(0);
  await expect(page.getByTestId('composer-reply-quote')).toContainText('已经补给它了');
  const composer = page.getByTestId('home-c').getByTestId('chief-composer-input');
  await expect(composer).toHaveText('拖拽的 e2e 也补上');
  await composer.press('Enter');
  await expect
    .poll(() => sent.at(-1))
    .toBe(`<!-- reply source=m6 -->\n> ${LAST_REPLY}\n\n拖拽的 e2e 也补上`);
});

test('Cmd+Enter in the quote box sends the quote and the text at once; Escape closes it', async ({
  page,
}) => {
  const { sent } = await openChat(page);
  await dragSelect(page, 'm6');
  await page.getByTestId('selection-quote').click();
  const input = page.getByTestId('selection-quote-input');
  await input.press('Escape');
  await expect(page.getByTestId('selection-quote-box')).toHaveCount(0);

  await dragSelect(page, 'm6');
  await page.getByTestId('selection-quote').click();
  await input.fill('那就合并吧');
  await input.press('ControlOrMeta+Enter');
  await expect
    .poll(() => sent.at(-1))
    .toBe(`<!-- reply source=m6 -->\n> ${LAST_REPLY}\n\n那就合并吧`);
  await expect(page.getByTestId('composer-reply-quote')).toHaveCount(0);
});

test('Ask in side chat opens the task thread with the selection quoted in its composer', async ({
  page,
}) => {
  await openChat(page);
  await dragSelect(page, 'm6');
  await page.getByTestId('selection-ask-side-chat').click();
  await expect(page).toHaveURL(/thread=todo-1/);
  const panel = page.getByTestId('side-chat-panel');
  await expect(panel.locator('textarea')).toHaveValue(`> ${LAST_REPLY}\n\n`);
});
