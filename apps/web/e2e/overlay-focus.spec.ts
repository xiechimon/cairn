import { expect, type Page, test } from '@playwright/test';
import { pressAndExpect } from './helpers.js';

const BOARD = '/app?scenario=01';
const SCHED = '/app/schedules?scenario=r3-92';
/** UA (Chromium) default focus ring: outline auto + this blue. */
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
  test('click + key on `新建任务`/topbar buttons: never the UA blue box', async ({ page }) => {
    await page.goto(BOARD);

    const newTask = page.locator('.sidebar-new-task');
    await newTask.click();

    await pressAndExpect(page, 'Escape', page.getByRole('dialog', { name: '新建任务' }), 'hidden');
    await page.waitForTimeout(250);
    const info = await focusedOutline(page);
    expect(info).not.toBeNull();
    expect(info!.style).not.toBe('auto');
    expect(info!.color).not.toBe(UA_BLUE);

    if (info!.focusVisible) {
      expectVisibleRing(info!);
    }

    await page.goto('/app/schedules?scenario=11');
    const pageNew = page.locator('.sched-empty').getByRole('button', { name: '新建定时' });
    await pageNew.click();
    const schedDialog = page.getByRole('dialog', { name: '新建定时' });
    await expect(schedDialog).toBeVisible();
    await pressAndExpect(page, 'Escape', schedDialog, 'hidden');
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

    let found = false;
    for (let i = 0; i < 40 && !found; i++) {
      await page.keyboard.press('Tab');
      found = await page.evaluate(
        () => document.activeElement?.classList.contains('sidebar-new-task') ?? false,
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

test.describe('#10 schedules `新建定时` dialog = registry Dialog fullscreen family (fade-in)', () => {
  const overlay = (page: Page) => page.locator('[data-slot="dialog-overlay"]');

  test('scrim covers the full viewport — sidebar included', async ({ page }) => {
    await page.goto(SCHED);
    await expect(overlay(page)).toBeVisible();
    const covers = await page.evaluate(() => {
      // a point deep inside the sidebar, far from the centered panel
      const el = document.elementFromPoint(100, 400);
      return el?.closest('[data-slot="dialog-overlay"]') != null;
    });
    expect(covers).toBe(true);
  });

  test('Esc closes the overlay', async ({ page }) => {
    await page.goto(SCHED);
    await expect(overlay(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(overlay(page)).toBeHidden();
  });

  test('backdrop click closes; entry rides the registry fade-in', async ({ page }) => {
    await page.goto(SCHED);
    const scrim = overlay(page);
    await expect(scrim).toBeVisible();

    await expect(scrim).toHaveCSS('animation-name', 'enter');
    // scrim far from the 488-wide centered panel
    await page.mouse.click(80, 80);
    await expect(scrim).toBeHidden();
  });

  test('X and `取消` close the fixture face too (no dead buttons)', async ({ page }) => {
    await page.goto(SCHED);
    await page.getByRole('dialog').getByRole('button', { name: '取消' }).click();
    await expect(overlay(page)).toBeHidden();

    await page.goto(SCHED);
    await page.getByRole('button', { name: '关闭' }).click();
    await expect(overlay(page)).toBeHidden();
  });
});
