import { expect, type Page, test } from '@playwright/test';

const PROJECT_ID = 'ZAQczKCu0MOAzC1ZqcFlX';
const CRED_PROJECT_ID = 'home-c-cred';
const conversation = (page: Page) => page.getByTestId('home-c');
const projectRow = (page: Page, name: string) =>
  page.locator('[data-slot="sidebar-project-row"]', { hasText: name });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('cairn.locale', 'en'));
});

test('clicking a project opens its conversation', async ({ page }) => {
  await page.goto('/app?scenario=home-c');
  await projectRow(page, 'cairn').click();
  await expect(page).toHaveURL(new RegExp(`project=${PROJECT_ID}&chat=1`));
  await expect(conversation(page).getByRole('heading', { level: 1 })).toHaveText('cairn');
  await expect(conversation(page).getByTestId('chief-composer-input')).toBeVisible();
  await expect(projectRow(page, 'cairn')).toHaveAttribute('aria-current', 'page');
});

test('a project link without chat opens the same conversation, not a separate project page', async ({
  page,
}) => {
  await page.goto(`/app?scenario=home-c&project=${PROJECT_ID}`);
  await expect(conversation(page).getByRole('heading', { level: 1 })).toHaveText('cairn');
  await expect(conversation(page).getByTestId('chief-composer-input')).toBeVisible();
  await expect(projectRow(page, 'cairn')).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('[data-slot="stat-strip"]')).toHaveCount(0);
});

test('a project picked in search opens its conversation', async ({ page }) => {
  await page.goto('/app?scenario=home-c');
  await page.getByRole('complementary').getByRole('button', { name: 'Search' }).click();
  const search = page.getByRole('dialog', { name: 'Search' });
  await search.getByRole('textbox').fill('cairn');
  await search.locator('[data-row-kind="project"]', { hasText: 'cairn' }).click();
  await expect(page).toHaveURL(new RegExp(`project=${PROJECT_ID}&chat=1$`));
  await expect(conversation(page).getByRole('heading', { level: 1 })).toHaveText('cairn');
});

test('from a project conversation, clicking another sidebar project opens that project conversation', async ({
  page,
}) => {
  await page.goto(`/app?scenario=home-c&project=${PROJECT_ID}&chat=1`);
  await expect(conversation(page)).toBeVisible();
  await projectRow(page, 'Credential relay').click();
  await expect(page).toHaveURL(new RegExp(`project=${CRED_PROJECT_ID}&chat=1`));
  await expect(conversation(page).getByRole('heading', { level: 1 })).toHaveText('Credential relay');
});

test('a task row in a project conversation opens that thread in the side chat beside it', async ({ page }) => {
  await page.goto(`/app?scenario=home-c&project=${PROJECT_ID}&thread=home-c-working-a`);
  await expect(page.getByTestId('side-chat')).toContainText('Push for finished threads');
  await expect(conversation(page)).toBeVisible();
});

test('switching to another project closes a task that belongs elsewhere, keeps one that belongs there, and Back reopens it', async ({
  page,
}) => {
  await page.goto('/app?scenario=home-c&pane=tasks&thread=home-c-working-a');
  const sideChat = page.getByTestId('side-chat');
  await expect(sideChat).toContainText('Push for finished threads');
  await page.getByRole('button', { name: 'Expand sidebar' }).first().click();
  await projectRow(page, 'cairn').click();
  await expect(page).toHaveURL(new RegExp(`project=${PROJECT_ID}`));
  await expect(page).toHaveURL(/thread=home-c-working-a/);
  await expect(sideChat).toContainText('Push for finished threads');
  await projectRow(page, 'Credential relay').click();
  await expect(page).toHaveURL(new RegExp(`project=${CRED_PROJECT_ID}`));
  await expect(page).not.toHaveURL(/thread=/);
  await expect(sideChat).toHaveCount(0);
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`project=${PROJECT_ID}.*thread=home-c-working-a|thread=home-c-working-a.*project=${PROJECT_ID}`));
  await expect(sideChat).toContainText('Push for finished threads');
});
