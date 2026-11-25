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

async function toolOrder(toolbar: Locator): Promise<string[]> {
  return toolbar.locator('button[data-tool]').evaluateAll((els) =>
    els
      .map((el) => ({
        tool: el.getAttribute('data-tool') ?? '',
        x: el.getBoundingClientRect().x,
      }))
      .sort((a, b) => a.x - b.x)
      .map((entry) => entry.tool),
  );
}

async function sharedRowTools(toolbar: Locator): Promise<string[]> {
  return (await toolOrder(toolbar)).filter((tool) => tool !== 'more');
}

async function assertPlainMeta(toolbar: Locator, label: string) {
  const meta = toolbar.locator('[data-slot="message-toolbar-meta"]');
  await expect(meta, `${label}: timestamp is visible`).toBeVisible();
  await expect(meta, `${label}: timestamp renders HH:MM`).toHaveText(/\d{1,2}:\d{2}/);
  const style = await meta.evaluate((el) => {
    const cs = getComputedStyle(el);
    const stamp = el.querySelector('[data-testid="chief-msg-stamp"]');
    const stampCs = stamp ? getComputedStyle(stamp) : cs;
    return {
      bg: cs.backgroundColor,
      shadow: cs.boxShadow,
      tabular: stampCs.fontVariantNumeric,
    };
  });
  expect(style.bg, `${label}: timestamp has no popover backing`).toBe('rgba(0, 0, 0, 0)');
  expect(style.shadow, `${label}: timestamp has no shadow`).toBe('none');
  expect(style.tabular, `${label}: timestamp uses tabular figures (V27)`).toContain('tabular-nums');
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
  test(`user and assistant toolbars expose the same visible data-tool set with no reply button (${width}px)`, async ({
    page,
  }) => {
    const { stream } = await openConversation(page, width, 'light');
    const userRow = stream.getByTestId('chief-msg').filter({ hasText: USER_MSG });
    const assistantRow = stream.getByTestId('chief-msg').filter({ hasText: ASSISTANT_MSG });

    const userBubble = userRow.getByTestId('chief-bubble');
    const userTools = userRow.getByTestId('chief-msg-tools');
    await userBubble.scrollIntoViewIfNeeded();
    await userBubble.hover();
    await expect(userTools).toHaveCSS('opacity', '1');
    await expect(userTools.getByTestId('chief-msg-reply')).toHaveCount(0);
    const userVisible = await sharedRowTools(userTools);

    const assistantBubble = assistantRow.getByTestId('chief-reply-bubble');
    const assistantTools = assistantRow.getByTestId('chief-msg-foot');
    await assistantBubble.scrollIntoViewIfNeeded();
    await assistantBubble.hover();
    await expect(assistantTools).toHaveCSS('opacity', '1');
    await expect(assistantTools.getByTestId('chief-msg-reply')).toHaveCount(0);
    const assistantVisible = await sharedRowTools(assistantTools);

    expect(userVisible, `${width}px: user visible tools`).toEqual(['copy']);
    expect(
      assistantVisible,
      `${width}px: assistant visible data-tool set and order match user`,
    ).toEqual(userVisible);
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

test('steering user row keeps the same visible toolbar and places withdraw inside the more menu', async ({
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
  const steerRow = stream.getByTestId('chief-msg').filter({ hasText: '顺便核对一下环境变量' });
  const steerTools = steerRow.getByTestId('chief-msg-tools');
  await steerRow.getByTestId('chief-bubble').hover();
  await expect(steerTools).toHaveCSS('opacity', '1');
  expect(await toolOrder(steerTools), 'steer row keeps the same top-level buttons').toEqual([
    'copy',
    'more',
  ]);
  await expect(steerTools.getByTestId('chief-msg-reply')).toHaveCount(0);
  await expect(steerTools.getByTestId('chief-steer-withdraw')).toHaveCount(0);
  await steerTools.getByTestId('chief-msg-more').click();
  await expect(page.getByTestId('chief-steer-withdraw')).toBeVisible();
  await expect(page.getByRole('menuitem', { name: '恢复到此处' })).toBeVisible();
});

for (const scheme of ['light', 'dark'] as const) {
  test(`1440px user toolbar stays beside the bubble on the left with unchanged geometry (${scheme})`, async ({
    page,
  }) => {
    const { stream } = await openConversation(page, 1440, scheme);
    const row = stream.getByTestId('chief-msg').filter({ hasText: USER_MSG });
    const bubble = row.getByTestId('chief-bubble');
    const tools = row.getByTestId('chief-msg-tools');
    await bubble.scrollIntoViewIfNeeded();
    const bubbleBefore = await boxOf(bubble, 'user bubble before hover');

    await bubble.hover();
    await expect(tools).toHaveCSS('opacity', '1');
    await captureRowShot(page, `${PHASE}-user-1440-${scheme}.png`, stream, row);

    await expect(tools).toHaveAttribute('data-placement', 'left');
    await expect(tools).not.toHaveAttribute('data-clamped');
    await expect(tools.getByTestId('chief-msg-reply')).toHaveCount(0);

    const bubbleBox = await boxOf(bubble, 'user bubble');
    const toolsBox = await boxOf(tools, 'user toolbar');
    const moreBox = await boxOf(tools.getByTestId('chief-msg-more'), 'user more button');
    const metaBox = await boxOf(tools.locator('[data-slot="message-toolbar-meta"]'), 'user meta');

    expect(Math.round(bubbleBox.y), 'hover does not shift bubble').toBe(Math.round(bubbleBefore.y));
    expect(overlaps(toolsBox, bubbleBox), 'toolbar does not intersect user bubble').toBe(false);
    expect(Math.round(toolsBox.x + toolsBox.width), 'toolbar meets bubble left edge').toBe(
      Math.round(bubbleBox.x),
    );
    expect(Math.round(bubbleBox.x - (moreBox.x + moreBox.width)), '12px gap beside bubble').toBe(12);
    expect(
      Math.abs(toolsBox.y + toolsBox.height / 2 - (bubbleBox.y + bubbleBox.height / 2)),
      'toolbar vertically centred on bubble',
    ).toBeLessThanOrEqual(1);
    expect(Math.round(moreBox.height), 'desktop side button stays 32px').toBe(32);
    expect(await toolOrder(tools)).toEqual(['copy', 'more']);
    expect(metaBox.x + metaBox.width, 'meta sits left of tool buttons').toBeLessThan(moreBox.x);
    await assertPlainMeta(tools, `1440 user ${scheme}`);
    for (const btn of await tools.locator('button[data-tool]').all()) {
      expect(await isHittable(btn), 'toolbar button is reachable').toBe(true);
    }
  });

  test(`1440px assistant toolbar sits below the reply at bottom-left without shifting layout (${scheme})`, async ({
    page,
  }) => {
    const { stream } = await openConversation(page, 1440, scheme);
    const row = stream.getByTestId('chief-msg').filter({ hasText: ASSISTANT_MSG });
    const bubble = row.getByTestId('chief-reply-bubble');
    const tools = row.getByTestId('chief-msg-foot');
    await bubble.scrollIntoViewIfNeeded();
    const bubbleBefore = await boxOf(bubble, 'assistant bubble before hover');

    await bubble.hover();
    await expect(tools).toHaveCSS('opacity', '1');
    await captureRowShot(page, `${PHASE}-assistant-1440-${scheme}.png`, stream, row);

    await expect(tools).toHaveAttribute('data-placement', 'below-start-hover');
    await expect(tools.getByTestId('chief-msg-reply')).toHaveCount(0);

    const bubbleBox = await boxOf(bubble, 'assistant bubble');
    const toolsBox = await boxOf(tools, 'assistant toolbar');
    const copyBox = await boxOf(tools.getByTestId('chief-msg-copy'), 'assistant copy button');
    const metaBox = await boxOf(
      tools.locator('[data-slot="message-toolbar-meta"]'),
      'assistant meta',
    );

    expect(Math.round(bubbleBox.y), 'hover does not shift bubble').toBe(Math.round(bubbleBefore.y));
    expect(overlaps(toolsBox, bubbleBox), 'toolbar does not intersect assistant bubble').toBe(false);
    expect(Math.round(toolsBox.x), 'toolbar aligns with bubble left edge').toBe(
      Math.round(bubbleBox.x),
    );
    expect(toolsBox.y, 'toolbar sits below the assistant reply').toBeGreaterThanOrEqual(
      bubbleBox.y + bubbleBox.height - 1,
    );
    expect(Math.round(copyBox.height), 'desktop button stays 32px').toBe(32);
    expect(await toolOrder(tools)).toEqual(['copy']);
    expect(copyBox.x + copyBox.width, 'copy button sits left of time').toBeLessThan(metaBox.x);
    await assertPlainMeta(tools, `1440 assistant ${scheme}`);
    expect(await isHittable(tools.getByTestId('chief-msg-copy'))).toBe(true);
  });

  for (const [label, width] of [
    ['compact', COMPACT_WIDTH],
    ['390', 390],
  ] as const) {
    test(`${label} (${width}px) user toolbar does not intersect the bubble (${scheme})`, async ({
      page,
    }) => {
      const { stream } = await openConversation(page, width, scheme);
      const row = stream.getByTestId('chief-msg').filter({ hasText: USER_MSG });
      const nextRow = stream.getByTestId('chief-msg').filter({ hasText: ASSISTANT_MSG });
      const bubble = row.getByTestId('chief-bubble');
      const nextBubble = nextRow.getByTestId('chief-reply-bubble');
      const tools = row.getByTestId('chief-msg-tools');
      await bubble.scrollIntoViewIfNeeded();
      const bubbleBefore = await boxOf(bubble, 'user bubble before hover');

      await bubble.hover();
      await expect(tools).toHaveCSS('opacity', '1');
      await captureRowShot(page, `${PHASE}-user-${label}-${scheme}.png`, stream, row);

      const streamBox = await boxOf(stream, 'stream');
      const bubbleBox = await boxOf(bubble, 'user bubble');
      const nextBubbleBox = await boxOf(nextBubble, 'next assistant bubble');
      const toolsBox = await boxOf(tools, 'user toolbar');

      expect(Math.round(bubbleBox.y), 'hover does not shift bubble').toBe(
        Math.round(bubbleBefore.y),
      );
      expect(
        overlaps(toolsBox, bubbleBox),
        `${label} user: toolbar must not intersect bubble`,
      ).toBe(false);
      expect(
        overlaps(toolsBox, nextBubbleBox),
        `${label} user: toolbar must not intersect the next bubble`,
      ).toBe(false);
      expect(toolsBox.x, `${label} user: toolbar stays inside stream left`).toBeGreaterThanOrEqual(
        streamBox.x,
      );
      expect(
        toolsBox.x + toolsBox.width,
        `${label} user: toolbar stays inside stream right`,
      ).toBeLessThanOrEqual(streamBox.x + streamBox.width + 1);
      expect(await toolOrder(tools)).toEqual(['copy', 'more']);
      await expect(tools.getByTestId('chief-msg-reply')).toHaveCount(0);
      await assertPlainMeta(tools, `${label} user ${scheme}`);
      for (const btn of await tools.locator('button[data-tool]').all()) {
        const btnBox = await boxOf(btn, 'user tool button');
        expect(overlaps(btnBox, bubbleBox), `${label} user: button must not overlap bubble`).toBe(
          false,
        );
        expect(btnBox.width, 'A1: desktop hit target >= 24px').toBeGreaterThanOrEqual(24);
        expect(btnBox.height, 'A1: desktop hit target >= 24px').toBeGreaterThanOrEqual(24);
        expect(await isHittable(btn), `${label} user: button is reachable`).toBe(true);
      }
      await tools.getByTestId('chief-msg-more').click();
      await expect(page.getByRole('menuitem', { name: '恢复到此处' })).toBeVisible();
      if (width === 390) {
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
        expect(overflow, 'R1: no horizontal scroll at 390px').toBeLessThanOrEqual(0);
      }
    });

    test(`${label} (${width}px) assistant toolbar does not intersect the bubble (${scheme})`, async ({
      page,
    }) => {
      const { stream } = await openConversation(page, width, scheme);
      const row = stream.getByTestId('chief-msg').filter({ hasText: ASSISTANT_MSG });
      const nextRow = stream.getByTestId('chief-msg').filter({ hasText: SHORT_USER_MSG });
      const bubble = row.getByTestId('chief-reply-bubble');
      const nextBubble = nextRow.getByTestId('chief-bubble');
      const tools = row.getByTestId('chief-msg-foot');
      await bubble.scrollIntoViewIfNeeded();
      const bubbleBefore = await boxOf(bubble, 'assistant bubble before hover');

      await bubble.hover();
      await expect(tools).toHaveCSS('opacity', '1');
      await captureRowShot(page, `${PHASE}-assistant-${label}-${scheme}.png`, stream, row);

      const streamBox = await boxOf(stream, 'stream');
      const bubbleBox = await boxOf(bubble, 'assistant bubble');
      const nextBubbleBox = await boxOf(nextBubble, 'next user bubble');
      const toolsBox = await boxOf(tools, 'assistant toolbar');

      expect(Math.round(bubbleBox.y), 'hover does not shift bubble').toBe(
        Math.round(bubbleBefore.y),
      );
      expect(
        overlaps(toolsBox, bubbleBox),
        `${label} assistant: toolbar must not intersect bubble`,
      ).toBe(false);
      expect(
        overlaps(toolsBox, nextBubbleBox),
        `${label} assistant: toolbar must not intersect the next bubble`,
      ).toBe(false);
      expect(
        toolsBox.x,
        `${label} assistant: toolbar stays inside stream left`,
      ).toBeGreaterThanOrEqual(streamBox.x);
      expect(
        toolsBox.x + toolsBox.width,
        `${label} assistant: toolbar stays inside stream right`,
      ).toBeLessThanOrEqual(streamBox.x + streamBox.width + 1);
      expect(await toolOrder(tools)).toEqual(['copy']);
      await expect(tools.getByTestId('chief-msg-reply')).toHaveCount(0);
      await assertPlainMeta(tools, `${label} assistant ${scheme}`);
      for (const btn of await tools.locator('button[data-tool]').all()) {
        const btnBox = await boxOf(btn, 'assistant tool button');
        expect(
          overlaps(btnBox, bubbleBox),
          `${label} assistant: button must not overlap bubble`,
        ).toBe(false);
        expect(btnBox.width, 'A1: desktop hit target >= 24px').toBeGreaterThanOrEqual(24);
        expect(btnBox.height, 'A1: desktop hit target >= 24px').toBeGreaterThanOrEqual(24);
        expect(await isHittable(btn), `${label} assistant: button is reachable`).toBe(true);
      }
    });
  }
}

test('wide user bubble never overlaps its toolbar even at 1440px, and unhovered spacing holds (C3)', async ({
  page,
}) => {
  const { stream } = await openConversation(page, 1440, 'light');
  const userRow = stream.getByTestId('chief-msg').filter({ hasText: USER_MSG });
  const assistantRow = stream.getByTestId('chief-msg').filter({ hasText: ASSISTANT_MSG });
  const gapBefore =
    (await boxOf(assistantRow.getByTestId('chief-reply-bubble'), 'assistant')).y -
    ((await boxOf(userRow.getByTestId('chief-bubble'), 'user')).y +
      (await boxOf(userRow.getByTestId('chief-bubble'), 'user')).height);
  expect(Math.round(gapBefore), 'C3: unhovered turn gap stays 24px').toBe(24);

  const wideRow = stream.getByTestId('chief-msg').filter({ hasText: WIDE_USER_MSG });
  const wideBubble = wideRow.getByTestId('chief-bubble');
  const wideTools = wideRow.getByTestId('chief-msg-tools');
  await wideBubble.scrollIntoViewIfNeeded();
  await wideBubble.hover();
  await expect(wideTools).toHaveCSS('opacity', '1');
  const bubbleBox = await boxOf(wideBubble, 'wide user bubble');
  const toolsBox = await boxOf(wideTools, 'wide user toolbar');
  expect(overlaps(toolsBox, bubbleBox), 'wide user toolbar must not intersect bubble').toBe(false);
  for (const btn of await wideTools.locator('button[data-tool]').all()) {
    expect(await isHittable(btn), 'wide user toolbar button is reachable').toBe(true);
  }
});
