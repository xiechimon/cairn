import { expect, type Locator, type Page, test } from '@playwright/test';
import { mockLive, THREAD } from './chief-home-mock';
import { evidenceShot } from './evidence';
import { settleTransitions } from './helpers';

const MINUTE = 60_000;
const FLAT = /^(none|(rgba\(0, 0, 0, 0\) 0px 0px 0px 0px(, )?)+)$/;

async function mockHistory(page: Page) {
  const now = Date.now();
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

test('the newest message keeps its actions visible', async ({ page }) => {
  await mockHistory(page);
  await page.goto('/app');
  await page.mouse.move(0, 0);
  await expect.poll(() => opacityOf(tools(messageOf(page, 'second answer')))).toBe(1);
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

test('each message shows a relative time with the absolute time in its title', async ({ page }) => {
  await mockHistory(page);
  await page.goto('/app');
  const stamp = tools(messageOf(page, 'first question')).getByTestId('chief-msg-stamp');
  await expect(stamp).toHaveText('3 分钟前');
  await expect(stamp).toHaveAttribute('title', /\d/);
  await expect(tools(messageOf(page, 'second answer')).getByTestId('chief-msg-stamp')).toHaveText(
    '1 分钟前',
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
