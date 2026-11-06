import { expect, type Page, test } from '@playwright/test';

interface StubMachine {
  id: string;
  name: string;
  teamId: string;
  online: boolean;
  latestCliVersion: null;
  kind: 'local' | 'remote';
  enabledRuntimes: string[];
}

const machine = (id: string, name: string): StubMachine => ({
  id,
  name,
  teamId: 'team-1',
  online: true,
  latestCliVersion: null,
  kind: 'remote',
  enabledRuntimes: [],
});

async function stubStack(page: Page) {
  const state = { rows: [machine('m-1', 'alpha'), machine('m-2', 'beta')], gets: 0 };
  await page.route('**/api/**', (route, request) => {
    if (request.method() !== 'GET') return route.fallback();
    return route.fulfill({ status: 500, json: { error: 'e2e stub: not the surface under test' } });
  });
  await page.route('**/api/teams', (route) =>
    route.fulfill({
      json: [{ id: 'team-1', name: 'Team', createdAt: 0, plan: 'free', avatarStyle: null }],
    }),
  );
  await page.route('**/api/user/me', (route) =>
    route.fulfill({ json: { id: 'user-1', displayName: '我', avatarUrl: null } }),
  );
  await page.route('**/api/teams/team-1/machines', (route) => {
    state.gets += 1;
    return route.fulfill({ json: state.rows });
  });
  await page.route('**/api/teams/team-1/members', (route) =>
    route.fulfill({ json: [] }),
  );
  await page.route('**/api/machines/*', (route, request) => {
    if (request.method() !== 'DELETE') return route.fallback();
    const id = new URL(request.url()).pathname.split('/').pop();
    state.rows = state.rows.filter((r) => r.id !== id);
    return route.fulfill({ json: { ok: true } });
  });
  return state;
}

test('deleting the selected machine drops it from the mounted list and selects the next one', async ({
  page,
}) => {
  await stubStack(page);
  await page.goto('/app/settings/machines');
  const items = page.getByTestId('machine-item');
  await expect(items).toHaveCount(2);
  await expect(page.getByTestId('machine-detail-name')).toHaveText('alpha');

  await page.getByRole('button', { name: '删除', exact: true }).click();
  await page.getByRole('alertdialog', { name: '删除机器' }).getByRole('button', { name: '删除' }).click();

  await expect(items).toHaveCount(1);
  await expect(page.getByTestId('machine-detail-name')).toHaveText('beta');
});
