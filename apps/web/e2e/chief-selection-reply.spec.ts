import { expect, type Page, test } from '@playwright/test';
import { HISTORY, mockLive, THREAD } from './chief-home-mock';
import { evidenceShot } from './evidence';

const LAST_REPLY = '这条和 #9 是同一处，已经补给它了。';

async function openChat(page: Page) {
  const state = { threads: [THREAD], messages: [...HISTORY] };
  const sent = await mockLive(page, state);
  await page.goto('/app');
  const stream = page.getByTestId('home-c').getByTestId('chief-stream');
  await expect(stream).toContainText(LAST_REPLY);
  return { sent, state, stream };
}

async function selectIn(page: Page, sourceId: string, phrase: string) {
  await page.evaluate(
    ({ sourceId, phrase }) => {
      const root = document.querySelector(`[data-reply-source="${sourceId}"]`);
      if (root === null) throw new Error(`no source ${sourceId}`);
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
        const at = node.textContent?.indexOf(phrase) ?? -1;
        if (at < 0) continue;
        const range = document.createRange();
        range.setStart(node, at);
        range.setEnd(node, at + phrase.length);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        return;
      }
      throw new Error(`no text ${phrase}`);
    },
    { sourceId, phrase },
  );
}

async function dragSelect(page: Page, sourceId: string) {
  const box = await page.locator(`[data-reply-source="${sourceId}"]`).boundingBox();
  if (box === null) throw new Error('no box');
  await page.mouse.move(box.x + 4, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 4, box.y + box.height / 2, { steps: 6 });
  await page.mouse.up();
}

