import { expect, type Locator, type Page, test } from '@playwright/test';
import { settleTransitions } from './helpers.js';

const SIDEBAR_COLLAPSED_KEY = 'cairn.sidebar-collapsed';

interface RingReport {
  focused: boolean;
  outline: string;
  clippedBy: string[];
}

function readRing(locator: Locator): Promise<RingReport> {
  return locator.evaluate((el) => {
    const cs = getComputedStyle(el);
    const width = Number.parseFloat(cs.outlineWidth);
    const reach = cs.outlineStyle === 'none' ? 0 : Number.parseFloat(cs.outlineOffset) + width;
    const rect = el.getBoundingClientRect();
    const clippedBy: string[] = [];
    if (reach > 0) {
      for (let a = el.parentElement; a != null; a = a.parentElement) {
        const s = getComputedStyle(a);
        const box = a.getBoundingClientRect();
        const sides: string[] = [];
        if (s.overflowX !== 'visible') {
          if (rect.left - reach < box.left - 0.5) sides.push('left');
          if (rect.right + reach > box.right + 0.5) sides.push('right');
        }
        if (s.overflowY !== 'visible') {
          if (rect.top - reach < box.top - 0.5) sides.push('top');
          if (rect.bottom + reach > box.bottom + 0.5) sides.push('bottom');
        }
        if (sides.length > 0) clippedBy.push(`${a.tagName.toLowerCase()}:${sides.join('+')}`);
      }
    }
    return {
      focused: document.activeElement === el,
      outline: cs.outlineStyle === 'none' || width === 0 ? 'none' : `${cs.outlineStyle} ${width}px`,
      clippedBy,
    };
  });
}

async function keyboardFocus(page: Page, locator: Locator) {
  await locator.focus();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Shift+Tab');
  await settleTransitions(page);
}

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
