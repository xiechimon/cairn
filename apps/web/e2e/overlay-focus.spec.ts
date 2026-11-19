import { expect, type Page, test } from '@playwright/test';
import { pressAndExpect } from './helpers.js';

const BOARD = '/app?scenario=01';
const SCHED = '/app?scenario=11&pane=tasks&tab=scheduled';
const UA_BLUE = 'rgb(0, 95, 204)';

async function focusedOutline(page: Page) {
  return page.evaluate(() => {
    const el = document.activeElement;
    if (el == null || el === document.body) return null;
    const cs = getComputedStyle(el);
    return {
      cls: typeof el.className === 'string' && el.className !== '' ? el.className : el.tagName,
      style: cs.outlineStyle,
      width: cs.outlineWidth,
      color: cs.outlineColor,
      shadow: cs.boxShadow,
      focusVisible: el.matches(':focus-visible'),
    };
  });
}

function expectVisibleRing(info: { style: string; color: string; shadow: string }) {
  const outlineRing = info.style === 'solid' && info.color !== UA_BLUE;
  const shadowRing = info.shadow !== 'none';
  expect(outlineRing || shadowRing).toBe(true);
}

test.describe('#15 focus ring incorporated', () => {
  test('click + key on the `新建定时` button: never the UA blue box', async ({ page }) => {
    await page.goto(SCHED);
    const pageNew = page.getByTestId('schedule-new');
    await pageNew.click();
    const popover = page.getByTestId('schedule-popover');
    await expect(popover).toBeVisible();
    await pressAndExpect(page, 'Escape', popover, 'hidden');
    await expect(pageNew).toBeFocused();
    await page.waitForTimeout(250);
    const info2 = await focusedOutline(page);
    expect(info2).not.toBeNull();
    expect(info2!.style).not.toBe('auto');
    expect(info2!.color).not.toBe(UA_BLUE);
    if (info2!.focusVisible) {
      expectVisibleRing(info2!);
    }
  });

  test('Tab focus keeps the official ring (keyboard reachability preserved)', async ({ page }) => {
    await page.goto(BOARD);
    await expect(page.locator('.sidebar-search')).toBeVisible();

    let found = false;
    for (let i = 0; i < 40 && !found; i++) {
      await page.keyboard.press('Tab');
      found = await page.evaluate(
        () => document.activeElement?.closest('.sidebar-search') != null,
      );
    }
    expect(found).toBe(true);
    await page.waitForTimeout(250);
    const info = await focusedOutline(page);
    expect(info).not.toBeNull();
    expect(info!.focusVisible).toBe(true);
    expectVisibleRing(info!);
  });
});

test.describe('#10 the schedule popover closes from outside clicks and `取消`', () => {
  const popover = (page: Page) => page.getByTestId('schedule-popover');
  const openNew = async (page: Page) => {
    await page.goto(SCHED);
    await page.getByTestId('schedule-new').click();
    await expect(popover(page)).toBeVisible();
  };

  test('a click outside closes it', async ({ page }) => {
    await openNew(page);
    await page.mouse.click(700, 80);
    await expect(popover(page)).toBeHidden();
  });

  test('`取消` closes the fixture face too (no dead buttons)', async ({ page }) => {
    await openNew(page);
    await popover(page).getByRole('button', { name: '取消' }).click();
    await expect(popover(page)).toBeHidden();
  });
});
