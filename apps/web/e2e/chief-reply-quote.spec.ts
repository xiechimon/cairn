import { expect, type Page, test } from '@playwright/test';
import { HISTORY, mockLive, THREAD } from './chief-home-mock';
import { evidenceShot } from './evidence';

const LAST_REPLY = '这条和 #9 是同一处，已经补给它了。';
const LAST_WIRE = `<!-- reply source=m6 -->\n> ${LAST_REPLY}`;
const OWN = '顺便把空列的提示也改一下';
const OWN_WIRE = `<!-- reply source=m4 -->\n> ${OWN}`;

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
  const target = (await bubble.count()) > 0 ? bubble : source;
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (box === null) throw new Error(`no box for ${sourceId}`);
  await page.mouse.move(box.x + 4, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 4, box.y + box.height / 2, { steps: 6 });
  await page.mouse.up();
  const bar = page.getByTestId('selection-reply-bar');
  await expect(bar).toBeVisible();
  await bar.getByTestId('selection-quote').click();
  await page.getByTestId('selection-quote-input').press('Enter');
}

test('neither user nor Coordinator hover toolbar shows a reply button; select-to-quote quotes Coordinator replies', async ({
  page,
}) => {
  const { sent, stream } = await openChat(page);
  const source = page.locator('[data-reply-source="m6"]');
  await source.hover();
  const tools = source
    .locator('xpath=ancestor::*[@data-slot="message"][1]')
    .locator('[data-slot="message-meta"]');
  await expect(tools.getByTestId('message-copy')).toBeVisible();
  await expect(tools.getByTestId('chief-msg-reply')).toHaveCount(0);
  await expect(tools.getByRole('button')).toHaveCount(1);

  const ownSource = page.locator('[data-reply-source="m4"]');
  await ownSource.hover();
  const ownTools = ownSource
    .locator('xpath=ancestor::*[@data-slot="message"][1]')
    .locator('[data-slot="message-meta"]');
  await expect(ownTools.getByTestId('message-copy')).toBeVisible();
  await expect(ownTools.getByTestId('chief-msg-reply')).toHaveCount(0);

  await replyTo(page, 'm6');
  await expect(page.getByTestId('composer-quote-text')).toContainText(LAST_REPLY);
  const input = page.getByTestId('home-c').getByTestId('chief-composer-input');
  await input.fill('好的，收到');
  await input.press('Enter');
  await expect.poll(() => sent.at(-1)).toBe(`${LAST_WIRE}\n\n好的，收到`);
  await expect(stream.getByTestId('chief-bubble').last().getByTestId('reply-quote')).toHaveText(
    LAST_REPLY,
  );
});

