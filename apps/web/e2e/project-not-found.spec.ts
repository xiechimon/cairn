import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { mockLive, PROJECT } from './chief-home-mock';

const KNOWN_ID = 'ZAQczKCu0MOAzC1ZqcFlX';
const notFound = (page: Page) => page.getByTestId('project-not-found');
const suggestions = (page: Page) => page.getByTestId('project-suggestion');

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('cairn.locale', 'en'));
});

test('an unknown project id shows the not-found page, not the Coordinator home', async ({
  page,
}) => {
  await page.goto('/app?scenario=home-c&project=cairn-old');
  await expect(notFound(page)).toBeVisible();
  await expect(notFound(page).getByRole('heading', { name: 'That project is not here' })).toBeVisible();
  await expect(page.getByTestId('project-not-found-id')).toHaveText('cairn-old');
  await expect(page.getByTestId('home-c')).toHaveCount(0);
  await expect(page.getByTestId('project-home')).toHaveCount(0);
});

test('close names are suggested and a suggestion opens that project home', async ({ page }) => {
  await page.goto('/app?scenario=home-c&project=cairn-old');
  await expect(suggestions(page)).toHaveCount(1);
  await page.getByRole('link', { name: 'cairn', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`project=${KNOWN_ID}`));
  await expect(page.getByTestId('project-home')).toBeVisible();
  await expect(notFound(page)).toHaveCount(0);
});

test('with no close name the most recent projects are listed', async ({ page }) => {
  await page.goto('/app?scenario=home-c&project=zzzzzzzz');
  await expect(notFound(page).getByRole('navigation', { name: 'Recent projects' })).toBeVisible();
  expect(await suggestions(page).count()).toBeGreaterThan(0);
  expect(await suggestions(page).count()).toBeLessThanOrEqual(3);
});

test('Open the Coordinator drops the project and lands on the Coordinator home', async ({
  page,
}) => {
  await page.goto('/app?scenario=home-c&project=cairn-old');
  await notFound(page).getByRole('button', { name: 'Open the Coordinator' }).click();
  await expect(page).not.toHaveURL(/project=/);
  await expect(page.getByTestId('home-c')).toBeVisible();
  await expect(notFound(page)).toHaveCount(0);
});

test('while projects load there is no flash of not-found or of the Coordinator home', async ({
  page,
}) => {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await mockLive(page, { threads: [], messages: [] }, (path, _route, json) =>
    path === '/api/projects' ? gate.then(() => json([PROJECT])) : undefined,
  );
  await page.goto('/app?project=proj-1');
  await expect(page.getByTestId('project-loading')).toBeVisible();
  await expect(notFound(page)).toHaveCount(0);
  await expect(page.getByTestId('home-c')).toHaveCount(0);
  release();
  await expect(page.getByTestId('project-home')).toBeVisible();
  await expect(page.getByTestId('project-loading')).toHaveCount(0);
});

test('a project list that fails to load shows an error with retry, not not-found', async ({
  page,
}) => {
  let failures = 2;
  await mockLive(page, { threads: [], messages: [] }, (path, _route, json) => {
    if (path !== '/api/projects' || failures === 0) return undefined;
    failures -= 1;
    return json({ error: 'boom' }, 500);
  });
  await page.goto('/app?project=proj-1');
  const error = page.getByTestId('project-load-error');
  await expect(error).toBeVisible();
  await expect(notFound(page)).toHaveCount(0);
  await error.getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByTestId('project-home')).toBeVisible();
});

test('live: an id missing from a loaded list is not-found with the list as suggestions', async ({
  page,
}) => {
  await mockLive(page, { threads: [], messages: [] });
  await page.goto('/app?project=cairn-old');
  await expect(notFound(page)).toBeVisible();
  await expect(suggestions(page)).toHaveCount(1);
  await expect(page.getByRole('link', { name: 'cairn', exact: true })).toBeVisible();
});

for (const theme of ['light', 'dark'] as const) {
  test(`not-found has no axe violations (${theme})`, async ({ page }) => {
    await page.addInitScript((t) => localStorage.setItem('cairn-theme', t), theme);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/app?scenario=home-c&project=cairn-old');
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expect(notFound(page)).toBeVisible();
    const { violations } = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(violations.map((v) => v.id)).toEqual([]);
  });
}

test('at 390px the page fits without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/app?scenario=home-c&project=cairn-old-with-a-very-long-identifier-that-keeps-going');
  await expect(notFound(page)).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBe(0);
  const box = await notFound(page).getByRole('button', { name: 'Open the Coordinator' }).boundingBox();
  expect(box).not.toBeNull();
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(390);
});
