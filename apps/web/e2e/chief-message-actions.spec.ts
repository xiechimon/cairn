import { expect, type Locator, type Page, test } from '@playwright/test';
import { mockLive, THREAD } from './chief-home-mock';
import { evidenceShot } from './evidence';
import { settleTransitions } from './helpers';

const MINUTE = 60_000;
const FLAT = /^(none|(rgba\(0, 0, 0, 0\) 0px 0px 0px 0px(, )?)+)$/;

async function mockHistory(page: Page, now = Date.now()) {
  const rows = [
    { id: 'a1', role: 'user', content: 'first question', createdAt: now - 3 * MINUTE },
    { id: 'a2', role: 'assistant', content: 'first answer', createdAt: now - 3 * MINUTE + 1 },
    { id: 'a3', role: 'user', content: 'second question', createdAt: now - 2 * MINUTE },
    { id: 'a4', role: 'assistant', content: 'second answer', createdAt: now - MINUTE },
  ];
  await mockLive(page, { threads: [THREAD], messages: [] }, (path, route, json) => {
    if (path !== `/api/conversations/${THREAD.id}/messages`) return undefined;
    if (route.request().method() !== 'GET') return undefined;
    return json({ messages: rows, nextCursor: null });
  });
}

const messageOf = (page: Page, text: string) =>
  page
    .getByTestId('home-c')
    .getByTestId('chief-msg')
    .filter({ has: page.getByText(text, { exact: true }) });
const opacityOf = (locator: Locator) =>
  locator.evaluate((node) => Number(getComputedStyle(node).opacity));
const tools = (message: Locator) =>
  message.locator('[data-testid="chief-msg-tools"], [data-testid="chief-msg-foot"]').first();
const touchTools = (message: Locator) => message.getByTestId('chief-msg-tools-touch');
const bubbleOf = (message: Locator) =>
  message.locator('[data-slot="reply-bubble"], [data-testid="chief-bubble"]').first();

test('older messages show their actions and time only on hover or keyboard focus', async ({
  page,
}) => {
  await mockHistory(page);
  await page.goto('/app');
  await expect(messageOf(page, 'second answer')).toBeVisible();
  await page.mouse.move(0, 0);

  const olderUser = messageOf(page, 'first question');
  const olderAnswer = messageOf(page, 'first answer');
  await expect.poll(() => opacityOf(tools(olderUser))).toBe(0);
  await expect.poll(() => opacityOf(tools(olderAnswer))).toBe(0);
  await evidenceShot(page, 'chief-actions-idle.png');

  await bubbleOf(olderUser).hover();
  await expect.poll(() => opacityOf(tools(olderUser))).toBe(1);
  await expect.poll(() => opacityOf(tools(olderAnswer))).toBe(0);
  await evidenceShot(page, 'chief-actions-hover.png');

  await page.mouse.move(0, 0);
  await expect.poll(() => opacityOf(tools(olderUser))).toBe(0);
  await tools(olderAnswer).getByTestId('chief-msg-reply').focus();
  await expect.poll(() => opacityOf(tools(olderAnswer))).toBe(1);
});

test('the newest message hides its actions until hover, like the others', async ({ page }) => {
  await mockHistory(page);
  await page.goto('/app');
  await page.mouse.move(0, 0);
  const newest = messageOf(page, 'second answer');
  await expect.poll(() => opacityOf(tools(newest))).toBe(0);
  await bubbleOf(newest).hover();
  await expect.poll(() => opacityOf(tools(newest))).toBe(1);
});

test('touch devices show no message actions until a bubble is tapped', async ({ browser }) => {
  const context = await browser.newContext({ hasTouch: true, isMobile: true });
  const page = await context.newPage();
  await mockHistory(page);
  await page.goto('/app');
  await expect(messageOf(page, 'first question')).toBeVisible();
  for (const text of ['first question', 'first answer', 'second question', 'second answer']) {
    await expect(touchTools(messageOf(page, text))).toBeHidden();
    await expect(tools(messageOf(page, text))).toBeHidden();
  }
  await expect(page.getByTestId('chief-msg-stamp').filter({ visible: true })).toHaveCount(0);
  await context.close();
});