test.describe('reply to your own message from its toolbar', () => {
  test('Reply stages the quote in the composer and the sent message carries it with its source', async ({
    page,
  }) => {
    const { sent, stream } = await openChat(page);
    await replyTo(page, 'm4');
    const staged = page.getByTestId('composer-quote-text');
    await expect(staged).toContainText('空列的提示');
    const input = page.getByTestId('home-c').getByTestId('chief-composer-input');
    await expect(input).toBeFocused();
    await input.fill('补完记得跑一下拖拽的 e2e');
    await evidenceShot(page, 'replying-with-quote.png');
    await input.press('Enter');

    await expect.poll(() => sent.at(-1)).toBe(`${OWN_WIRE}\n\n补完记得跑一下拖拽的 e2e`);
    await expect(staged).toHaveCount(0);
    const bubble = stream.getByTestId('chief-bubble').last();
    await expect(bubble.getByTestId('reply-quote')).toHaveText(OWN);
    await expect(bubble).toContainText('补完记得跑一下拖拽的 e2e');
    await expect(bubble).not.toContainText('<!--');
    await evidenceShot(page, 'sent-with-quote.png');
  });

  test('the staged quote sits inside the composer card, leaves the placeholder alone, Escape cancels it and hovering marks the source', async ({
    page,
  }) => {
    await openChat(page);
    const input = page.getByTestId('home-c').getByTestId('chief-composer-input');
    await replyTo(page, 'm4');
    const bar = page.getByTestId('composer-quote');
    await expect(bar).toBeVisible();
    const placeholder = page.getByTestId('chief-composer-placeholder');
    await expect(placeholder).not.toHaveText('回复这条消息');
    const inCard = await bar.evaluate((el) => el.closest('.chief-composer') !== null);
    expect(inCard).toBe(true);
    const source = page.locator('[data-reply-source="m4"]');
    await expect(source).not.toHaveAttribute('data-reply-highlight', '');
    await bar.hover();
    await expect(source).toHaveAttribute('data-reply-highlight', '');
    await page.mouse.move(0, 0);
    await expect(source).not.toHaveAttribute('data-reply-highlight', '');
    await input.focus();
    await input.press('Escape');
    await expect(bar).toHaveCount(0);
    await expect(placeholder).not.toHaveText('回复这条消息');
  });

  test('removing the quote while hovering it clears the mark on its source', async ({ page }) => {
    await openChat(page);
    await replyTo(page, 'm4');
    const source = page.locator('[data-reply-source="m4"]');
    await page.getByTestId('composer-quote').hover();
    await expect(source).toHaveAttribute('data-reply-highlight', '');
    await page.getByTestId('composer-quote-remove').click();
    await expect(page.getByTestId('composer-quote')).toHaveCount(0);
    await expect(page.locator('[data-reply-highlight]')).toHaveCount(0);
    await replyTo(page, 'm1');
    await expect(page.locator('[data-reply-highlight]')).toHaveCount(0);
  });

  test('a removed quote is not sent', async ({ page }) => {
    const { sent } = await openChat(page);
    await replyTo(page, 'm1');
    await page.getByTestId('composer-quote-remove').click();
    await expect(page.getByTestId('composer-quote-text')).toHaveCount(0);
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
    const held = home.getByTestId('chief-queued-message');
    await expect(held).toHaveCount(1);
    await expect(held).toContainText('补完记得跑一下 e2e');
    await expect(held).not.toContainText('<!--');
    await held.getByRole('button', { name: '撤回' }).click();
    await expect(page.getByTestId('composer-quote-text')).toHaveText(LAST_REPLY);
    await expect(page.getByTestId('composer-quote-reply')).toHaveText('补完记得跑一下 e2e');
    const input = home.getByTestId('chief-composer-input');
    await expect(input).toHaveValue('');
    await input.press('Enter');
    await expect.poll(() => sent.at(-1)).toBe(wire);
  });

  test('a quoted message with a screenshot shows the screenshot as a file and brings it back as an attachment', async ({
    page,
  }) => {
    const wire = `${LAST_WIRE}\n\n![shot.png](attachment:team-files/att-shot.png)\n补完记得跑一下 e2e`;
    const state = {
      threads: [{ ...THREAD, pending: [{ messageId: 'q1', state: 'held' }] }],
      messages: [
        ...HISTORY,
        { id: 'q0', role: 'user', content: wire, createdAt: 29 },
        { id: 'q1', role: 'user', content: wire, createdAt: 30 },
      ],
    };
    await mockLive(page, state, (path, route, json) => {
      if (path.startsWith('/api/attachments/')) return route.fulfill({ status: 404, body: '' });
      if (path !== `/api/teams/t1/chief/threads/${THREAD.id}/messages/q1`) return undefined;
      if (route.request().method() !== 'DELETE') return undefined;
      state.threads = [{ ...THREAD, pending: [] }];
      state.messages = state.messages.filter((row) => row.id !== 'q1');
      return json({ ok: true });
    });
    await page.goto('/app');
    const home = page.getByTestId('home-c');
    const bubble = home.getByTestId('chief-bubble').filter({ hasText: '补完记得跑一下 e2e' }).first();
    await expect(bubble.getByTestId('reply-quote-answer')).toHaveText('补完记得跑一下 e2e');
    await expect(home.getByTestId('chief-sent-attachments')).toHaveCount(1);
    await expect(home.getByTestId('chief-stream')).not.toContainText('attachment:');
    await home.getByTestId('chief-queued-message').getByRole('button', { name: '撤回' }).click();
    await expect(page.getByTestId('composer-quote-reply')).toHaveText('补完记得跑一下 e2e');
    await expect(home.getByTestId('composer-attachments')).toHaveCount(1);
    await expect(home.getByTestId('chief-composer-input')).toHaveValue('');
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
    const chip = page.getByTestId('chief-question').getByTestId('chief-question-option-0-1');
    await expect(chip).toBeEnabled();
    await replyTo(page, 'm4');
    await expect(chip).toBeEnabled();
    await input.fill('先别合');
    await expect(chip).toBeEnabled();
    await input.fill('');
    await expect(page.getByTestId('composer-quote-text')).toHaveText('顺便把空列的提示也改一下');
    await expect(input).toBeVisible();
    await expect(chip).toBeEnabled();
    await page.getByTestId('composer-quote-remove').click();
    await expect(page.getByTestId('composer-quote-text')).toHaveCount(0);
    await expect(chip).toBeEnabled();
    await replyTo(page, 'm4');
    await input.fill('补充一句');
    await input.press('Enter');
    await expect.poll(() => sent.at(-1)).toBe(`${OWN_WIRE}\n\n补充一句`);
    expect(answered).toEqual([]);
    await expect(page.getByTestId('chief-question')).toBeVisible();
  });
});

test.describe('many staged quotes', () => {
  const blocks = Array.from(
    { length: 10 },
    (_, n) =>
      `<!-- reply source=m6 lines=1 -->\n> 第 ${n + 1} 段：${'很长的一句引用内容，'.repeat(6)}\n\n第 ${n + 1} 条回复`,
  );
  const wire = `${blocks.join('\n')}\n\n整体没问题`;

  for (const width of [1440, 390]) {
    test(`at ${width}px a withdrawn message with ten quotes restores them as items that scroll inside the card`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
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
      const input = home.getByTestId('chief-composer-input');
      await input.fill('先写的草稿');
      await home.getByTestId('chief-queued-message').getByRole('button', { name: '撤回' }).click();
      const list = page.getByTestId('composer-quotes');
      await expect(list.getByTestId('composer-quote')).toHaveCount(10);
      await expect(input).toHaveValue('先写的草稿\n整体没问题');
      await expect(input).toBeInViewport();
      const box = await list.evaluate((el) => ({
        scrolls: el.scrollHeight > el.clientHeight,
        height: el.getBoundingClientRect().height,
        overflowX: el.scrollWidth > el.clientWidth,
      }));
      expect(box.scrolls).toBe(true);
      expect(box.height).toBeLessThanOrEqual(160);
      expect(box.overflowX).toBe(false);
      await evidenceShot(page, `quotes-many-${width}.png`);
      await input.fill('整体没问题');
      await input.press('Enter');
      await expect.poll(() => sent.at(-1)).toBe(wire);
    });
  }
});
