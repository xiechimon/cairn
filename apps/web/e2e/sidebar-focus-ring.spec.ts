import { expect, type Page, test } from '@playwright/test';
import { keyboardFocus, readRing, settleTransitions } from './helpers.js';

const SIDEBAR_COLLAPSED_KEY = 'cairn.sidebar-collapsed';

function sidebarLink(page: Page, name: string | RegExp) {
  return page.getByRole('complementary').getByRole('link', { name, exact: true });
}

test('mouse click then Escape on a sidebar row paints no focus ring', async ({ page }) => {
  await page.goto('/app?scenario=01');
  const board = sidebarLink(page, /^工作台/);
  await board.click();
  await page.keyboard.press('Escape');
  await settleTransitions(page);
  expect(await readRing(board)).toEqual({ focused: true, outline: 'none', clippedBy: [] });
});

test('mouse click then Escape on a rail row paints no focus ring', async ({ page }) => {
  await page.addInitScript((key) => localStorage.setItem(key, '1'), SIDEBAR_COLLAPSED_KEY);
  await page.goto('/app?scenario=01');
  const board = sidebarLink(page, /^工作台/);
  await board.click();
  await page.keyboard.press('Escape');
  await settleTransitions(page);
  expect(await readRing(board)).toEqual({ focused: true, outline: 'none', clippedBy: [] });
});

test('keyboard focus rings on sidebar rows stay whole', async ({ page }) => {
  await page.goto('/app?scenario=01');
  for (const name of [/^工作台/, '看板', '定时']) {
    const row = sidebarLink(page, name);
    await keyboardFocus(page, row);
    expect({ name: String(name), ...(await readRing(row)) }).toEqual({
      name: String(name),
      focused: true,
      outline: 'solid 2px',
      clippedBy: [],
    });
  }
});

test('keyboard focus rings on rail rows stay whole', async ({ page }) => {
  await page.addInitScript((key) => localStorage.setItem(key, '1'), SIDEBAR_COLLAPSED_KEY);
  await page.goto('/app?scenario=01');
  const rail = page.getByRole('complementary').getByRole('navigation');
  const rows = [
    sidebarLink(page, /^工作台/),
    sidebarLink(page, '定时'),
    rail.getByRole('button').first(),
  ];
  for (const row of rows) {
    await keyboardFocus(page, row);
    expect(await readRing(row)).toEqual({ focused: true, outline: 'solid 2px', clippedBy: [] });
  }
});

test('Escape after Tab keeps the keyboard focus ring', async ({ page }) => {
  await page.goto('/app?scenario=01');
  const board = sidebarLink(page, /^工作台/);
  await board.click();
  await keyboardFocus(page, board);
  await page.keyboard.press('Escape');
  await settleTransitions(page);
  expect(await readRing(board)).toEqual({ focused: true, outline: 'solid 2px', clippedBy: [] });
});

test('transcript scroller focus ring stays inside its panel', async ({ page }) => {
  await page.goto('/app/todo/7ve0iOkQ-JBpSL98zSiGc?scenario=57f');
  const scroller = page.locator('[data-slot="message-scroller-viewport"]').first();
  await keyboardFocus(page, scroller);
  expect(await readRing(scroller)).toEqual({ focused: true, outline: 'solid 2px', clippedBy: [] });
});
