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
const tools = (message: Locator) => message.locator('[data-testid="chief-msg-tools"], [data-testid="chief-msg-foot"]');

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

  await olderUser.hover();
  await expect.poll(() => opacityOf(tools(olderUser))).toBe(1);
  await expect.poll(() => opacityOf(tools(olderAnswer))).toBe(0);
  await evidenceShot(page, 'chief-actions-hover.png');

  await page.mouse.move(0, 0);
  await expect.poll(() => opacityOf(tools(olderUser))).toBe(0);
  await olderAnswer.getByRole('button', { name: '复制' }).focus();
  await expect.poll(() => opacityOf(tools(olderAnswer))).toBe(1);
});

test('the newest message hides its actions until hover, like the others', async ({ page }) => {
  await mockHistory(page);
  await page.goto('/app');
  await page.mouse.move(0, 0);
  const newest = messageOf(page, 'second answer');
  await expect.poll(() => opacityOf(tools(newest))).toBe(0);
  await newest.hover();
  await expect.poll(() => opacityOf(tools(newest))).toBe(1);
});

test('touch devices keep the actions of older messages visible', async ({ browser }) => {
  const context = await browser.newContext({ hasTouch: true, isMobile: true });
  const page = await context.newPage();
  await mockHistory(page);
  await page.goto('/app');
  await expect(messageOf(page, 'first question')).toBeVisible();
  await expect.poll(() => opacityOf(tools(messageOf(page, 'first question')))).toBe(1);
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
  await older.hover();
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
  const copy = messageOf(page, 'second answer').getByRole('button', { name: '复制' });
  const shadow = () => copy.evaluate((node) => getComputedStyle(node).boxShadow);
  expect(await shadow()).toMatch(FLAT);
  await copy.hover();
  expect(await shadow()).toMatch(FLAT);
  await page.context().grantPermissions(['clipboard-write', 'clipboard-read']);
  await copy.click();
  expect(await shadow()).toMatch(FLAT);
  await evidenceShot(page, 'chief-actions-copied.png');
});

test('keyboard focus on an action button is an outline, not a glow', async ({ page }) => {
  await mockHistory(page);
  await page.goto('/app');
  const copy = messageOf(page, 'second answer').getByRole('button', { name: '复制' });
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
  await older.hover();
  await older.getByTestId('chief-msg-reply').click();
  await expect(page.getByTestId('composer-reply-quote')).toContainText('first answer');
  await expect(page.getByTestId('chief-composer-input')).toBeFocused();

  const question = messageOf(page, 'first question');
  await question.hover();
  await question.getByTestId('chief-msg-more').click();
  await page.getByRole('menuitem', { name: '恢复到此处' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
});

test('on a touch device the toolbar of an older message is reachable without hover', async ({
  browser,
}) => {
  const context = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 800 } });
  const page = await context.newPage();
  await mockHistory(page);
  await page.goto('/app');
  const older = messageOf(page, 'first answer');
  await expect(older).toBeVisible();
  await expect.poll(() => opacityOf(tools(older))).toBe(1);
  await context.close();
});

test.describe('on a touch phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('the always-visible message tools never overlap the next row', async ({ page }) => {
    await page.goto('/app?scenario=chief-draft');
    await expect(page.getByTestId('chief-time-divider')).toBeVisible();
    const overlaps = await page.evaluate(() => {
      const items = [...document.querySelectorAll('[data-testid="chief-stream"] > *')];
      const found: string[] = [];
      items.forEach((item, index) => {
        const tools = item.querySelector('[data-testid="chief-msg-tools"], [data-testid="chief-msg-foot"]');
        const next = items[index + 1];
        if (tools == null || next == null) return;
        const bottom = tools.getBoundingClientRect().bottom;
        const top = (next.firstElementChild ?? next).getBoundingClientRect().top;
        if (bottom > top) found.push(`${index}: ${bottom} > ${top}`);
      });
      return found;
    });
    expect(overlaps).toEqual([]);
  });
});
