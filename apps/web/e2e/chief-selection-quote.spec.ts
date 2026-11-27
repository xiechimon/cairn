import { expect, type Page, type Route, test } from '@playwright/test';
import { HISTORY, mockLive, TASK, THREAD } from './chief-home-mock';
import { decodePng } from './png';

const LAST_REPLY = '这条和 #9 是同一处，已经补给它了。';

type Json = (body: unknown, status?: number) => Promise<void>;

async function openChat(
  page: Page,
  extra?: (path: string, route: Route, json: Json) => Promise<void> | undefined,
) {
  const state = { threads: [THREAD], messages: [...HISTORY] };
  const sent = await mockLive(page, state, (path, route, json) =>
    path === '/api/todos/todo-1' ? json(TASK) : extra?.(path, route, json),
  );
  await page.goto('/app');
  const stream = page.getByTestId('home-c').getByTestId('chief-stream');
  await expect(stream).toContainText(LAST_REPLY);
  return { sent, stream };
}

async function dragSelect(page: Page, sourceId: string) {
  const source = page.locator(`[data-reply-source="${sourceId}"]`);
  const bubble = source.locator('[data-slot="reply-bubble"]').first();
  const target = (await bubble.count()) > 0 ? bubble : source;
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (box === null) throw new Error('no box');
  await page.mouse.move(box.x + 4, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 4, box.y + box.height / 2, { steps: 6 });
  await page.mouse.up();
}

test('selecting a reply shows the pill; R opens the quote box and Enter stages the quote with its own reply, leaving the main input free', async ({
  page,
}) => {
  const { sent } = await openChat(page);
  await dragSelect(page, 'm6');
  const pill = page.getByTestId('selection-reply-bar');
  await expect(pill).toBeVisible();
  await expect(pill).toHaveAttribute('data-source', 'm6');
  await expect(pill.getByTestId('selection-ask-side-chat')).toHaveCount(0);
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
  await expect(page.getByTestId('composer-quote-text')).toContainText('已经补给它了');
  await expect(page.getByTestId('composer-quote-reply')).toHaveText('拖拽的 e2e 也补上');
  const composer = page.getByTestId('home-c').getByTestId('chief-composer-input');
  await expect(composer).toHaveValue('');
  await expect(composer).toBeFocused();
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
  await expect(page.getByTestId('composer-quote')).toHaveCount(0);
});

async function textClip(page: Page, sourceId: string) {
  const rect = await page
    .locator(`[data-reply-source="${sourceId}"] [data-slot="reply-bubble"]`)
    .first()
    .evaluate((el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      const box = range.getBoundingClientRect();
      return { x: box.x, y: box.y, width: box.width, height: box.height };
    });
  return {
    x: Math.ceil(rect.x),
    y: Math.ceil(rect.y),
    width: Math.floor(rect.width),
    height: Math.floor(rect.height),
  };
}

async function changedShare(
  page: Page,
  clip: { x: number; y: number; width: number; height: number },
  before: Buffer,
) {
  const a = decodePng(before);
  const b = decodePng(await page.screenshot({ clip, animations: 'disabled' }));
  let changed = 0;
  for (let y = 0; y < a.height; y += 1) {
    for (let x = 0; x < a.width; x += 1) {
      const [r1, g1, b1] = a.px(x, y);
      const [r2, g2, b2] = b.px(x, y);
      if (Math.abs(r1 - r2) + Math.abs(g1 - g2) + Math.abs(b1 - b2) > 24) changed += 1;
    }
  }
  return changed / (a.width * a.height);
}

for (const theme of ['light', 'dark'] as const) {
  test(`C40 ${theme}: selected text and the span being quoted are visibly marked on a reply bubble`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    await openChat(page);
    await page.evaluate(
      (light) => document.documentElement.classList.toggle('light', light),
      theme === 'light',
    );
    const clip = await textClip(page, 'm6');
    const before = await page.screenshot({ clip, animations: 'disabled' });

    await dragSelect(page, 'm6');
    await expect(page.getByTestId('selection-reply-bar')).toBeVisible();
    expect(
      await changedShare(page, clip, before),
      'C40: the native selection on a reply bubble must differ from the bubble fill',
    ).toBeGreaterThan(0.4);

    await page.keyboard.press('r');
    await expect(page.getByTestId('selection-quote-input')).toBeFocused();
    expect(
      await changedShare(page, clip, before),
      'C40: the span being quoted stays marked while the quote box has focus',
    ).toBeGreaterThan(0.4);

    await page.getByTestId('selection-quote-input').press('Enter');
    await expect(page.getByTestId('composer-quote-text')).toContainText('已经补给它了');
    expect(
      await changedShare(page, clip, before),
      'C40: a staged quote keeps its span marked',
    ).toBeGreaterThan(0.4);
  });
}

async function quoteWith(page: Page, sourceId: string, reply: string) {
  await dragSelect(page, sourceId);
  await page.getByTestId('selection-quote').click();
  const input = page.getByTestId('selection-quote-input');
  if (reply !== '') await input.fill(reply);
  await input.press('Enter');
}

