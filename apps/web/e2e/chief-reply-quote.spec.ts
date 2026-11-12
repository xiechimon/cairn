import { expect, type Page, test } from '@playwright/test';
import { HISTORY, mockLive, THREAD } from './chief-home-mock';
import { evidenceShot } from './evidence';

const LAST_REPLY = '这条和 #9 是同一处，已经补给它了。';
const LAST_WIRE = `<!-- reply source=m6 -->\n> ${LAST_REPLY}`;

async function openChat(page: Page) {
  const state = { threads: [THREAD], messages: [...HISTORY] };
  const sent = await mockLive(page, state);
  await page.goto('/app');
  const stream = page.getByTestId('home-c').getByTestId('chief-stream');
  await expect(stream).toContainText(LAST_REPLY);
  return { sent, state, stream };
}

async function replyTo(page: Page, sourceId: string) {
  const source = page.locator(`[data-reply-source="${sourceId}"]`);
  const bubble = source.locator('[data-slot="reply-bubble"]').first();
  await bubble.hover();
  await source.locator('[data-placement="right"] [data-testid="chief-msg-reply"]').first().click();
}

test.describe('reply to a Coordinator message from its toolbar', () => {
  test('Reply stages the quote in the composer and the sent message carries it with its source', async ({
    page,
  }) => {
    const { sent, stream } = await openChat(page);
    await replyTo(page, 'm6');
    const staged = page.getByTestId('composer-reply-quote');
    await expect(staged).toContainText('已经补给它了');
    const input = page.getByTestId('home-c').getByTestId('chief-composer-input');
    await expect(input).toBeFocused();
    await input.fill('补完记得跑一下拖拽的 e2e');
    await evidenceShot(page, 'replying-with-quote.png');
    await input.press('Enter');

    await expect.poll(() => sent.at(-1)).toBe(`${LAST_WIRE}\n\n补完记得跑一下拖拽的 e2e`);
    await expect(staged).toHaveCount(0);
    const bubble = stream.getByTestId('chief-bubble').last();
    await expect(bubble.getByTestId('reply-quote')).toHaveText(LAST_REPLY);
    await expect(bubble).toContainText('补完记得跑一下拖拽的 e2e');
    await expect(bubble).not.toContainText('<!--');
    await evidenceShot(page, 'sent-with-quote.png');
  });

  test('the staged quote is one line in the composer with its own placeholder, Escape cancels it and hovering marks the source', async ({
    page,
  }) => {
    await openChat(page);
    const input = page.getByTestId('home-c').getByTestId('chief-composer-input');
    await replyTo(page, 'm6');
    const bar = page.getByTestId('composer-reply-bar');
    await expect(bar).toBeVisible();
    await expect(bar).toHaveCSS('height', '28px');
    await expect(page.getByTestId('chief-composer-placeholder')).toHaveText('回复这条消息');
    const inCard = await bar.evaluate((el) => el.closest('.chief-composer') !== null);
    expect(inCard).toBe(true);
    const source = page.locator('[data-reply-source="m6"]');
    await expect(source).not.toHaveAttribute('data-reply-highlight', '');
    await bar.hover();
    await expect(source).toHaveAttribute('data-reply-highlight', '');
    await page.mouse.move(0, 0);
    await expect(source).not.toHaveAttribute('data-reply-highlight', '');
    await input.focus();
    await input.press('Escape');
    await expect(bar).toHaveCount(0);
    await expect(page.getByTestId('chief-composer-placeholder')).not.toHaveText('回复这条消息');
  });

  test('removing the quote while hovering it clears the mark on its source', async ({ page }) => {
    await openChat(page);
    await replyTo(page, 'm6');
    const source = page.locator('[data-reply-source="m6"]');
    await page.getByTestId('composer-reply-bar').hover();
    await expect(source).toHaveAttribute('data-reply-highlight', '');
    await page.getByTestId('composer-reply-quote-remove').click();
    await expect(page.getByTestId('composer-reply-bar')).toHaveCount(0);
    await expect(page.locator('[data-reply-highlight]')).toHaveCount(0);
    await replyTo(page, 'm3');
    await expect(page.locator('[data-reply-highlight]')).toHaveCount(0);
  });

  test('a removed quote is not sent', async ({ page }) => {
    const { sent } = await openChat(page);
    await replyTo(page, 'm3');
    await page.getByTestId('composer-reply-quote-remove').click();
    await expect(page.getByTestId('composer-reply-quote')).toHaveCount(0);
    const input = page.getByTestId('home-c').getByTestId('chief-composer-input');
    await input.fill('好');
    await input.press('Enter');
    await expect.poll(() => sent.at(-1)).toBe('好');
  });
});

