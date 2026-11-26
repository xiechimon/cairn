import { expect, type Locator, type Page, test } from '@playwright/test';
import { mockLive, THREAD } from './chief-home-mock.js';
import { evidenceShot } from './evidence.js';

test.describe.configure({ mode: 'parallel' });

type Box = { x: number; y: number; width: number; height: number };

const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

const USER_MSG = '新的打包流程跑通后，把那两个停下的任务一起重新推送到测试环境。';
const ASSISTANT_MSG =
  '好的，软链接已经去掉。新的打包流程跑通后会把那两个停下的任务一起重新推到测试环境，并核对推送日志里的环境变量。';
const WIDE_USER_MSG =
  '不用软链接了。新的打包流程跑通后，把那两个停下的任务一起重新推送到测试环境，顺便核对一下推送日志里有没有遗漏的环境变量。';
const SHORT_USER_MSG = '好，跑完告诉我';
const SHORT_ASSISTANT_MSG = '收到，有结果马上同步你。';

const COMPACT_WIDTH = 768;
const PHASE = process.env.MSG_TOOLBAR_SHOT_PHASE ?? 'after';

async function openConversation(page: Page, width: number, scheme: 'light' | 'dark') {
  await page.setViewportSize({ width, height: width <= 420 ? 844 : 900 });
  await page.emulateMedia({ colorScheme: scheme });
  await page.addInitScript((value) => localStorage.setItem('cairn-theme', value), scheme);
  const now = Date.now();
  const sent = await mockLive(page, {
    threads: [THREAD],
    messages: [
      { id: 'u-wide', role: 'user', content: WIDE_USER_MSG, createdAt: now - 240_000 },
      { id: 'u-mid', role: 'user', content: USER_MSG, createdAt: now - 180_000 },
      { id: 'a-wide', role: 'assistant', content: ASSISTANT_MSG, createdAt: now - 120_000 },
      { id: 'u-short', role: 'user', content: SHORT_USER_MSG, createdAt: now - 60_000 },
      { id: 'a-short', role: 'assistant', content: SHORT_ASSISTANT_MSG, createdAt: now - 30_000 },
    ],
  });
  await page.goto('/app');
  const stream = page.getByTestId('home-c').getByTestId('chief-stream');
  await expect(stream).toContainText(SHORT_ASSISTANT_MSG);
  return { stream, sent };
}

async function captureRowShot(page: Page, name: string, stream: Locator, row: Locator) {
  const streamBox = await stream.boundingBox();
  const rowBox = await row.boundingBox();
  const viewport = page.viewportSize();
  if (streamBox === null || rowBox === null || viewport === null) return;
  const x = Math.max(0, Math.floor(streamBox.x));
  const right = Math.min(viewport.width, Math.ceil(streamBox.x + streamBox.width));
  const y = Math.max(0, Math.floor(rowBox.y - 72));
  const bottom = Math.min(viewport.height, Math.ceil(rowBox.y + rowBox.height + 72));
  await evidenceShot(page, name, { x, y, width: right - x, height: bottom - y });
}

async function boxOf(locator: Locator, label: string): Promise<Box> {
  const box = await locator.boundingBox();
  if (box === null) throw new Error(`${label}: not laid out`);
  return box;
}

async function isHittable(target: Locator): Promise<boolean> {
  return target.evaluate((el) => {
    const box = el.getBoundingClientRect();
    const top = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return top !== null && el.contains(top);
  });
}

const rowOf = (stream: Locator, text: string) =>
  stream.getByTestId('chief-msg').filter({ hasText: text });

const bubbleIn = (row: Locator) => row.locator('[data-slot="message-bubble"]');

const metaIn = (row: Locator) => row.locator('[data-slot="message-meta"]');

async function toolNames(meta: Locator): Promise<string[]> {
  return meta.locator('button').evaluateAll((els) =>
    els
      .map((el) => ({ id: el.getAttribute('data-testid') ?? '', x: el.getBoundingClientRect().x }))
      .sort((a, b) => a.x - b.x)
      .map((entry) => entry.id),
  );
}