test.describe('select text in a Coordinator message, then Reply', () => {
  test('Reply stages the quote in the composer and the sent message carries it with its source', async ({
    page,
  }) => {
    const { sent, stream } = await openChat(page);
    await dragSelect(page, 'm6');
    const bar = page.getByTestId('selection-reply-bar');
    await expect(bar).toBeVisible();
    await expect(bar).toHaveAttribute('data-source', 'm6');
    const barBox = await bar.boundingBox();
    const lineTop = await page.evaluate(
      () => window.getSelection()?.getRangeAt(0).getClientRects()[0]?.top ?? -1,
    );
    expect(barBox).not.toBeNull();
    if (barBox) expect(Math.round(lineTop - (barBox.y + barBox.height))).toBe(8);
    await evidenceShot(page, 'bar-visible.png');

    await bar.getByTestId('selection-reply').click();
    await expect(bar).toHaveCount(0);
    const staged = page.getByTestId('composer-reply-quote');
    await expect(staged).toContainText('已经补给它了');
    const input = page.getByTestId('home-c').getByTestId('chief-composer-input');
    await expect(input).toBeFocused();
    await input.fill('补完记得跑一下拖拽的 e2e');
    await evidenceShot(page, 'replying-with-quote.png');
    await input.press('Enter');

    await expect.poll(() => sent.at(-1)).toBe(
      `<!-- reply source=m6 -->\n> ${LAST_REPLY}\n\n补完记得跑一下拖拽的 e2e`,
    );
    await expect(staged).toHaveCount(0);
    const bubble = stream.getByTestId('chief-bubble').last();
    await expect(bubble.getByTestId('reply-quote')).toHaveText(LAST_REPLY);
    await expect(bubble).toContainText('补完记得跑一下拖拽的 e2e');
    await expect(bubble).not.toContainText('<!--');
    await evidenceShot(page, 'sent-with-quote.png');
  });

  test('a removed quote is not sent', async ({ page }) => {
    const { sent } = await openChat(page);
    await selectIn(page, 'm3', '正在跑');
    await page.getByTestId('selection-reply').click();
    await page.getByTestId('composer-reply-quote-remove').click();
    await expect(page.getByTestId('composer-reply-quote')).toHaveCount(0);
    const input = page.getByTestId('home-c').getByTestId('chief-composer-input');
    await input.fill('好');
    await input.press('Enter');
    await expect.poll(() => sent.at(-1)).toBe('好');
  });

  test('keyboard: Enter replies, Escape hides the bar and keeps the selection', async ({
    page,
  }) => {
    await openChat(page);
    await selectIn(page, 'm6', '同一处');
    const bar = page.getByTestId('selection-reply-bar');
    await expect(bar).toBeVisible();
    await expect(bar.getByTestId('selection-reply')).toHaveAttribute('aria-keyshortcuts', 'Enter');
    await page.keyboard.press('Escape');
    await expect(bar).toHaveCount(0);
    expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('同一处');

    await selectIn(page, 'm6', '已经补给它了');
    await expect(bar).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('composer-reply-quote')).toHaveText('已经补给它了');
  });

  test('the bar stays away from selections it cannot quote, and leaves on collapse', async ({
    page,
  }) => {
    await openChat(page);
    const bar = page.getByTestId('selection-reply-bar');
    await selectIn(page, 'm6', '这');
    await page.waitForTimeout(400);
    await expect(bar).toHaveCount(0);

    await page.evaluate(() => {
      const first = document.querySelector('[data-reply-source="m3"]');
      const last = document.querySelector('[data-reply-source="m6"]');
      if (first === null || last === null) throw new Error('missing sources');
      const range = document.createRange();
      range.setStart(first, 0);
      range.setEnd(last, last.childNodes.length);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);
    });
    await page.waitForTimeout(400);
    await expect(bar).toHaveCount(0);

    await selectIn(page, 'm6', '同一处');
    await expect(bar).toBeVisible();
    await page.getByTestId('home-c').getByTestId('chief-composer-input').click();
    await expect(bar).toHaveCount(0);
  });

  test('a touch selection keeps the native menu and shows no bar', async ({ page }) => {
    await openChat(page);
    await page.evaluate(() => {
      document.dispatchEvent(
        new PointerEvent('pointerdown', { pointerType: 'touch', bubbles: true }),
      );
    });
    await selectIn(page, 'm6', '同一处');
    await page.waitForTimeout(400);
    await expect(page.getByTestId('selection-reply-bar')).toHaveCount(0);
  });

  for (const theme of ['light', 'dark'] as const) {
    for (const width of [1440, 390]) {
      test(`renders in ${theme} at ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 860 });
        await page.emulateMedia({ colorScheme: theme });
        await openChat(page);
        await selectIn(page, 'm6', '已经补给它了');
        const bar = page.getByTestId('selection-reply-bar');
        await expect(bar).toBeVisible();
        const box = await bar.boundingBox();
        expect(box).not.toBeNull();
        if (box) {
          expect(box.x).toBeGreaterThanOrEqual(0);
          expect(box.x + box.width).toBeLessThanOrEqual(width);
        }
        await evidenceShot(page, `bar-${theme}-${width}.png`);
        await page.keyboard.press('Enter');
        await expect(page.getByTestId('composer-reply-quote')).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
          width,
        );
        await evidenceShot(page, `quote-${theme}-${width}.png`);
      });
    }
  }
});

test.describe('a staged or queued quote keeps its source', () => {
  test('withdrawing a held quoted message restores the quote, and resending carries it', async ({
    page,
  }) => {
    const wire = `<!-- reply source=m6 -->\n> ${LAST_REPLY}\n\n补完记得跑一下 e2e`;
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
    await expect(page.getByTestId('composer-reply-quote')).toHaveText(LAST_REPLY);
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
    await expect(page.getByTestId('chief-question-dock')).toBeVisible();
    await selectIn(page, 'm6', '已经补给它了');
    await page.getByTestId('selection-reply').click();
    const home = page.getByTestId('home-c');
    const input = home.getByTestId('chief-composer-input');
    await input.fill('先别合');
    await input.fill('');
    await expect(page.getByTestId('composer-reply-quote')).toBeVisible();
    await expect(input).toBeVisible();
    await input.fill('补充一句');
    await input.press('Enter');
    await expect.poll(() => sent.at(-1)).toBe(
      '<!-- reply source=m6 -->\n> 已经补给它了\n\n补充一句',
    );
    expect(answered).toEqual([]);
  });
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  for (const theme of ['light', 'dark'] as const) {
    test(`a touch selection shows no bar and the page does not overflow (${theme})`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: theme });
      await openChat(page);
      const box = await page.locator('[data-reply-source="m6"]').boundingBox();
      if (box === null) throw new Error('no box');
      await page.touchscreen.tap(box.x + 8, box.y + box.height / 2);
      await selectIn(page, 'm6', '已经补给它了');
      await page.waitForTimeout(400);
      await expect(page.getByTestId('selection-reply-bar')).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        390,
      );
      await evidenceShot(page, `phone-touch-${theme}.png`);
    });
  }
});
