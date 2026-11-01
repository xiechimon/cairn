import { expect, type Page, test } from '@playwright/test';

const DETAIL = '/app/todo/7ve0iOkQ-JBpSL98zSiGc';

const row = (page: Page) => page.getByTestId('live-row');
const pulse = (page: Page) => page.getByTestId('live-pulse');

test.describe('streaming row live pulse (scenario 26)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`${DETAIL}?scenario=26`);
  });

  test('the live row is a shimmering label with one pulse dot under it, no spinner', async ({
    page,
  }) => {
    await expect(row(page)).toHaveCount(1);
    await expect(pulse(page)).toHaveCount(1);
    await expect(pulse(page)).toHaveCSS('animation-name', 'live-pulse');
    await expect(row(page).locator('.chat-streaming-label')).toHaveCSS(
      'animation-name',
      'shimmer-sweep',
    );
    await expect(row(page).locator('[class*="ld-atom"]')).toHaveCount(0);
  });

  test('the pulse is a 7px aria-hidden dot below the label', async ({ page }) => {
    await expect(pulse(page)).toHaveAttribute('aria-hidden', 'true');
    const geo = await pulse(page).evaluate((el) => {
      const dot = { width: (el as HTMLElement).offsetWidth, height: (el as HTMLElement).offsetHeight, top: el.getBoundingClientRect().top };
      const label = document.querySelector('[data-testid="live-row"]')!.getBoundingClientRect();
      return { w: dot.width, h: dot.height, below: dot.top >= label.bottom };
    });
    expect(geo).toEqual({ w: 7, h: 7, below: true });
  });

  test('the elapsed time is not in the row; it rides tabular figures in the composer next to stop', async ({
    page,
  }) => {
    await expect(row(page).getByText(/^\d+s$/)).toHaveCount(0);
    const working = page.getByTestId('composer-working');
    await expect(working).toContainText('工作中');
    await expect(working).toContainText(/\d+:\d{2}/);
    const fvn = await working.evaluate((el) => getComputedStyle(el).fontVariantNumeric);
    expect(fvn).toContain('tabular-nums');
    const boxes = await page.evaluate(() => {
      const w = document.querySelector('[data-testid="composer-working"]')!.getBoundingClientRect();
      const stop = document.querySelector('.composer-stop')!.getBoundingClientRect();
      return { left: w.right <= stop.left, sameBand: Math.abs(w.top + w.height / 2 - (stop.top + stop.height / 2)) < 2 };
    });
    expect(boxes).toEqual({ left: true, sameBand: true });
  });

  test('prefers-reduced-motion stops the pulse and the shimmer', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(`${DETAIL}?scenario=26`);
    await expect(pulse(page)).toHaveCSS('animation-name', 'none');
    await expect(row(page).locator('.chat-streaming-label')).toHaveCSS('animation-name', 'none');
  });
});

test.describe('quiescent building gap (scenario spinner-quiescent)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`${DETAIL}?scenario=spinner-quiescent`);
  });

  test('one live row: static `执行中...` label with a pulse, no seconds', async ({ page }) => {
    await expect(row(page)).toHaveCount(1);
    await expect(pulse(page)).toHaveCount(1);
    await expect(row(page).getByText('执行中...')).toBeVisible();
    await expect(row(page).getByText(/^\d+s$/)).toHaveCount(0);
    await expect(row(page)).not.toContainText('undefined');
    await expect(page.getByTestId('phase-chip')).toHaveText(/执行中/);
  });
});
