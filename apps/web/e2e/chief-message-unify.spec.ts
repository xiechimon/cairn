import { expect, type Locator, type Page, test } from '@playwright/test';
import { mockLive, THREAD } from './chief-home-mock';

const HOUR = 60 * 60 * 1000;
const BASE = Date.UTC(2026, 10, 26, 6, 0, 0);

const CONVERSATION = [
  { id: 'u1', role: 'user', content: 'CI 为什么挂了？', createdAt: BASE },
  { id: 'r1', role: 'assistant', content: '失败在 pnpm install 这一步。', createdAt: BASE + 60_000 },
  { id: 'r2', role: 'assistant', content: 'lockfile 没有一起提交。', createdAt: BASE + 120_000 },
  { id: 'r3', role: 'assistant', content: '要我现在提交并重跑吗？', createdAt: BASE + 180_000 },
  { id: 'u2', role: 'user', content: '半小时后再说', createdAt: BASE + 30 * 60_000 },
  { id: 'u3', role: 'user', content: '先看看测试', createdAt: BASE + 31 * 60_000 },
  { id: 'r4', role: 'assistant', content: '好，等你。', createdAt: BASE + 2 * HOUR },
];

async function open(page: Page) {
  await mockLive(page, { threads: [THREAD], messages: CONVERSATION, todos: [], tasks: [] });
  await page.goto('/app');
  const stream = page.getByTestId('chief-stream');
  await expect(stream.locator('[data-slot="message-bubble"]')).toHaveCount(7);
  return stream;
}

const bubbleOf = (stream: Locator, text: string) =>
  stream.locator('[data-slot="message-bubble"]').filter({ hasText: text });

const metaOf = (bubble: Locator) =>
  bubble.locator('xpath=ancestor::*[@data-slot="message"][1]').locator('[data-slot="message-meta"]');

async function look(bubble: Locator) {
  return bubble.evaluate((el) => {
    const css = getComputedStyle(el);
    return {
      radius: css.borderTopLeftRadius,
      padding: `${css.paddingTop} ${css.paddingRight} ${css.paddingBottom} ${css.paddingLeft}`,
      font: css.fontFamily,
      size: css.fontSize,
      background: css.backgroundColor,
    };
  });
}

async function corners(bubble: Locator) {
  return bubble.evaluate((el) => {
    const css = getComputedStyle(el);
    return [
      css.borderTopLeftRadius,
      css.borderTopRightRadius,
      css.borderBottomRightRadius,
      css.borderBottomLeftRadius,
    ].map((r) => Number.parseFloat(r));
  });
}

async function expectGroup(stream: Locator, texts: string[], inner: 'left' | 'right') {
  const boxes = [];
  for (const text of texts) boxes.push((await bubbleOf(stream, text).boundingBox())!);
  for (let n = 1; n < boxes.length; n++) {
    const gap = boxes[n].y - (boxes[n - 1].y + boxes[n - 1].height);
    expect(gap, `${texts[n]}: tight gap inside the group`).toBeLessThanOrEqual(4);
  }
  const [topIndex, bottomIndex] = inner === 'left' ? [0, 3] : [1, 2];
  for (const [n, text] of texts.entries()) {
    const r = await corners(bubbleOf(stream, text));
    const top = r[topIndex];
    const bottom = r[bottomIndex];
    expect(top < 18, `${text}: inner top corner joins the one above`).toBe(n > 0);
    if (inner === 'left' || n < texts.length - 1)
      expect(bottom < 18, `${text}: inner bottom corner joins the one below`).toBe(n < texts.length - 1);
    const outer = inner === 'left' ? [r[1], r[2]] : [r[0], r[3]];
    expect(outer, `${text}: outer corners stay round`).toEqual([18, 18]);
  }
}

async function tokenColor(page: Page, token: string) {
  return page.evaluate((value) => {
    const probe = document.createElement('div');
    probe.style.backgroundColor = value;
    document.body.append(probe);
    const out = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return out;
  }, `var(${token})`);
}