async function assertPlainTime(meta: Locator, label: string) {
  const stamp = meta.getByTestId('msg-stamp');
  await expect(stamp, `${label}: time renders HH:MM`).toHaveText(/\d{1,2}:\d{2}/);
  const style = await meta.evaluate((el) => {
    const cs = getComputedStyle(el);
    const time = el.querySelector('[data-testid="msg-stamp"]');
    return {
      bg: cs.backgroundColor,
      shadow: cs.boxShadow,
      tabular: time ? getComputedStyle(time).fontVariantNumeric : '',
    };
  });
  expect(style.bg, `${label}: the meta row has no backing`).toBe('rgba(0, 0, 0, 0)');
  expect(style.shadow, `${label}: the meta row has no shadow`).toBe('none');
  expect(style.tabular, `${label}: time uses tabular figures (V27)`).toContain('tabular-nums');
}

async function dragSelectBubble(page: Page, bubble: Locator) {
  await bubble.scrollIntoViewIfNeeded();
  const box = await boxOf(bubble, 'selection target bubble');
  await page.mouse.move(box.x + 12, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 12, box.y + box.height / 2, { steps: 6 });
  await page.mouse.up();
}

for (const width of [1440, COMPACT_WIDTH, 390] as const) {
  test(`owner and Coordinator meta rows carry the same time and copy and no reply button (${width}px)`, async ({
    page,
  }) => {
    const { stream } = await openConversation(page, width, 'light');
    const userRow = rowOf(stream, USER_MSG);
    const assistantRow = rowOf(stream, ASSISTANT_MSG);
    await expect(stream.getByTestId('chief-msg-reply')).toHaveCount(0);
    if (width === 390) {
      await bubbleIn(assistantRow).hover();
      await expect(
        stream.locator('[data-slot="message-meta"]'),
        '390px: no hover meta row; a press opens the message menu instead',
      ).toHaveCount(0);
      return;
    }
    const userMeta = metaIn(userRow);
    await bubbleIn(userRow).scrollIntoViewIfNeeded();
    await bubbleIn(userRow).hover();
    await expect(userMeta).toHaveCSS('opacity', '1');
    expect(await toolNames(userMeta), `${width}px: owner tools`).toEqual(['message-copy']);
    const assistantMeta = metaIn(assistantRow);
    await bubbleIn(assistantRow).hover();
    await expect(assistantMeta).toHaveCSS('opacity', '1');
    expect(await toolNames(assistantMeta), `${width}px: Coordinator tools`).toEqual(['message-copy']);
  });
}

test('select-to-quote works on both user and Coordinator messages without a hover reply button', async ({
  page,
}) => {
  const { stream, sent } = await openConversation(page, 1440, 'light');
  await expect(stream.getByTestId('chief-msg-reply')).toHaveCount(0);

  const assistantBubble = stream
    .getByTestId('chief-msg')
    .filter({ hasText: SHORT_ASSISTANT_MSG })
    .getByTestId('chief-reply-bubble');
  await dragSelectBubble(page, assistantBubble);
  const bar = page.getByTestId('selection-reply-bar');
  await expect(bar).toBeVisible();
  await expect(bar).toHaveAttribute('data-source', 'a-short');
  await bar.getByTestId('selection-quote').click();
  const quoteInput = page.getByTestId('selection-quote-input');
  await quoteInput.fill('明白');
  await quoteInput.press('Enter');
  await expect(page.getByTestId('composer-reply-quote')).toContainText('有结果马上同步你');
  const composer = page.getByTestId('home-c').getByTestId('chief-composer-input');
  await composer.press('Enter');
  await expect.poll(() => sent.at(-1)).toMatch(/^<!-- reply source=a-short -->\n> .+\n\n明白$/);

  const userBubble = stream
    .getByTestId('chief-msg')
    .filter({ hasText: SHORT_USER_MSG })
    .getByTestId('chief-bubble');
  await dragSelectBubble(page, userBubble);
  await expect(bar).toBeVisible();
  await expect(bar).toHaveAttribute('data-source', 'u-short');
  await bar.getByTestId('selection-quote').click();
  await quoteInput.fill('再补一句');
  await quoteInput.press('Enter');
  await expect(page.getByTestId('composer-reply-quote')).toContainText('跑完告诉我');
});

