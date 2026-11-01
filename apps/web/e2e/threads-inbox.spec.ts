import { expect, type Page, test } from '@playwright/test';

const PROJECT_ID = 'ZAQczKCu0MOAzC1ZqcFlX';
const home = (scenario: string, query = '') =>
  `/app/project/${PROJECT_ID}?scenario=${scenario}${query}`;
const inbox = (page: Page) => page.getByTestId('threads-inbox');
const group = (page: Page, tone: string) =>
  inbox(page).locator(`[data-slot="stone-group"][data-tone="${tone}"]`);
const row = (page: Page, title: string) =>
  inbox(page).locator('[data-slot="thread-row"]').filter({ hasText: title });

async function select(page: Page, title: string) {
  await row(page, title).hover();
  await row(page, title).getByRole('checkbox').check();
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('cairn.locale', 'en'));
});

test('threads are grouped by who acts next, with Resolved folded and a waiting pill', async ({
  page,
}) => {
  await page.goto(home('project-home'));
  await expect(inbox(page).locator('[data-slot="stone-group"]')).toHaveCount(5);
  await expect(group(page, 'waiting').locator('[data-slot="thread-row"]')).toHaveText(
    [/Connect a Claude subscription token.*Plan ready\. Approve to start\./],
  );
  await expect(group(page, 'review')).toContainText('Fold finished turns into purpose and duration');
  await expect(group(page, 'working')).toContainText('Push for finished and failed threads');
  await expect(group(page, 'idle').locator('[data-slot="thread-row"]')).toHaveCount(2);
  await expect(group(page, 'resolved').getByRole('button').first()).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  await expect(group(page, 'resolved')).toContainText('2');
  await expect(page.getByTestId('threads-inbox-waiting')).toHaveText('1 waiting on you');
});

test('an empty project shows the three action groups with what lands in each', async ({
  page,
}) => {
  await page.goto(home('project-home-empty'));
  await expect(inbox(page).locator('[data-slot="stone-group"]')).toHaveCount(3);
  await expect(group(page, 'waiting')).toContainText('Decisions, reviews and permission requests.');
  await expect(group(page, 'working')).toContainText('Agents running now.');
  await expect(page.getByTestId('threads-inbox-waiting')).toHaveCount(0);
});

test('bulk Resolve moves the selected threads to Resolved', async ({ page }) => {
  await page.goto(home('project-home'));
  await select(page, 'Sidebar status groups');
  await select(page, 'Automation badge and popover');
  const bar = page.getByRole('toolbar', { name: 'Bulk actions' });
  await expect(bar).toContainText('2 selected');
  await bar.getByRole('button', { name: 'Resolve' }).click();
  await expect(bar).toHaveCount(0);
  await expect(group(page, 'idle')).toHaveCount(0);
  await group(page, 'resolved').getByRole('button').first().click();
  await expect(group(page, 'resolved').locator('[data-slot="thread-row"]')).toHaveCount(4);
});

test('bulk Archive removes the threads and Undo brings them back', async ({ page }) => {
  await page.goto(home('project-home'));
  await select(page, 'Sidebar status groups');
  await page.getByRole('toolbar', { name: 'Bulk actions' }).getByRole('button', { name: 'Archive' }).click();
  await expect(row(page, 'Sidebar status groups')).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(row(page, 'Sidebar status groups')).toHaveCount(1);
});

test('bulk Snooze files the threads under Idle with the snoozed mark, and Clear empties the selection', async ({
  page,
}) => {
  await page.goto(home('project-home'));
  await select(page, 'Fold finished turns into purpose and duration');
  await select(page, 'Sidebar status groups');
  await page.getByRole('toolbar', { name: 'Bulk actions' }).getByRole('button', { name: 'Clear selection' }).click();
  await expect(page.getByRole('toolbar', { name: 'Bulk actions' })).toHaveCount(0);
  await select(page, 'Fold finished turns into purpose and duration');
  await page.getByRole('toolbar', { name: 'Bulk actions' }).getByRole('button', { name: 'Snooze' }).click();
  await expect(group(page, 'review')).toContainText('0');
  await expect(row(page, 'Fold finished turns into purpose and duration').getByLabel('Snoozed')).toBeVisible();
});

test('closing the panel leaves a dot on the Threads button while something waits', async ({
  page,
}) => {
  await page.goto(home('project-home'));
  await inbox(page).getByRole('button', { name: 'Close Threads' }).click();
  await expect(inbox(page)).toHaveCount(0);
  await expect(page).toHaveURL(/inbox=0/);
  const toggle = page.getByTestId('threads-inbox-toggle');
  await expect(toggle.locator('[data-attention]')).toHaveCount(1);
  await toggle.click();
  await expect(inbox(page)).toBeVisible();
});

test('a row opens its thread', async ({ page }) => {
  await page.goto(home('project-home'));
  await row(page, 'Push for finished and failed threads').getByRole('button').first().click();
  await expect(page).toHaveURL(/\/app\/todo\/project-home-working/);
});
