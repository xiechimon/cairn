import { expect, type Page, test } from '@playwright/test';

interface StubMachine {
  id: string;
  name: string;
  teamId: string;
  online: boolean;
  latestCliVersion: null;
  kind: 'local' | 'remote';
  enabledRuntimes: string[];
  maxConcurrent?: number;
  runningSteps?: number;
}

const LOCAL: StubMachine = {
  id: 'm-local',
  name: 'xmonsMac-3574.local',
  teamId: 'team-1',
  online: true,
  latestCliVersion: null,
  kind: 'local',
  enabledRuntimes: [],
};

const LOCAL_ROW = 'div[data-kind="local"]';

async function stubStack(page: Page, rows: StubMachine[]) {
  const state = { rows: rows.map((r) => ({ ...r })), patches: [] as unknown[] };

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
  await page.route('**/api/teams/team-1/machines', (route) =>
    route.fulfill({ json: state.rows }),
  );
  await page.route('**/api/machines/*', (route) => {
    const id = new URL(route.request().url()).pathname.split('/').pop();
    state.patches.push(route.request().postDataJSON());
    const body = route.request().postDataJSON() as { maxConcurrent?: number };
    state.rows = state.rows.map((r) =>
      r.id === id
        ? { ...r, ...(body.maxConcurrent !== undefined ? { maxConcurrent: body.maxConcurrent } : {}) }
        : r,
    );
    return route.fulfill({ json: state.rows.find((r) => r.id === id) });
  });
  return state;
}

test('C1+C2+C4: concurrency selector — reads annotation truth, PATCHes a single field, persists across reload', async ({ page }) => {
  const state = await stubStack(page, [{ ...LOCAL, maxConcurrent: 2, runningSteps: 1 }]);
  await page.goto('/app/resources/machines');

  await expect(page.locator('[data-machine-running="1"]')).toHaveText('执行中 1/2');

  const trigger = page.locator('button[aria-label^="并发上限"]');
  await expect(trigger).toHaveAccessibleName('并发上限 2');
  await expect(trigger).toContainText('2');
  await trigger.click();
  await page.getByRole('spinbutton', { name: '并发上限' }).fill('4');
  await page.getByRole('spinbutton', { name: '并发上限' }).press('Enter');

  await expect.poll(() => state.patches.length).toBe(1);
  expect(state.patches[0]).toEqual({ maxConcurrent: 4 });

  await page.reload();
  await expect(page.locator('button[aria-label^="并发上限"]')).toContainText('4');
});

test('C3: old server shape (no maxConcurrent field) → the whole control + annotation group retires', async ({ page }) => {
  await stubStack(page, [LOCAL]);
  await page.goto('/app/resources/machines');
  await expect(page.locator('button[aria-label^="并发上限"]')).toHaveCount(0);
  await expect(page.locator('[data-machine-running]')).toHaveCount(0);

  await expect(page.locator(LOCAL_ROW)).toBeVisible();
  await expect(page.locator(`${LOCAL_ROW} [data-runtime="pi"]`)).toBeVisible();
});