test('two quotes, each with its own reply, and the main text go out as one message', async ({
  page,
}) => {
  const { sent, stream } = await openChat(page);
  const composer = page.getByTestId('home-c').getByTestId('chief-composer-input');
  await composer.fill('其余都没问题');
  await quoteWith(page, 'm6', '这句改成 X');
  await quoteWith(page, 'm4', '这句删掉');
  const items = page.getByTestId('composer-quote');
  await expect(items).toHaveCount(2);
  await expect(items.nth(0).getByTestId('composer-quote-reply')).toHaveText('这句改成 X');
  await expect(items.nth(1).getByTestId('composer-quote-reply')).toHaveText('这句删掉');
  await expect(composer).toHaveValue('其余都没问题');
  const inCard = await items
    .first()
    .evaluate((el) => el.closest('.chief-composer') !== null);
  expect(inCard).toBe(true);

  await composer.press('Enter');
  await expect
    .poll(() => sent.at(-1))
    .toMatch(
      /^<!-- reply source=m6 lines=1 -->\n> [^\n]+\n\n这句改成 X\n<!-- reply source=m4 lines=1 -->\n> [^\n]+\n\n这句删掉\n\n其余都没问题$/,
    );
  await expect(items).toHaveCount(0);
  const bubble = stream.getByTestId('chief-bubble').last();
  await expect(bubble.getByTestId('reply-quote')).toHaveCount(2);
  await expect(bubble.getByTestId('reply-quote-answer')).toHaveText(['这句改成 X', '这句删掉']);
  await expect(bubble).toContainText('其余都没问题');
  await expect(bubble).not.toContainText('<!--');
});

test('removing one of two staged quotes sends only the other; quotes alone can be sent with an empty input', async ({
  page,
}) => {
  const { sent } = await openChat(page);
  await quoteWith(page, 'm6', '保留这条');
  await quoteWith(page, 'm4', '去掉这条');
  const items = page.getByTestId('composer-quote');
  await items.nth(1).getByTestId('composer-quote-remove').click();
  await expect(items).toHaveCount(1);
  await expect(items.getByTestId('composer-quote-reply')).toHaveText('保留这条');
  await page.getByTestId('home-c').getByTestId('chief-composer-input').press('Enter');
  await expect
    .poll(() => sent.at(-1))
    .toBe(`<!-- reply source=m6 -->\n> ${LAST_REPLY}\n\n保留这条`);
});

test('two staged quotes go out with an empty main input', async ({ page }) => {
  const { sent } = await openChat(page);
  await quoteWith(page, 'm6', '第一处');
  await quoteWith(page, 'm4', '第二处');
  await page.getByTestId('home-c').getByTestId('chief-composer-input').press('Enter');
  await expect
    .poll(() => sent.at(-1))
    .toMatch(
      /^<!-- reply source=m6 lines=1 -->\n> [^\n]+\n\n第一处\n<!-- reply source=m4 lines=1 -->\n> [^\n]+\n\n第二处$/,
    );
  await expect(page.getByTestId('composer-quote')).toHaveCount(0);
});

test('the same passage quoted twice gives two items, and × removes only the pressed one', async ({
  page,
}) => {
  const { sent } = await openChat(page);
  await quoteWith(page, 'm6', '第一种说法');
  await quoteWith(page, 'm6', '第二种说法');
  const items = page.getByTestId('composer-quote');
  await expect(items).toHaveCount(2);
  await items.nth(1).getByTestId('composer-quote-remove').click();
  await expect(items.getByTestId('composer-quote-reply')).toHaveText(['第一种说法']);
  await page.getByTestId('home-c').getByTestId('chief-composer-input').press('Enter');
  await expect
    .poll(() => sent.at(-1))
    .toBe(`<!-- reply source=m6 -->\n> ${LAST_REPLY}\n\n第一种说法`);
});

test('Send now from the quote box sends only that quote and leaves the staged ones', async ({
  page,
}) => {
  const { sent } = await openChat(page);
  await quoteWith(page, 'm6', '留着');
  await dragSelect(page, 'm4');
  await page.getByTestId('selection-quote').click();
  const input = page.getByTestId('selection-quote-input');
  await input.fill('马上发');
  await input.press('ControlOrMeta+Enter');
  await expect.poll(() => sent.at(-1)).toMatch(/^<!-- reply source=m4 -->\n> [^\n]+\n\n马上发$/);
  await expect(page.getByTestId('composer-quote-reply')).toHaveText(['留着']);
});

test('a send that fails brings every quote back with its reply', async ({ page }) => {
  let refused = false;
  await openChat(page, (path, route, json) => {
    if (refused || path !== `/api/conversations/${THREAD.id}/messages`) return undefined;
    if (route.request().method() !== 'POST') return undefined;
    refused = true;
    return json({ error: 'Submission refused' }, 503);
  });
  await quoteWith(page, 'm6', '第一条');
  await quoteWith(page, 'm4', '第二条');
  const composer = page.getByTestId('home-c').getByTestId('chief-composer-input');
  await composer.fill('其余没问题');
  await composer.press('Enter');
  await expect(page.locator('[data-sonner-toast]').first()).toContainText('发送失败，请重试。');
  await expect(page.getByTestId('composer-quote-reply')).toHaveText(['第一条', '第二条']);
  await expect(composer).toHaveValue('其余没问题');
});
