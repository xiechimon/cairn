import { expect, type Page, test } from '@playwright/test';

const DETAIL = '/app/todo/7ve0iOkQ-JBpSL98zSiGc';

const row = (page: Page) => page.getByTestId('live-row');
const dots = (page: Page) => row(page).getByTestId('typing-dot');

test.describe('streaming row typing dots (scenario 26)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`${DETAIL}?scenario=26`);
  });

  test('the live row is one reply bubble of three typing dots, no label, pulse or spinner', async ({
    page,
  }) => {
    await expect(row(page)).toHaveCount(1);
    await expect(dots(page)).toHaveCount(3);
    await expect(dots(page).first()).toHaveCSS('animation-name', 'typing-hop');
    await expect(page.getByTestId('live-pulse')).toHaveCount(0);
    await expect(page.locator('.chat-streaming-label')).toHaveCount(0);
    await expect(row(page).locator('[class*="ld-atom"]')).toHaveCount(0);
  });

  test('the bubble is a filled pill at the left of the transcript and keeps its label for assistive tech', async ({
    page,
  }) => {
    await expect(row(page)).toHaveAttribute('role', 'status');
    expect(((await row(page).textContent()) ?? '').trim()).not.toBe('');
    const geo = await row(page).evaluate((el) => {
      const box = el.getBoundingClientRect();
      const column = el.closest('[data-row="agent"]')!.getBoundingClientRect();
      const style = getComputedStyle(el);
      const marks = [...el.querySelectorAll('[data-testid="typing-dot"]')];
      const label = el.querySelector('.sr-only')!.getBoundingClientRect();
      return {
        left: Math.round(box.left - column.left),
        filled: style.backgroundColor !== 'rgba(0, 0, 0, 0)',
        round: Number.parseFloat(style.borderTopLeftRadius) >= box.height / 2,
        dot: marks.map((mark) => [(mark as HTMLElement).offsetWidth, (mark as HTMLElement).offsetHeight]),
        hidden: marks.every((mark) => mark.getAttribute('aria-hidden') === 'true'),
        labelSize: [Math.round(label.width), Math.round(label.height)],
      };
    });
    expect(geo).toEqual({
      left: 0,
      filled: true,
      round: true,
      dot: [
        [6, 6],
        [6, 6],
        [6, 6],
      ],
      hidden: true,
      labelSize: [1, 1],
    });
  });

  test('the elapsed time shows neither in the row nor in the composer; one button stops the run and turns into send once there is text', async ({
    page,
  }) => {
    await expect(row(page).getByText(/^\d+s$/)).toHaveCount(0);
    await expect(page.getByText(/工作中 ·|Working ·/)).toHaveCount(0);
    await expect(page.locator('.composer-stop')).toHaveCount(1);
    await expect(page.locator('.composer-send')).toHaveCount(0);
    await page.locator('.composer-input').fill('补充一句');
    await expect(page.locator('.composer-stop')).toHaveCount(0);
    await expect(page.locator('.composer-send')).toHaveCount(1);
  });

  test('prefers-reduced-motion stops the dots', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(`${DETAIL}?scenario=26`);
    await expect(dots(page)).toHaveCount(3);
    await expect(dots(page).first()).toHaveCSS('animation-name', 'none');
  });
});

test.describe('quiescent building gap (scenario spinner-quiescent)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`${DETAIL}?scenario=spinner-quiescent`);
  });

  test('one live row: typing dots named `执行中...`, no seconds', async ({ page }) => {
    await expect(row(page)).toHaveCount(1);
    await expect(dots(page)).toHaveCount(3);
    await expect(row(page)).toHaveText('执行中...');
    await expect(row(page).getByText(/^\d+s$/)).toHaveCount(0);
    await expect(row(page)).not.toContainText('undefined');
    await expect(page.getByTestId('side-chat-status')).toContainText('运行中');
  });
});