test('the reveal is instant: no transition, no delay and no scale', async ({ page }) => {
  await mockHistory(page);
  await page.goto('/app');
  const older = messageOf(page, 'first question');
  await page.mouse.move(0, 0);
  const face = () =>
    tools(older).evaluate((node) => {
      const style = getComputedStyle(node);
      return {
        duration: style.transitionDuration,
        delay: style.transitionDelay,
        property: style.transitionProperty,
        transform: style.transform,
      };
    });
  expect(await face()).toMatchObject({ duration: '0s', delay: '0s', transform: 'none' });
  await bubbleOf(older).hover();
  expect(await face()).toMatchObject({ duration: '0s', delay: '0s', transform: 'none' });
});

test('each message shows its clock time with the absolute date and time in its title', async ({
  page,
}) => {
  const now = new Date('2026-11-10T15:00:00').getTime();
  await page.clock.setFixedTime(now);
  await mockHistory(page, now);
  await page.goto('/app');
  const stamp = tools(messageOf(page, 'first question')).getByTestId('chief-msg-stamp');
  await expect(stamp).toHaveText('14:57');
  await expect(stamp).toHaveAttribute('title', /2026/);
  await expect(tools(messageOf(page, 'second answer')).getByTestId('chief-msg-stamp')).toHaveText(
    '14:59',
  );
});

