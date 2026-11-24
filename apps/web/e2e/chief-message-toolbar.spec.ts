import { expect, type Locator, type Page, test } from '@playwright/test';
import { mockLive, THREAD } from './chief-home-mock.js';
import { evidencePanelShot } from './evidence.js';

type Box = { x: number; y: number; width: number; height: number };

const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

const WIDE_USER =
  '不用软链接了。新的打包流程跑通后，把那两个停下的任务一起重新推送到测试环境，顺便核对一下推送日志里有没有遗漏的环境变量。';
const WIDE_ASSISTANT =
  '好的，软链接已经去掉。新的打包流程跑通后会把那两个停下的任务一起重新推到测试环境，并核对推送日志里的环境变量。';
const SHORT_USER = '好，跑完告诉我';
const SHORT_ASSISTANT = '收到，有结果马上同步你。';

const opacityOf = (locator: Locator) =>
  locator.evaluate((node) => Number(getComputedStyle(node).opacity));

async function openConversation(page: Page, width: number, scheme: 'light' | 'dark') {
  await page.setViewportSize({ width, height: width <= 420 ? 844 : 900 });
  await page.emulateMedia({ colorScheme: scheme });
  await page.addInitScript((value) => localStorage.setItem('cairn-theme', value), scheme);
  const now = Date.now();
  await mockLive(page, {
    threads: [THREAD],
    messages: [
      { id: 'u-wide', role: 'user', content: WIDE_USER, createdAt: now - 180_000 },
      { id: 'a-wide', role: 'assistant', content: WIDE_ASSISTANT, createdAt: now - 120_000 },
      { id: 'u-short', role: 'user', content: SHORT_USER, createdAt: now - 60_000 },
      { id: 'a-short', role: 'assistant', content: SHORT_ASSISTANT, createdAt: now - 30_000 },
    ],
  });
  await page.goto('/app');
  const stream = page.getByTestId('home-c').getByTestId('chief-stream');
  await expect(stream).toContainText(SHORT_ASSISTANT);
  return stream;
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

async function isHittable(target: Locator): Promise<boolean> {
  return target.evaluate((el) => {
    const box = el.getBoundingClientRect();
    const top = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return top !== null && el.contains(top);
  });
}

async function assertPlainCaption(toolbar: Locator, label: string) {
  const meta = toolbar.locator('[data-slot="message-toolbar-meta"]');
  await expect(meta, `${label}: timestamp meta is visible`).toBeVisible();
  await expect(meta, `${label}: timestamp text renders`).toHaveText(/\d{1,2}:\d{2}/);
  const style = await meta.evaluate((el) => {
    const cs = getComputedStyle(el);
    const stamp = el.querySelector('[data-testid="chief-msg-stamp"]');
    const stampCs = stamp ? getComputedStyle(stamp) : cs;
    return {
      bg: cs.backgroundColor,
      shadow: cs.boxShadow,
      border: cs.borderTopWidth,
      tabular: stampCs.fontVariantNumeric,
    };
  });
  expect(style.bg, `${label}: time is plain caption, not a filled pill`).toBe('rgba(0, 0, 0, 0)');
  expect(style.shadow, `${label}: time has no pill shadow`).toBe('none');
  expect(style.border, `${label}: time has no pill border`).toBe('0px');
  expect(style.tabular, `${label}: time uses tabular figures (V27)`).toContain('tabular-nums');
}

const phase = process.env.MSG_TOOLBAR_SHOT_PHASE ?? 'after';

for (const scheme of ['light', 'dark'] as const) {
  for (const width of [1440, 390]) {
    test(`both sides place one unified toolbar below the bubble with no overlap (${scheme}, ${width}px)`, async ({
      page,
    }) => {
      const stream = await openConversation(page, width, scheme);
      const rows = stream.getByTestId('chief-virtual-rows');
      const userRow = stream.getByTestId('chief-msg').filter({ hasText: WIDE_USER });
      const userBubble = userRow.getByTestId('chief-bubble');
      const userTools = userRow.getByTestId('chief-msg-tools');
      const assistantRow = stream.getByTestId('chief-msg').filter({ hasText: WIDE_ASSISTANT });
      const assistantBubble = assistantRow.getByTestId('chief-reply-bubble');
      const assistantTools = assistantRow.getByTestId('chief-msg-foot');

      await userBubble.hover();
      await expect.poll(() => opacityOf(userTools)).toBe(1);
      await evidencePanelShot(page, `${phase}-user-${scheme}-${width}.png`, rows, 48);

      const userBubbleBox = await userBubble.boundingBox();
      const userToolsBox = await userTools.boundingBox();
      const userOrder = await toolOrder(userTools);
      const userButtonBoxes = await userTools
        .locator('button[data-tool], [data-slot="message-toolbar-meta"]')
        .evaluateAll((els) =>
          els.map((el) => {
            const r = el.getBoundingClientRect();
            return { x: r.x, y: r.y, width: r.width, height: r.height };
          }),
        );

      const userIconBoxes = await userTools
        .locator('button[data-tool] svg')
        .evaluateAll((els) =>
          els.map((el) => {
            const r = el.getBoundingClientRect();
            return { x: r.x, y: r.y, width: r.width, height: r.height };
          }),
        );

      await assistantBubble.hover();
      await expect.poll(() => opacityOf(assistantTools)).toBe(1);
      await evidencePanelShot(page, `${phase}-assistant-${scheme}-${width}.png`, rows, 48);

      const assistantBubbleBox = await assistantBubble.boundingBox();
      const assistantToolsBox = await assistantTools.boundingBox();
      const assistantOrder = await toolOrder(assistantTools);
      const assistantButtonBoxes = await assistantTools
        .locator('button[data-tool], [data-slot="message-toolbar-meta"]')
        .evaluateAll((els) =>
          els.map((el) => {
            const r = el.getBoundingClientRect();
            return { x: r.x, y: r.y, width: r.width, height: r.height };
          }),
        );
      const assistantIconBoxes = await assistantTools
        .locator('button[data-tool] svg')
        .evaluateAll((els) =>
          els.map((el) => {
            const r = el.getBoundingClientRect();
            return { x: r.x, y: r.y, width: r.width, height: r.height };
          }),
        );

      expect(userBubbleBox).not.toBeNull();
      expect(userToolsBox).not.toBeNull();
      expect(assistantBubbleBox).not.toBeNull();
      expect(assistantToolsBox).not.toBeNull();
      if (!userBubbleBox || !userToolsBox || !assistantBubbleBox || !assistantToolsBox) return;

      expect(overlaps(userToolsBox, userBubbleBox), 'user toolbar must not overlap bubble').toBe(
        false,
      );
      expect(
        overlaps(userToolsBox, assistantBubbleBox),
        'user toolbar must not overlap the next bubble below',
      ).toBe(false);
      expect(
        userToolsBox.y,
        'user toolbar sits below the user bubble',
      ).toBeGreaterThanOrEqual(userBubbleBox.y + userBubbleBox.height - 0.5);
      for (const icon of userIconBoxes) {
        expect(
          icon.y,
          'user toolbar icons keep a visible gap below the user bubble',
        ).toBeGreaterThanOrEqual(userBubbleBox.y + userBubbleBox.height + 3);
      }
      for (const part of userButtonBoxes) {
        expect(overlaps(part, userBubbleBox), 'user toolbar item must not overlap bubble').toBe(
          false,
        );
      }
      expect(
        Math.abs(userToolsBox.x + userToolsBox.width - (userBubbleBox.x + userBubbleBox.width)),
        'user toolbar is right-aligned to the user bubble edge',
      ).toBeLessThanOrEqual(1.5);

      expect(
        overlaps(assistantToolsBox, assistantBubbleBox),
        'assistant toolbar must not overlap bubble',
      ).toBe(false);
      expect(
        assistantToolsBox.y,
        'assistant toolbar sits below the assistant bubble',
      ).toBeGreaterThanOrEqual(assistantBubbleBox.y + assistantBubbleBox.height - 0.5);
      for (const icon of assistantIconBoxes) {
        expect(
          icon.y,
          'assistant toolbar icons keep a visible gap below the assistant bubble',
        ).toBeGreaterThanOrEqual(assistantBubbleBox.y + assistantBubbleBox.height + 3);
      }
      for (const part of assistantButtonBoxes) {
        expect(
          overlaps(part, assistantBubbleBox),
          'assistant toolbar item must not overlap bubble',
        ).toBe(false);
      }
      expect(
        Math.abs(assistantToolsBox.x - assistantBubbleBox.x),
        'assistant toolbar is left-aligned to the assistant bubble edge',
      ).toBeLessThanOrEqual(1.5);

      expect(userOrder, 'user toolbar button order is copy, reply, more').toEqual([
        'copy',
        'reply',
        'more',
      ]);
      expect(assistantOrder, 'assistant toolbar button order is copy, reply').toEqual([
        'copy',
        'reply',
      ]);
      expect(
        userOrder.slice(0, assistantOrder.length),
        'both sides render the shared buttons in the same order',
      ).toEqual(assistantOrder);

      await assertPlainCaption(assistantTools, 'assistant');
      for (const btn of await assistantTools.locator('button[data-tool]').all()) {
        expect(await isHittable(btn), 'assistant toolbar button is clickable').toBe(true);
      }
      await assistantTools.getByTestId('chief-msg-copy').hover();
      await expect.poll(() => opacityOf(assistantTools)).toBe(1);
      await expect(page.locator('[data-slot="tooltip-content"]')).toHaveText('复制');

      await userBubble.hover();
      await expect.poll(() => opacityOf(userTools)).toBe(1);
      await assertPlainCaption(userTools, 'user');
      for (const btn of await userTools.locator('button[data-tool]').all()) {
        expect(await isHittable(btn), 'user toolbar button is clickable').toBe(true);
      }
      await userTools.getByTestId('chief-msg-copy').hover();
      await expect.poll(() => opacityOf(userTools)).toBe(1);
      await expect(page.locator('[data-slot="tooltip-content"]')).toHaveText('复制');

      await page.mouse.move(0, 0);
      await expect.poll(() => opacityOf(userTools)).toBe(0);
      await expect.poll(() => opacityOf(assistantTools)).toBe(0);

      const gapBetweenTurns = assistantBubbleBox.y - (userBubbleBox.y + userBubbleBox.height);
      expect(gapBetweenTurns, 'C3: hidden toolbar takes no layout space (16-24px gap)').toBeGreaterThanOrEqual(
        16,
      );
      expect(gapBetweenTurns, 'C3: hidden toolbar takes no layout space (16-24px gap)').toBeLessThanOrEqual(
        24,
      );

      if (width === 390) {
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - window.innerWidth,
        );
        expect(overflow, 'R1: no horizontal scroll at 390px').toBeLessThanOrEqual(0);
      }
    });
  }
}

test('reply button works from both user and assistant below-bubble toolbars', async ({ page }) => {
  const stream = await openConversation(page, 1440, 'light');
  const assistantRow = stream.getByTestId('chief-msg').filter({ hasText: WIDE_ASSISTANT });
  await assistantRow.getByTestId('chief-reply-bubble').hover();
  await assistantRow.getByTestId('chief-msg-foot').getByTestId('chief-msg-reply').click();
  await expect(page.getByTestId('composer-reply-quote')).toContainText('软链接已经去掉');
  await page.getByTestId('composer-reply-quote-remove').click();
  await expect(page.getByTestId('composer-reply-quote')).toHaveCount(0);

  const userRow = stream.getByTestId('chief-msg').filter({ hasText: WIDE_USER });
  await userRow.getByTestId('chief-bubble').hover();
  await userRow.getByTestId('chief-msg-tools').getByTestId('chief-msg-reply').click();
  await expect(page.getByTestId('composer-reply-quote')).toContainText('不用软链接了');
});