test.describe('a staged or queued quote keeps its source', () => {
  test('withdrawing a held quoted message restores the quote, and resending carries it', async ({
    page,
  }) => {
    const wire = `${LAST_WIRE}\n\n补完记得跑一下 e2e`;
    const state = {
      threads: [{ ...THREAD, pending: [{ messageId: 'q1', state: 'held' }] }],
      messages: [...HISTORY, { id: 'q1', role: 'user', content: wire, createdAt: 30 }],
    };
    const sent = await mockLive(page, state, (path, route, json) => {
      if (path !== `/api/teams/t1/chief/threads/${THREAD.id}/messages/q1`) return undefined;
      if (route.request().method() !== 'DELETE') return undefined;
      state.threads = [{ ...THREAD, pending: [] }];
      state.messages = state.messages.filter((row) => row.id !== 'q1');
      return json({ ok: true });
    });
    await page.goto('/app');
    const home = page.getByTestId('home-c');
    const held = home.getByTestId('queued-message');
    await expect(held).toHaveCount(1);
    await expect(held).toContainText('补完记得跑一下 e2e');
    await expect(held).not.toContainText('<!--');
    await held.getByRole('button', { name: '撤回' }).click();
    await expect(page.getByTestId('composer-reply-quote')).toHaveText(`回复：${LAST_REPLY}`);
    const input = home.getByTestId('chief-composer-input');
    await expect(input).toHaveValue('补完记得跑一下 e2e');
    await input.press('Enter');
    await expect.poll(() => sent.at(-1)).toBe(wire);
  });

  test('with a question pending, erasing the draft keeps the quote on the thread composer', async ({
    page,
  }) => {
    const answered: string[] = [];
    const question = {
      id: 'row-ask-1',
      role: 'assistant',
      createdAt: 40,
      content: JSON.stringify({
        kind: 'ask_user_question',
        requestId: 'ask-00000001',
        status: 'pending',
        questions: [
          { header: 'Merge · #9', question: 'Who merges it?', options: [{ label: 'Hold it' }, { label: 'Send it to ian' }] },
        ],
        answers: null,
        provenance: 'watch:todo-1',
      }),
    };
    const state = { threads: [THREAD], messages: [...HISTORY, question] };
    const sent = await mockLive(page, state, (path, route, json) => {
      if (!/\/questions\/[^/]+\/answer$/.test(path)) return undefined;
      answered.push(path);
      return json({});
    });
    await page.goto('/app');
    await expect(page.getByTestId('chief-question')).toBeVisible();
    const home = page.getByTestId('home-c');
    const input = home.getByTestId('chief-composer-input');
    const answerComposer = page.getByTestId('chief-question-primary');
    const chip = page.getByTestId('chief-question').getByTestId('chief-question-option-0-1');
    const expectOneAnswerPath = async (owner: 'answer composer' | 'question chips') => {
      await expect(chip).toBeEnabled();
      if (owner === 'answer composer') await expect(answerComposer).toBeVisible();
      else await expect(answerComposer).toHaveCount(0);
    };
    await expectOneAnswerPath('answer composer');
    await replyTo(page, 'm6');
    await expectOneAnswerPath('question chips');
    await input.fill('先别合');
    await expectOneAnswerPath('question chips');
    await input.fill('');
    await expect(page.getByTestId('composer-reply-quote')).toBeVisible();
    await expect(input).toBeVisible();
    await expectOneAnswerPath('question chips');
    await page.getByTestId('composer-reply-quote-remove').click();
    await expectOneAnswerPath('answer composer');
    await replyTo(page, 'm6');
    await expectOneAnswerPath('question chips');
    await input.fill('补充一句');
    await input.press('Enter');
    await expect.poll(() => sent.at(-1)).toBe(`${LAST_WIRE}\n\n补充一句`);
    expect(answered).toEqual([]);
  });
});