test('the action buttons are flat: no shadow at rest, on hover, or after a click', async ({
  page,
}) => {
  await mockHistory(page);
  await page.goto('/app');
  const answer = messageOf(page, 'second answer');
  await bubbleOf(answer).hover();
  const reply = tools(answer).getByTestId('chief-msg-reply');
  const shadow = () => reply.evaluate((node) => getComputedStyle(node).boxShadow);
  expect(await shadow()).toMatch(FLAT);
  await reply.hover();
  expect(await shadow()).toMatch(FLAT);
  await page.context().grantPermissions(['clipboard-write', 'clipboard-read']);
  await tools(answer).getByTestId('chief-msg-more').click();
  await page.getByRole('menuitem', { name: '复制' }).click();
  await expect(page.getByText('已复制', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('second answer');
  expect(await shadow()).toMatch(FLAT);
  await evidenceShot(page, 'chief-actions-copied.png');
});

test('keyboard focus on an action button is an outline, not a glow', async ({ page }) => {
  await mockHistory(page);
  await page.goto('/app');
  const copy = tools(messageOf(page, 'second answer')).getByTestId('chief-msg-reply');
  await page.getByTestId('chief-composer-input').focus();
  for (let n = 0; n < 40 && !(await copy.evaluate((node) => node === document.activeElement)); n++)
    await page.keyboard.press('Shift+Tab');
  await expect(copy).toBeFocused();
  await settleTransitions(page);
  const face = await copy.evaluate((node) => {
    const style = getComputedStyle(node);
    return { shadow: style.boxShadow, outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth };
  });
  expect(face.shadow).toMatch(FLAT);
  expect(face.outlineStyle).toBe('solid');
  expect(face.outlineWidth).toBe('2px');
});

test('the message toolbar replies by quoting into the composer and rewinds from the more menu', async ({
  page,
}) => {
  await mockHistory(page);
  await page.goto('/app');
  await expect(messageOf(page, 'second answer')).toBeVisible();
  const older = messageOf(page, 'first answer');
  await bubbleOf(older).hover();
  await tools(older).getByTestId('chief-msg-reply').click();
  await expect(page.getByTestId('composer-reply-quote')).toContainText('first answer');
  await expect(page.getByTestId('chief-composer-input')).toBeFocused();

  const question = messageOf(page, 'first question');
  await bubbleOf(question).hover();
  await tools(question).getByTestId('chief-msg-more').click();
  await page.getByRole('menuitem', { name: '恢复到此处' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
});

test('the toolbar sits beside the hovered bubble: right of a reply, left of an owner message', async ({
  page,
}) => {
  await mockHistory(page);
  await page.goto('/app');
  const answer = messageOf(page, 'first answer');
  await bubbleOf(answer).hover();
  const bubble = await bubbleOf(answer).boundingBox();
  const pill = await tools(answer).locator('[data-slot="message-toolbar-pill"]').boundingBox();
  expect(bubble && pill && pill.x - (bubble.x + bubble.width)).toBeCloseTo(12, 0);
  expect(bubble && pill && Math.abs(pill.y + pill.height / 2 - (bubble.y + bubble.height / 2))).toBeLessThanOrEqual(1);
  const question = messageOf(page, 'first question');
  await bubbleOf(question).hover();
  const own = await bubbleOf(question).boundingBox();
  const ownPill = await tools(question).locator('[data-slot="message-toolbar-pill"]').boundingBox();
  expect(own && ownPill && own.x - (ownPill.x + ownPill.width)).toBeCloseTo(12, 0);
  await expect(tools(question).getByTestId('chief-msg-stamp')).toBeVisible();
  await tools(question).getByTestId('chief-msg-more').click();
  await expect(page.getByRole('menuitem')).toHaveText(['复制', '恢复到此处']);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menuitem')).toHaveCount(0);
});

test('on a touch device a tap on a bubble shows its toolbar, and a tap elsewhere hides it', async ({
  browser,
}) => {
  const context = await browser.newContext({
    hasTouch: true,
    isMobile: true,
    viewport: { width: 390, height: 800 },
  });
  const page = await context.newPage();
  await mockHistory(page);
  await page.goto('/app');
  const older = messageOf(page, 'first answer');
  await expect(older).toBeVisible();
  await expect(touchTools(older)).toBeHidden();
  await bubbleOf(older).tap();
  await expect(touchTools(older)).toBeVisible();
  await expect(touchTools(older).getByTestId('chief-msg-reply')).toBeVisible();
  await expect(touchTools(older).getByTestId('chief-msg-stamp')).toBeVisible();
  const other = messageOf(page, 'first question');
  await bubbleOf(other).tap();
  await expect(touchTools(older)).toBeHidden();
  await expect(touchTools(other)).toBeVisible();
  await bubbleOf(other).tap();
  await expect(touchTools(other)).toBeHidden();
  await bubbleOf(older).dispatchEvent('contextmenu');
  await expect(touchTools(older)).toBeVisible();
  await touchTools(older).getByTestId('chief-msg-reply').tap();
  await expect(page.getByTestId('composer-reply-quote')).toContainText('first answer');
  await context.close();
});

test.describe('on a touch phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('an opened message toolbar never overlaps the next row', async ({ page }) => {
    await page.goto('/app?scenario=chief-draft');
    await expect(page.getByTestId('chief-time-divider').first()).toBeVisible();
    const bubbles = page.getByTestId('home-c').getByTestId('chief-bubble');
    await bubbles.first().tap();
    await expect(page.getByTestId('chief-msg-tools-touch').filter({ visible: true })).toHaveCount(1);
    const overlaps = () => page.evaluate(() => {
      const items = [...document.querySelectorAll('[data-testid="chief-virtual-rows"] > *')];
      const found: string[] = [];
      items.forEach((item, index) => {
        const tools = item.querySelector('[data-tools-open] [data-testid="chief-msg-tools-touch"]');
        const next = items[index + 1];
        if (tools == null || next == null) return;
        const bottom = tools.getBoundingClientRect().bottom;
        const top = (next.firstElementChild ?? next).getBoundingClientRect().top;
        if (bottom > top) found.push(`${index}: ${bottom} > ${top}`);
      });
      return found;
    });
    await expect.poll(overlaps).toEqual([]);
  });

  test('a tapped message in the task panel shows its tools, one row at a time', async ({ page }) => {
    await page.goto('/app?scenario=home-c&thread=home-c-review');
    const thread = page.locator('aside.side-panel');
    const opened = thread.getByTestId('msg-tools-touch').filter({ visible: true });
    const request = thread.getByTestId('user-bubble').first();
    const reply = thread.locator('[data-row="agent"]').first();
    await expect(request).toBeVisible();
    await expect(opened).toHaveCount(0);
    await request.tap();
    await expect(opened).toHaveCount(1);
    await opened.getByTestId('chief-msg-more').tap();
    await expect(page.getByRole('menuitem', { name: '复制' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menuitem', { name: '复制' })).toBeHidden();
    await reply.locator('[data-slot="reply-bubble"], p').first().tap();
    await expect(opened).toHaveCount(1);
    await expect(reply.getByTestId('msg-tools-touch')).toBeVisible();
    await request.tap();
    await request.tap();
    await expect(opened).toHaveCount(0);
  });
});