test('steering owner row shows copy and a direct withdraw button beside it', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const now = Date.now();
  await mockLive(page, {
    threads: [
      {
        ...THREAD,
        activeRun: { runId: 'run-1', status: 'running', startedAt: now - 10_000 },
        pending: [{ messageId: 'u-steer', state: 'steering' }],
      } as typeof THREAD,
    ],
    messages: [
      { id: 'u1', role: 'user', content: USER_MSG, createdAt: now - 60_000 },
      { id: 'u-steer', role: 'user', content: '顺便核对一下环境变量', createdAt: now - 5_000 },
    ],
  });
  await page.goto('/app');
  const stream = page.getByTestId('home-c').getByTestId('chief-stream');
  const steerRow = rowOf(stream, '顺便核对一下环境变量');
  const steerMeta = metaIn(steerRow);
  await bubbleIn(steerRow).hover();
  await expect(steerMeta).toHaveCSS('opacity', '1');
  expect(await toolNames(steerMeta), 'steer row adds withdraw after copy').toEqual([
    'message-copy',
    'chief-steer-withdraw',
  ]);
  await expect(steerMeta.getByTestId('chief-steer-withdraw')).toHaveAccessibleName('撤回');
  await expect(page.getByRole('menu')).toHaveCount(0);
});

for (const scheme of ['light', 'dark'] as const) {
  for (const width of [1440, COMPACT_WIDTH] as const) {
    for (const [side, text, next] of [
      ['owner', USER_MSG, ASSISTANT_MSG],
      ['coordinator', ASSISTANT_MSG, SHORT_USER_MSG],
    ] as const) {
      test(`${width}px ${side} meta sits beside its bubble on the outer side, hidden at rest, without moving anything (${scheme})`, async ({
        page,
      }) => {
        const { stream } = await openConversation(page, width, scheme);
        const row = rowOf(stream, text);
        const bubble = bubbleIn(row);
        const meta = metaIn(row);
        const nextBubble = bubbleIn(rowOf(stream, next));
        await bubble.scrollIntoViewIfNeeded();
        await page.mouse.move(0, 0);
        await expect(meta, `C3 ${side} ${width} ${scheme}: meta row is hidden at rest`).toHaveCSS(
          'opacity',
          '0',
        );
        const bubbleBefore = await boxOf(bubble, 'bubble before hover');
        const nextBefore = await boxOf(nextBubble, 'next bubble before hover');

        await bubble.hover();
        await expect(meta).toHaveCSS('opacity', '1');
        await captureRowShot(page, `${PHASE}-${side}-${width}-${scheme}.png`, stream, row);

        const bubbleBox = await boxOf(bubble, 'bubble');
        const metaBox = await boxOf(meta, 'meta row');
        const streamBox = await boxOf(stream, 'stream');
        expect(Math.round(bubbleBox.y), 'hover does not shift the bubble').toBe(
          Math.round(bubbleBefore.y),
        );
        expect(
          Math.round((await boxOf(nextBubble, 'next bubble')).y),
          'hover does not shift the next message',
        ).toBe(Math.round(nextBefore.y));
        expect(overlaps(metaBox, bubbleBox), 'meta row does not intersect its bubble').toBe(false);
        expect(overlaps(metaBox, nextBefore), 'meta row does not intersect the next bubble').toBe(false);
        expect(
          metaBox.y + metaBox.height,
          'meta sits on the bubble\'s last line',
        ).toBeLessThanOrEqual(bubbleBox.y + bubbleBox.height);
        if (side === 'owner')
          expect(
            bubbleBox.x - (metaBox.x + metaBox.width),
            'owner meta sits just left of the bubble',
          ).toBeGreaterThanOrEqual(0);
        else
          expect(
            metaBox.x - (bubbleBox.x + bubbleBox.width),
            'reply meta sits just right of the bubble',
          ).toBeGreaterThanOrEqual(0);
        expect(metaBox.x, 'meta row stays inside the stream').toBeGreaterThanOrEqual(streamBox.x);
        expect(metaBox.x + metaBox.width).toBeLessThanOrEqual(streamBox.x + streamBox.width + 1);
        await assertPlainTime(meta, `${side} ${width} ${scheme}`);
        for (const btn of await meta.locator('button').all()) {
          const btnBox = await boxOf(btn, 'meta button');
          expect(btnBox.width, 'A1: desktop hit target >= 24px').toBeGreaterThanOrEqual(24);
          expect(btnBox.height, 'A1: desktop hit target >= 24px').toBeGreaterThanOrEqual(24);
          expect(await isHittable(btn), 'meta button is reachable').toBe(true);
        }
      });
    }
  }
}

