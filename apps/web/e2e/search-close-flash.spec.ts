import { expect, type Page, test } from '@playwright/test';
import { pressAndExpect } from './helpers.js';

const BOARD = '/app?scenario=01';

const PANEL_SEL = '[role="dialog"][aria-label="搜索"]';
const panel = (page: Page) => page.getByRole('dialog', { name: '搜索' });

async function openPanel(page: Page) {
  await expect(page.getByRole('complementary')).toBeVisible();
  await pressAndExpect(page, 'Control+k', panel(page));
}

async function settleEnter(page: Page) {
  await expect(panel(page)).toHaveCSS('transform', 'none');
  await page.waitForTimeout(300);
}

function sampleClose(page: Page, durationMs: number) {
  return page.evaluate(
    ({ sel, ms }) => {
      const out: { t: number; op: number | null }[] = [];
      const t0 = performance.now();
      return new Promise<typeof out>((resolve) => {
        function snap() {
          const el = document.querySelector(sel);
          out.push({
            t: Math.round(performance.now() - t0),
            op: el ? Number(getComputedStyle(el).opacity) : null,
          });
          if (performance.now() - t0 < ms) requestAnimationFrame(snap);
          else resolve(out);
        }
        requestAnimationFrame(snap);
      });
    },
    { sel: PANEL_SEL, ms: durationMs },
  );
}

test('second Ctrl+K close does not flash: exit opacity decreases monotonically', async ({ page }) => {
  await page.goto(BOARD);
  await openPanel(page);
  await settleEnter(page);

  const traceP = sampleClose(page, 700);
  await page.keyboard.press('Control+k');
  const trace = await traceP;

  await expect(panel(page)).toBeHidden({ timeout: 3000 });

  let floor: number | null = null;
  for (const f of trace) {
    if (f.op == null) break;
    if (floor == null && f.op < 0.9) floor = f.op;
    else if (floor != null) {
      if (f.op < floor) floor = f.op;
      expect(f.op, `opacity rose back mid-exit at t=${f.t}ms`).toBeLessThanOrEqual(floor + 0.12);
    }
  }
  expect(floor, 'exit animation never started (opacity never dropped)').not.toBeNull();
});

test('triple click: close→open lands on open with the input focused', async ({ page }) => {
  await page.goto(BOARD);
  await openPanel(page);
  await settleEnter(page);

  await page.keyboard.press('Control+k');
  await page.keyboard.press('Control+k');
  await expect(panel(page)).toBeVisible({ timeout: 3000 });
  await expect(panel(page).getByRole('textbox')).toBeFocused({ timeout: 3000 });
});
