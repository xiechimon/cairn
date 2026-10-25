import { expect, test } from '@playwright/test';

// Issue #634 item 2: the status chip's chevron is part of the trigger — the
// whole chip (pill + arrow + the space between) toggles the popover, mouse
// and keyboard alike.
//
// Failure modes pinned (one per test):
//   H1 chevron click did nothing (the arrow sat outside the trigger button)
//   H2 keyboard users could not toggle the popover from the chip
//
// Closing the popover by re-clicking the chip is NOT a user path: the family
// ClickCatcher swallows every outside press (repo UX law), so the close side
// of H1 goes through an outside press like a real cursor would.

const DETAIL = '/app/todo/7ve0iOkQ-JBpSL98zSiGc?scenario=27';

const chip = (page: import('@playwright/test').Page) => page.locator('.detail-chip');

const chevron = (page: import('@playwright/test').Page) => page.getByTestId('chip-chevron');
const popover = (page: import('@playwright/test').Page) =>
  page.getByRole('dialog', { name: '任务分配' });

test('H1: the chevron side of the chip toggles the popover', async ({ page }) => {
  await page.goto(DETAIL);
  await expect(popover(page)).toBeHidden();
  await chevron(page).click();
  await expect(popover(page)).toBeVisible();
  await page.mouse.click(400, 500, { clickCount: 1 });
  await expect(popover(page)).toBeHidden();
});

test('H2: keyboard focus + Enter toggles the popover', async ({ page }) => {
  await page.goto(DETAIL);
  await chip(page).focus();
  await page.keyboard.press('Enter');
  await expect(popover(page)).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(popover(page)).toBeHidden();
  // #666: the toggle is only a toggle if focus never left the trigger — the
  // popover must not steal it on open (Base UI initialFocus={false} in dhead).
  // Without the pin this passed or failed on a race: focus stolen to the
  // popover's edit row meant the second Enter opened the assignment dialog
  // instead of closing, and focus lost to the popup shell meant it did
  // nothing at all (popover stayed open — the flake this assert buries).
  await expect(chip(page)).toBeFocused();
});