test('390px: no horizontal scroll and no hover meta row on either side', async ({ page }) => {
  const { stream } = await openConversation(page, 390, 'light');
  await bubbleIn(rowOf(stream, USER_MSG)).hover();
  await expect(stream.locator('[data-slot="message-meta"]')).toHaveCount(0);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  expect(overflow, 'R1: no horizontal scroll at 390px').toBeLessThanOrEqual(0);
});

test('the meta sits beside its bubble and takes no line, so the turn gap is 24px (C3)', async ({
  page,
}) => {
  const { stream } = await openConversation(page, 1440, 'light');
  const userRow = rowOf(stream, USER_MSG);
  const userBox = await boxOf(bubbleIn(userRow), 'owner bubble');
  const replyBox = await boxOf(bubbleIn(rowOf(stream, ASSISTANT_MSG)), 'reply bubble');
  const metaBox = await boxOf(metaIn(userRow), 'owner meta');
  expect(metaBox.x + metaBox.width, 'C3: the owner meta sits left of its bubble').toBeLessThanOrEqual(userBox.x);
  expect(
    Math.round(replyBox.y - (userBox.y + userBox.height)),
    'C3: the turn gap holds no meta line',
  ).toBe(24);

  const wideRow = rowOf(stream, WIDE_USER_MSG);
  await bubbleIn(wideRow).scrollIntoViewIfNeeded();
  await bubbleIn(wideRow).hover();
  await expect(metaIn(wideRow)).toHaveCSS('opacity', '1');
  expect(
    overlaps(await boxOf(metaIn(wideRow), 'wide meta'), await boxOf(bubbleIn(wideRow), 'wide bubble')),
    'wide owner bubble never overlaps its meta',
  ).toBe(false);
});

test('the latest reply shows its meta row on hover only and clears the composer', async ({ page }) => {
  const { stream } = await openConversation(page, 1440, 'light');
  const latestRow = rowOf(stream, SHORT_ASSISTANT_MSG);
  const latestBubble = bubbleIn(latestRow);
  const latestMeta = metaIn(latestRow);
  await page.mouse.move(0, 0);
  await expect(latestMeta, 'latest reply meta row is hidden at rest').toHaveCSS('opacity', '0');
  const rowHeightBefore = (await boxOf(latestRow, 'latest row before hover')).height;
  await latestBubble.hover();
  await expect(latestMeta).toHaveCSS('opacity', '1');
  expect(Math.round((await boxOf(latestRow, 'latest row hovered')).height)).toBe(
    Math.round(rowHeightBefore),
  );
  const metaBox = await boxOf(latestMeta, 'latest meta row');
  const composerBox = await boxOf(page.getByTestId('home-c').locator('.chief-composer'), 'composer');
  expect(metaBox.y + metaBox.height, 'latest meta row stays above the composer').toBeLessThanOrEqual(
    composerBox.y,
  );
  expect(await isHittable(latestMeta.getByTestId('message-copy'))).toBe(true);
});

test('consecutive replies minutes apart are separate bubbles with no time line, and a hovered meta row never reaches the next', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const now = Date.now();
  await mockLive(page, {
    threads: [THREAD],
    messages: [
      { id: 'u-1', role: 'user', content: SHORT_USER_MSG, createdAt: now - 330_000 },
      { id: 'a-1', role: 'assistant', content: '第一条连续回复。', createdAt: now - 300_000 },
      { id: 'a-2', role: 'assistant', content: '第二条连续回复。', createdAt: now - 30_000 },
    ],
  });
  await page.goto('/app');
  const stream = page.getByTestId('home-c').getByTestId('chief-stream');
  await expect(stream).toContainText('第二条连续回复。');
  const first = rowOf(stream, '第一条连续回复。');
  const second = rowOf(stream, '第二条连续回复。');
  await expect(stream.getByTestId('chief-time-divider'), 'no time line under an hour').toHaveCount(0);
  await expect(bubbleIn(first)).toHaveCount(1);
  await expect(bubbleIn(second)).toHaveCount(1);
  const secondBox = await boxOf(bubbleIn(second), 'second reply');
  await bubbleIn(first).hover();
  await expect(metaIn(first)).toHaveCSS('opacity', '1');
  expect(overlaps(await boxOf(metaIn(first), 'first meta'), secondBox)).toBe(false);
});
