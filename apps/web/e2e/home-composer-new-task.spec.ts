import { expect, type Page, test } from '@playwright/test';
import { mockLive, PROJECT, TASK, THREAD } from './chief-home-mock';

const SITE = { ...PROJECT, id: 'proj-2', name: 'cairn-site', repoName: 'cairn-site' };
const CREATED = { ...TASK, id: 'todo-new', seqNum: 99, title: '', phase: 'draft' };

const composer = (page: Page) => page.getByTestId('home-c').getByTestId('chief-composer-input');
const saveDraft = (page: Page) => page.getByTestId('composer-save-draft');

async function mockWorld(page: Page, { failTodo = false } = {}) {
  const todoPosts: { projectId: string; spec: string }[] = [];
  const chiefPosts: { content: string; projectId?: string | null }[] = [];
  await mockLive(page, { threads: [THREAD], messages: [], todos: [TASK], projects: [PROJECT, SITE] }, (path, route, json) => {
    const request = route.request();
    if (request.method() !== 'POST') return undefined;
    const todo = path.match(/^\/api\/projects\/([^/]+)\/todos$/);
    if (todo !== null) {
      todoPosts.push({ projectId: todo[1], spec: (request.postDataJSON() as { spec: string }).spec });
      if (failTodo) return json({ error: 'e2e stub: todo write failed' }, 500);
      return json({ ...CREATED, projectId: todo[1] }, 201);
    }
    if (path === `/api/conversations/${THREAD.id}/messages` || path === '/api/teams/t1/chief/threads') {
      chiefPosts.push(request.postDataJSON() as { content: string; projectId?: string | null });
      return json({ thread: THREAD }, 201);
    }
    return undefined;
  });
  return { todoPosts, chiefPosts };
}

test('the C hotkey from another page lands on the home with the composer focused', async ({ page }) => {
  await page.goto('/app/schedules?scenario=home-c');
  await page.locator('body').press('c');
  await expect(page).toHaveURL(/\/app\?/);
  await expect(composer(page)).toBeFocused();
  await expect(page.getByRole('dialog', { name: '新建任务' })).toHaveCount(0);
});

test('the sidebar New task row focuses the home composer instead of opening a dialog', async ({ page }) => {
  await page.goto('/app?scenario=home-c');
  await page.getByRole('complementary').locator('.sidebar-new-task').getByText('新任务').click();
  await expect(composer(page)).toBeFocused();
  await expect(page.getByRole('dialog', { name: '新建任务' })).toHaveCount(0);
});

test('Save without starting records a draft task in the chosen project with no Coordinator turn', async ({ page }) => {
  const { todoPosts, chiefPosts } = await mockWorld(page);
  await page.goto('/app');
  await page.getByTestId('chief-project-chip').click();
  await page.getByRole('menuitemradio', { name: /cairn-site/ }).click();
  await composer(page).fill('Write the release notes');
  await saveDraft(page).click();
  await expect.poll(() => todoPosts).toEqual([{ projectId: SITE.id, spec: 'Write the release notes' }]);
  await expect(composer(page)).toHaveValue('');
  expect(chiefPosts).toEqual([]);
});

test('a composer message still goes to the Coordinator, carrying the chip project', async ({ page }) => {
  const { todoPosts, chiefPosts } = await mockWorld(page);
  await page.goto('/app');
  await page.getByTestId('chief-project-chip').click();
  await page.getByRole('menuitemradio', { name: /cairn-site/ }).click();
  await composer(page).fill('Plan the landing page');
  await composer(page).press('Enter');
  await expect.poll(() => chiefPosts.map((post) => [post.content, post.projectId])).toEqual([
    ['Plan the landing page', SITE.id],
  ]);
  expect(todoPosts).toEqual([]);
});

test('the chip project is remembered across a reload', async ({ page }) => {
  await mockWorld(page);
  await page.goto('/app');
  await page.getByTestId('chief-project-chip').click();
  await page.getByRole('menuitemradio', { name: /cairn-site/ }).click();
  await page.reload();
  await expect(page.getByTestId('chief-project-chip')).toContainText('cairn-site');
});

test('Save without starting is disabled while the composer is empty', async ({ page }) => {
  await mockWorld(page);
  await page.goto('/app');
  await expect(saveDraft(page)).toBeDisabled();
  await composer(page).fill('x');
  await expect(saveDraft(page)).toBeEnabled();
});

test('at phone width the project chip and Save without starting stay on the composer', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockWorld(page);
  await page.goto('/app');
  const box = (await page.getByTestId('home-c').locator('.chief-composer').boundingBox())!;
  for (const control of [page.getByTestId('chief-project-chip'), saveDraft(page)]) {
    await expect(control).toBeVisible();
    const inner = (await control.boundingBox())!;
    expect(inner.x).toBeGreaterThanOrEqual(box.x);
    expect(inner.x + inner.width).toBeLessThanOrEqual(box.x + box.width);
  }
});

test('a home filtered to a project pins the chip to it over a remembered pick', async ({ page }) => {
  await page.addInitScript((id) => localStorage.setItem('cairn.chief-project', id), SITE.id);
  const { todoPosts } = await mockWorld(page);
  await page.goto(`/app?project=${PROJECT.id}`);
  await expect(page.getByTestId('chief-project-chip')).toContainText(PROJECT.name);
  await composer(page).fill('Pinned to the filter');
  await saveDraft(page).click();
  await expect.poll(() => todoPosts).toEqual([{ projectId: PROJECT.id, spec: 'Pinned to the filter' }]);
});

test('a failed save keeps the draft in the composer and says so', async ({ page }) => {
  await mockWorld(page, { failTodo: true });
  await page.goto('/app');
  await composer(page).fill('Do not lose me');
  await saveDraft(page).click();
  await expect(page.getByText('新建任务失败，请重试。')).toBeVisible();
  await expect(composer(page)).toHaveValue('Do not lose me');
});

test('the C hotkey from Coordinator settings leaves settings and focuses the composer', async ({ page }) => {
  await page.goto('/app?scenario=home-c&chief=settings');
  await expect(page.getByTestId('home-c')).toHaveCount(0);
  await page.locator('body').press('c');
  await expect(composer(page)).toBeFocused();
});

test('repeated C presses on the home add no history entries', async ({ page }) => {
  await page.goto('/app/schedules?scenario=home-c');
  await page.locator('body').press('c');
  await expect(composer(page)).toBeFocused();
  const depth = await page.evaluate(() => history.length);
  await page.locator('body').click({ position: { x: 600, y: 300 } });
  await page.locator('body').press('c');
  await expect(composer(page)).toBeFocused();
  expect(await page.evaluate(() => history.length)).toBe(depth);
});
