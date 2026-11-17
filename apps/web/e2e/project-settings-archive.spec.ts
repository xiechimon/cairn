import { expect, type Page, test } from '@playwright/test';
import { mockLive } from './chief-home-mock';

const TEAM = { id: 'team-1', name: 'Team', createdAt: 0, plan: 'free', avatarStyle: null };
const USER = { id: 'user-1', displayName: '我', avatarUrl: null };
const PROJECT_ID = 'proj-archive';

async function stubWorld(page: Page) {
  let archivedAt: number | null = null;
  const calls: string[] = [];
  await page.route('**/api/**', (route, request) => {
    if (request.method() !== 'GET') return route.fallback();
    return route.fulfill({ status: 500, json: { error: 'e2e stub: not the surface under test' } });
  });
  await page.route('**/api/teams', (route) => route.fulfill({ json: [TEAM] }));
  await page.route('**/api/user/me', (route) => route.fulfill({ json: USER }));
  const project = () => ({ id: PROJECT_ID, name: 'archive-probe', teamId: TEAM.id, archivedAt });
  await page.route('**/api/projects?*', (route) => route.fulfill({ json: [project()] }));
  await page.route(`**/api/projects/${PROJECT_ID}/*archive`, (route, request) => {
    const action = new URL(request.url()).pathname.split('/').pop() ?? '';
    calls.push(action);
    archivedAt = action === 'archive' ? 1 : null;
    return route.fulfill({ json: project() });
  });
  return calls;
}

test('settings archive the project in place, with undo, and never offer delete', async ({
  page,
}) => {
  const calls = await stubWorld(page);
  await page.goto(`/app/project/${PROJECT_ID}/settings`);
  await expect(page.getByRole('button', { name: '删除', exact: true })).toHaveCount(0);
  const button = page.getByTestId('project-archive');
  await expect(button).toHaveText('归档');
  await button.click();
  await expect.poll(() => calls).toEqual(['archive']);
  await expect(page.getByText('已归档「archive-probe」')).toBeVisible();
  await expect(button).toHaveText('取消归档');
  await button.click();
  await expect.poll(() => calls).toEqual(['archive', 'unarchive']);
  await expect(button).toHaveText('归档');
});

test('while projects load, both sections show the loading state and no archive control', async ({
  page,
}) => {
  await mockLive(page, { threads: [], messages: [], todos: [] });
  await page.route('**/api/projects?**', () => undefined);
  await page.route('**/api/projects', () => undefined);
  for (const tab of ['general', 'memory']) {
    await page.goto(`/app/project/p-loading/settings?tab=${tab}`);
    await expect(page.getByTestId('project-loading')).toBeVisible();
    await expect(page.getByTestId('project-archive')).toHaveCount(0);
  }
});

test('an id the fixture does not list shows not found instead of an empty form', async ({
  page,
}) => {
  await page.goto('/app/project/nope-project/settings?scenario=activity');
  await expect(page.getByTestId('project-settings-missing')).toContainText('找不到这个项目');
  await expect(page.getByTestId('project-archive')).toHaveCount(0);
});
