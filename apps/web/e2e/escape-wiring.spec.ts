import { expect, type Page, test } from '@playwright/test';
import { pressAndExpect } from './helpers.js';

const EMPTY = '/app?scenario=board-tags-empty&view=board';

const typeBtn = (page: Page) => page.locator('.board-type-filter');
const typePopover = (page: Page) => page.locator('.type-filter-popover');
const typeOption = (page: Page, name: string) =>
  page.locator(`.type-filter-option[data-tag="${name}"]`);

async function installEscapeTap(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as {
      __escTap: { winAdds: number; winRems: number; docAdds: number; docRems: number };
    };
    w.__escTap = { winAdds: 0, winRems: 0, docAdds: 0, docRems: 0 };
    const tap = (target: Window | Document, addsKey: 'winAdds' | 'docAdds', remsKey: 'winRems' | 'docRems') => {
      const add = target.addEventListener.bind(target);
      const rem = target.removeEventListener.bind(target);
      target.addEventListener = ((type: string, fn: unknown, opts?: unknown) => {
        if (type === 'keydown') w.__escTap[addsKey] += 1;
        return add(type, fn as EventListener, opts as boolean);
      }) as typeof target.addEventListener;
      target.removeEventListener = ((type: string, fn: unknown, opts?: unknown) => {
        if (type === 'keydown') w.__escTap[remsKey] += 1;
        return rem(type, fn as EventListener, opts as boolean);
      }) as typeof target.removeEventListener;
    };
    tap(window, 'winAdds', 'winRems');
    tap(document, 'docAdds', 'docRems');
  });
}

const readEscapeTap = (page: Page) =>
  page.evaluate(
    () =>
      (window as unknown as { __escTap: Record<string, number> }).__escTap as {
        winAdds: number;
        winRems: number;
        docAdds: number;
        docRems: number;
      },
  );

async function openTypePopover(page: Page) {
  await typeBtn(page).click();
  await expect(typePopover(page)).toBeVisible();
}

test('an open layer is not re-wired by re-render: a single Escape still closes the layer after URL write-back', async ({ page }) => {
  await page.goto(EMPTY);
  await openTypePopover(page);
  await installEscapeTap(page);

  await typeOption(page, 'chore').click();
  await expect(page).toHaveURL(/[\?&]tags=chore(&|$)/);
  await expect(page.locator('.board-filter-empty')).toBeVisible();

  expect(await readEscapeTap(page)).toEqual({
    winAdds: 0,
    winRems: 0,
    docAdds: 0,
    docRems: 0,
  });
  await page.keyboard.press('Escape');
  await expect(typePopover(page)).not.toBeVisible();
});

const DETAIL = '/app/todo/7ve0iOkQ-JBpSL98zSiGc?scenario=27';

const confirmDialog = (page: Page) => page.getByRole('alertdialog');

const searchPanel = (page: Page) => page.getByRole('dialog', { name: '搜索' });

test('the confirm sheet is not re-wired by root re-render: a single Escape still closes it after a ⌘K round trip', async ({
  page,
}) => {
  await page.goto(DETAIL);
  await page.locator('.detail-head-icon--more').click();
  await page.getByRole('menuitem', { name: '删除' }).click();
  await expect(confirmDialog(page)).toBeVisible();
  await installEscapeTap(page);

  await pressAndExpect(page, 'Meta+k', searchPanel(page));
  await pressAndExpect(page, 'Meta+k', searchPanel(page), 'hidden');

  await expect
    .poll(async () => {
      const t = await readEscapeTap(page);
      return { win: { winAdds: t.winAdds, winRems: t.winRems }, balanced: t.docAdds === t.docRems };
    })
    .toEqual({ win: { winAdds: 0, winRems: 0 }, balanced: true });
  const tap = await readEscapeTap(page);
  await page.keyboard.press('Escape');
  await expect(confirmDialog(page)).not.toBeVisible();
});