import { expect, type Page, test } from '@playwright/test';

const PROJECT_ID = 'ZAQczKCu0MOAzC1ZqcFlX';
const CRED_PROJECT_ID = 'home-c-cred';
const projectHome = (query = '') => `/app?scenario=home-c&project=${PROJECT_ID}${query}`;
const home = (page: Page) => page.getByTestId('project-home');
const group = (page: Page, label: string) =>
  home(page).locator('[data-slot="stone-group"]', { hasText: label });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('cairn.locale', 'en'));
});

test('clicking a project opens its conversation, not a project home', async ({ page }) => {
  await page.goto('/app?scenario=home-c');
  await page.locator('[data-slot="sidebar-project-row"]', { hasText: 'cairn' }).click();
  await expect(page).toHaveURL(new RegExp(`project=${PROJECT_ID}&chat=1`));
  await expect(page.getByTestId('home-c').getByRole('heading', { level: 1 })).toHaveText('cairn');
  await expect(page.getByTestId('home-c').getByTestId('chief-composer-input')).toBeVisible();
  await expect(home(page)).toHaveCount(0);
  await expect(
    page.locator('[data-slot="sidebar-project-row"]', { hasText: 'cairn' }),
  ).toHaveAttribute('aria-current', 'page');
});

test('a project picked in search opens its conversation', async ({ page }) => {
  await page.goto('/app?scenario=home-c');
  await page.getByRole('complementary').getByRole('button', { name: 'Search' }).click();
  const search = page.getByRole('dialog', { name: 'Search' });
  await search.getByRole('textbox').fill('cairn');
  await search.locator('[data-row-kind="project"]', { hasText: 'cairn' }).click();
  await expect(page).toHaveURL(new RegExp(`project=${PROJECT_ID}&chat=1$`));
  await expect(page.getByTestId('home-c').getByRole('heading', { level: 1 })).toHaveText('cairn');
  await expect(home(page)).toHaveCount(0);
});

test('the back link of the project settings opens the project conversation', async ({ page }) => {
  await page.goto(`/app/project/${PROJECT_ID}/settings?scenario=home-c`);
  await page.getByTestId('page-topbar').getByRole('link', { name: 'Back' }).click();
  await expect(page).toHaveURL(new RegExp(`/app\\?scenario=home-c&project=${PROJECT_ID}&chat=1$`));
  await expect(page.getByTestId('home-c').getByTestId('chief-composer-input')).toBeVisible();
  await expect(home(page)).toHaveCount(0);
});

test('the threads are this project only, grouped by state with counts', async ({ page }) => {
  await page.goto(projectHome());
  await expect(group(page, 'Needs you')).toContainText('Connect a Claude subscription token');
  await expect(group(page, 'Needs you')).toContainText('Fold finished turns into purpose and duration');
  await expect(group(page, 'In progress')).toContainText('Push for finished threads');
  await expect(group(page, 'In progress')).toContainText('Serif greeting fix');
  await expect(group(page, 'Up next')).toContainText('Sidebar status groups');
  await expect(home(page)).not.toContainText('Rerun the relay probe');
  await expect(home(page)).not.toContainText('Orb canary round 7');
  const stats = home(page).locator('[data-slot="stat-strip"]');
  await expect(stats).toContainText('2Needs you');
  await expect(stats).toContainText('2In progress');
});

test('a thread row opens that thread in the side chat over the project home', async ({ page }) => {
  await page.goto(projectHome());
  await group(page, 'In progress').getByRole('button', { name: /Push for finished threads/ }).click();
  await expect(page).toHaveURL(/\/app\?.*thread=home-c-working-a/);
  await expect(page.getByTestId('side-chat')).toContainText('Push for finished threads');
  await expect(page.getByTestId('project-home')).toBeVisible();
});

test('the project home links to tasks and project settings without a files entry', async ({ page }) => {
  await page.goto(projectHome());
  const links = page.getByTestId('project-home-links');
  await expect(links.getByRole('link', { name: 'Files' })).toHaveCount(0);
  await links.getByRole('link', { name: 'Tasks' }).click();
  await expect(page).toHaveURL(new RegExp(`/app/project/${PROJECT_ID}/tasks`));
  await page.goBack();
  await links.getByRole('link', { name: 'Project settings' }).click();
  await expect(page).toHaveURL(new RegExp(`/app/project/${PROJECT_ID}/settings`));
});

test('the ask link opens the project chat scoped to this project', async ({ page }) => {
  await page.goto(projectHome());
  await home(page).getByTestId('project-home-ask').click();
  await expect(page).toHaveURL(new RegExp(`project=${PROJECT_ID}.*chat=1`));
  await expect(page.getByTestId('home-c').getByTestId('chief-composer-input')).toHaveAttribute(
    'placeholder',
    /cairn|Type your own answer/,
  );
  await expect(page.getByTestId('home-c-project-links')).toHaveCount(0);
});

test('from a project chat, clicking another sidebar project opens that project conversation', async ({
  page,
}) => {
  await page.goto(projectHome('&chat=1'));
  await expect(page.getByTestId('home-c')).toBeVisible();
  await page.locator('[data-slot="sidebar-project-row"]', { hasText: 'Credential relay' }).click();
  await expect(page).toHaveURL(new RegExp(`project=${CRED_PROJECT_ID}&chat=1`));
  await expect(page.getByTestId('home-c').getByRole('heading', { level: 1 })).toHaveText('Credential relay');
  await expect(home(page)).toHaveCount(0);
});

test('the Coordinator shortcut on a project home opens the project chat with the composer focused', async ({
  page,
}) => {
  await page.goto(projectHome());
  await expect(home(page)).toBeVisible();
  await page.keyboard.press('ControlOrMeta+j');
  await expect(page).toHaveURL(/chat=1/);
  await expect(page.getByTestId('home-c').getByTestId('chief-composer-input')).toBeFocused();
});

test('instructions, memory, secrets and concurrency show where they will live', async ({ page }) => {
  await page.goto(projectHome());
  for (const title of ['Instructions', 'Project memory', 'Schedules']) {
    await expect(home(page).getByRole('heading', { name: title, level: 3 })).toBeVisible();
  }
  await expect(home(page).getByText('Secrets', { exact: true })).toBeVisible();
  await expect(home(page).getByText('Concurrency and priority')).toBeVisible();
});

test('a project with no threads says so', async ({ page }) => {
  await page.goto(`/app?scenario=home-c-empty&project=${PROJECT_ID}`);
  await expect(home(page)).toBeVisible();
  await expect(home(page).getByTestId('project-home-empty')).toBeVisible();
});

test('another project shows its own threads', async ({ page }) => {
  await page.goto(`/app?scenario=home-c&project=${CRED_PROJECT_ID}`);
  await expect(home(page).getByRole('heading', { level: 2 })).toHaveText('Credential relay');
  await expect(home(page)).toContainText('Rerun the relay probe');
  await expect(home(page)).not.toContainText('Serif greeting fix');
});

for (const theme of ['light', 'dark']) {
  test(`phone width stacks the project home without horizontal scroll in ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript((value) => localStorage.setItem('cairn-theme', value), theme);
    await page.goto(projectHome());
    await expect(home(page)).toBeVisible();
    const width = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(width).toBeLessThanOrEqual(390);
    await expect(home(page).getByTestId('project-home-ask')).toBeInViewport();
  });
}