test.describe('desktop', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('owner and Coordinator messages are the same bubble, coloured by side', async ({ page }) => {
    const stream = await open(page);
    const owner = await look(bubbleOf(stream, 'CI 为什么挂了'));
    const reply = await look(bubbleOf(stream, '失败在 pnpm install'));
    expect(reply.radius, 'same radius').toBe(owner.radius);
    expect(reply.padding, 'same padding').toBe(owner.padding);
    expect(reply.font, 'one face for both sides').toBe(owner.font);
    expect(reply.size, 'one size for both sides').toBe(owner.size);
    expect(owner.background, 'the owner keeps the sand bubble').toBe(
      await tokenColor(page, '--bubble-fill'),
    );
    expect(reply.background, 'the Coordinator bubble is the reply grey').toBe(
      await tokenColor(page, '--reply-bubble-fill'),
    );
  });

  test('the meta sits beside each bubble on its outer side, on the last line, without moving anything', async ({
    page,
  }) => {
    const stream = await open(page);
    for (const [text, side] of [
      ['CI 为什么挂了', 'owner'],
      ['失败在 pnpm install', 'coordinator'],
      ['好，等你', 'coordinator'],
    ] as const) {
      const bubble = bubbleOf(stream, text);
      const meta = metaOf(bubble);
      await expect(meta).toHaveCount(1);
      const rest = (await bubble.boundingBox())!;
      await bubble.hover();
      await expect(meta).toHaveCSS('opacity', '1');
      await expect(meta.locator('time')).toBeVisible();
      await expect(meta.getByRole('button', { name: '复制' })).toBeVisible();
      const b = (await bubble.boundingBox())!;
      const m = (await meta.boundingBox())!;
      expect(b, `${text}: hover moves nothing`).toEqual(rest);
      if (side === 'owner') {
        expect(m.x + m.width, 'owner: meta left of the bubble').toBeLessThanOrEqual(b.x);
        expect(b.x - (m.x + m.width), 'owner: meta hugs the bubble').toBeLessThanOrEqual(12);
      } else {
        expect(m.x, 'Coordinator: meta right of the bubble').toBeGreaterThanOrEqual(b.x + b.width);
        expect(m.x - (b.x + b.width), 'Coordinator: meta hugs the bubble').toBeLessThanOrEqual(12);
      }
      const lastLine = b.y + b.height - 8 - 10;
      expect(Math.abs(m.y + m.height / 2 - lastLine), 'centred on the last line').toBeLessThanOrEqual(3);
    }
    await expect(stream.locator('[data-slot="message-meta-row"]')).toHaveCount(0);
  });

  test('consecutive bubbles from one side join into a group', async ({ page }) => {
    const stream = await open(page);
    await expectGroup(stream, ['失败在 pnpm install', 'lockfile 没有', '要我现在提交'], 'left');
    await expectGroup(stream, ['半小时后再说', '先看看测试'], 'right');
    const owner = (await bubbleOf(stream, 'CI 为什么挂了').boundingBox())!;
    const reply = (await bubbleOf(stream, '失败在 pnpm install').boundingBox())!;
    expect(reply.y - (owner.y + owner.height), 'a new speaker starts a new group').toBeGreaterThanOrEqual(16);
  });

  test('the meta row is reachable by keyboard and visible on focus', async ({ page }) => {
    const stream = await open(page);
    const meta = metaOf(bubbleOf(stream, '失败在 pnpm install'));
    await meta.getByRole('button', { name: '复制' }).focus();
    await expect(meta).toHaveCSS('opacity', '1');
  });

  test('time dividers only at a gap over an hour; consecutive replies are separate bubbles', async ({
    page,
  }) => {
    const stream = await open(page);
    await expect(stream.locator('[data-slot="message-bubble"][data-side="coordinator"]')).toHaveCount(4);
    const dividers = stream.getByTestId('chief-time-divider');
    await expect(dividers, 'one divider: before the reply that came after 1.5 hours').toHaveCount(1);
    const divider = (await dividers.boundingBox())!;
    const late = (await bubbleOf(stream, '好，等你').boundingBox())!;
    const owner2 = (await bubbleOf(stream, '半小时后再说').boundingBox())!;
    expect(divider.y).toBeGreaterThan(owner2.y);
    expect(divider.y).toBeLessThan(late.y);
  });

  test('the conversation speaks in the same sans face as the bubbles, with no serif anywhere', async ({ page }) => {
    const stream = await open(page);
    const sans = await look(bubbleOf(stream, '失败在 pnpm install'));
    const serifLeft = await page.evaluate(
      () =>
        [...document.querySelectorAll('[data-testid="chief-stream"] *')].filter((el) =>
          getComputedStyle(el).fontFamily.includes('sourceSerif4'),
        ).length,
    );
    expect(serifLeft, 'no serif in the conversation').toBe(0);
    expect(sans.font).not.toContain('sourceSerif4');
  });
});

test.describe('touch', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  for (const text of ['CI 为什么挂了', '失败在 pnpm install']) {
    test(`a long press on "${text}" opens the time, copy and select text`, async ({ page, context }) => {
      const stream = await open(page);
      const bubble = bubbleOf(stream, text);
      await bubble.scrollIntoViewIfNeeded();
      await expect(metaOf(bubble)).toBeHidden();
      const box = (await bubble.boundingBox())!;
      const cdp = await context.newCDPSession(page);
      const point = [{ x: box.x + box.width / 2, y: box.y + box.height / 2 }];
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: point });
      await page.waitForTimeout(700);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      const menu = page.getByRole('menu');
      await expect(menu.locator('time')).toBeVisible();
      await expect(menu.getByRole('menuitem')).toHaveText(['复制', '选择文字']);
    });
  }

  test('consecutive bubbles join into a group on the phone too', async ({ page }) => {
    const stream = await open(page);
    await expectGroup(stream, ['失败在 pnpm install', 'lockfile 没有', '要我现在提交'], 'left');
    await expectGroup(stream, ['半小时后再说', '先看看测试'], 'right');
  });
});
