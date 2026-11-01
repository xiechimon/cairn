import { expect, type Page, test } from '@playwright/test';

const PROJECT_ID = 'ZAQczKCu0MOAzC1ZqcFlX';
const home = (scenario: string) => `/app/project/${PROJECT_ID}?scenario=${scenario}`;
const card = (page: Page, title: string) =>
  page.locator('[data-slot="thread-card"]').filter({ hasText: title });

const composer = (page: Page) =>
  page.getByTestId('project-home').getByTestId('chief-composer-input');

async function openProjectMenu(page: Page) {
  await page.getByTestId('project-home-header').getByRole('button', { name: 'cairn' }).click();
  await expect
    .poll(() => page.evaluate(() => document.activeElement?.closest('[role="menu"]') != null))
    .toBe(true);
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('cairn.locale', 'en'));
});

test('the header names the project and the Coordinator, and the goal leads the conversation', async ({
  page,
}) => {
  await page.goto(home('project-home'));
  const header = page.getByTestId('project-home-header');
  await expect(header.getByRole('button', { name: 'cairn' })).toBeVisible();
  await expect(header).toContainText('Coordinator');
  await expect(page.getByTestId('project-goal')).toContainText(
    'Ship an open-source, self-hostable agent team',
  );
  await expect(page.getByTestId('chief-composer-input')).toHaveCount(1);
  await expect(page.locator('.chief-fab')).toHaveCount(0);
});

test('threads the Coordinator started show as cards with the action each one needs', async ({
  page,
}) => {
  await page.goto(home('project-home'));
  const waiting = card(page, 'Connect a Claude subscription token');
  await expect(waiting).toHaveAttribute('data-tone', 'waiting');
  await expect(waiting.getByRole('button', { name: 'Review plan' })).toBeVisible();
  await expect(waiting).toContainText('Plan ready. Approve to start.');
  const review = card(page, 'Fold finished turns into purpose and duration');
  await expect(review).toHaveAttribute('data-tone', 'review');
  await expect(review.getByRole('button', { name: 'Review', exact: true })).toBeVisible();
  await expect(review).toContainText('Ready for your review');
  const working = card(page, 'Push for finished and failed threads');
  await expect(working).toHaveAttribute('data-tone', 'working');
  await expect(working.getByRole('button')).toHaveCount(1);
  await expect(working.getByRole('button', { name: 'View thread' })).toBeVisible();
});

test('View thread opens the thread', async ({ page }) => {
  await page.goto(home('project-home'));
  await card(page, 'Push for finished and failed threads')
    .getByRole('button', { name: 'View thread' })
    .click();
  await expect(page).toHaveURL(/\/app\/todo\/project-home-working/);
});

test('a new project greets with its goal and starter chips that fill the composer', async ({
  page,
}) => {
  await page.goto(home('project-home-empty'));
  await expect(page.getByRole('heading', { name: /New project: api-latency/ })).toBeVisible();
  await expect(page.getByTestId('project-goal')).toContainText('Bring p95 latency under 200 ms');
  const chips = page.getByTestId('project-starter-chips').getByRole('button');
  await expect(chips).toHaveText(['Make a plan', 'Add a repo', 'Pick up recent work', 'Use my tools']);
  await chips.filter({ hasText: 'Make a plan' }).click();
  await expect(composer(page)).toHaveValue('Make a plan');
  await expect(composer(page)).toBeFocused();
});

test('a failed send keeps the message and says why above the composer', async ({ page }) => {
  await page.goto(home('project-home-send-error'));
  const error = page.getByTestId('chief-composer-error');
  await expect(error).toContainText('Could not reach the Coordinator');
  await expect(composer(page)).toHaveAttribute('aria-invalid', 'true');
  await expect(composer(page)).toHaveValue('Plan the next batch');
});

test('an archived project replaces the composer with an Unarchive banner', async ({ page }) => {
  await page.goto(home('project-home-archived'));
  const banner = page.getByTestId('project-archived-banner');
  await expect(banner).toContainText('This project is archived');
  await expect(banner.getByRole('button', { name: 'Unarchive' })).toBeVisible();
  await expect(composer(page)).toHaveCount(0);
});

test('the project menu lists its actions with single-key hints', async ({ page }) => {
  await page.goto(home('project-home'));
  await page.getByTestId('project-home-header').getByRole('button', { name: 'cairn' }).click();
  const menu = page.getByRole('menu');
  await expect(menu.getByRole('menuitem')).toHaveText([
    /Rename\s*R/,
    /Settings/,
    /Copy link\s*L/,
    /Archive…\s*A/,
    /Delete…\s*D/,
  ]);
});

test('Archive asks first and says what happens to running threads', async ({ page }) => {
  await page.goto(home('project-home'));
  await openProjectMenu(page);
  await page.keyboard.press('a');
  const dialog = page.getByRole('alertdialog', { name: 'Archive cairn?' });
  await expect(dialog).toContainText('Threads become read-only');
  await expect(dialog).toContainText('1 running thread finishes its current turn first');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId('project-archived-banner')).toHaveCount(0);
});

test('confirming Archive swaps the composer for the banner', async ({ page }) => {
  await page.goto(home('project-home'));
  await page.getByTestId('project-home-header').getByRole('button', { name: 'cairn' }).click();
  await page.getByRole('menuitem', { name: /Archive/ }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Archive' }).click();
  await expect(page.getByTestId('project-archived-banner')).toBeVisible();
  await page.getByTestId('project-archived-banner').getByRole('button', { name: 'Unarchive' }).click();
  await expect(composer(page)).toBeVisible();
});

test('switching projects drops the starter text picked in the previous one', async ({ page }) => {
  await page.goto(home('project-home-empty'));
  await page.getByTestId('project-starter-chips').getByRole('button', { name: 'Make a plan' }).click();
  await expect(composer(page)).toHaveValue('Make a plan');
  await page.locator('[data-slot="sidebar-project-row"]', { hasText: 'cairn-site' }).click();
  await expect(page).toHaveURL(/\/app\/project\/project-home-other/);
  await expect(composer(page)).toHaveValue('');
});
