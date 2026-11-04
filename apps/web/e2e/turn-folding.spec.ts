import { expect, test } from '@playwright/test';

test.use({ locale: 'en-US' });

const THREAD = '/app/todo/7ve0iOkQ-JBpSL98zSiGc?scenario=turn-fold-thread';
const FOLDED_REPLY = 'waits for the inbox URL';

test.describe('thread transcript', () => {
  test('finished turns fold under purpose and duration headers while the live turn stays open', async ({
    page,
  }) => {
    await page.goto(THREAD);
    const headers = page.getByTestId('turn-header');
    await expect(headers).toHaveCount(2);

    const done = headers.first();
    await expect(done).toHaveText(/^Fix the flaky login test · 4 minutes$/);
    await expect(done).toHaveText(/^.+ · \d+ (seconds?|minutes?|hours?)/);
    await expect(done).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByText(FOLDED_REPLY)).toHaveCount(0);
    await expect(page.getByText('It fails on CI about one run in five.')).toHaveCount(0);

    await expect(
      page.getByTestId('user-bubble').filter({ hasText: 'Add a regression test' }),
    ).toBeVisible();
    await expect(page.getByText('Add a regression test for the redirect race.')).toHaveCount(1);
  });

  test('a failed turn reads in the destructive tone with failed after duration', async ({
    page,
  }) => {
    await page.goto(THREAD);
    const failed = page.getByTestId('turn-header').nth(1);
    await expect(failed).toHaveAttribute('data-state', 'failed');
    await expect(failed).toHaveText(
      /^Bump Playwright to the latest release\. · failed after 2 minutes$/,
    );
    const color = (locator: ReturnType<typeof page.locator>) =>
      locator.evaluate((el) => getComputedStyle(el).color);
    const failedInk = await color(failed.locator('span').first());
    const doneInk = await color(page.getByTestId('turn-header').first().locator('span').first());
    expect(failedInk).not.toBe(doneInk);
  });

  test('the header opens and closes its turn by click, Enter and Space', async ({ page }) => {
    await page.goto(THREAD);
    const header = page.getByTestId('turn-header').first();
    const reply = page.getByText(FOLDED_REPLY);

    await header.click();
    await expect(header).toHaveAttribute('aria-expanded', 'true');
    await expect(reply).toBeVisible();
    await expect(
      page.getByTestId('user-bubble').filter({ hasText: 'Fix the flaky login test' }),
    ).toBeVisible();

    await header.focus();
    await page.keyboard.press('Enter');
    await expect(header).toHaveAttribute('aria-expanded', 'false');
    await expect(reply).toHaveCount(0);

    await page.keyboard.press('Space');
    await expect(header).toHaveAttribute('aria-expanded', 'true');
    await expect(reply).toBeVisible();
  });

  test('opening one turn leaves the other finished turns folded', async ({ page }) => {
    await page.goto(THREAD);
    await page.getByTestId('turn-header').first().click();
    await expect(page.getByTestId('turn-header').nth(1)).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByText('The run stopped')).toHaveCount(0);
  });
});

test.describe('Coordinator conversation', () => {
  test('the latest finished turn stays open, earlier ones fold, and the header toggles from the keyboard', async ({
    page,
  }) => {
    await page.goto('/app?scenario=home-c');
    const headers = page.getByTestId('turn-header');
    await expect(headers).toHaveCount(2);
    await expect(headers.first()).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByText('Round 6 found no /work in the orb')).toHaveCount(0);

    const latest = headers.nth(1);
    await expect(latest).toHaveText(/^Fold finished turns before review\. · 4 minutes$/);
    await expect(latest).toHaveAttribute('aria-expanded', 'true');
    const reply = page.getByText('Started it; the PR is up for your review.');
    await expect(reply).toBeVisible();

    await latest.press('Enter');
    await expect(latest).toHaveAttribute('aria-expanded', 'false');
    await expect(reply).toHaveCount(0);
    await latest.press('Space');
    await expect(latest).toHaveAttribute('aria-expanded', 'true');
    await expect(reply).toBeVisible();
  });
});
