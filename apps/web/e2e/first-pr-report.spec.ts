import { expect, type Page, test } from '@playwright/test';

const TEAM_ID = 'team-1';
const USER = { id: 'user-1', displayName: '我', avatarUrl: null };
const OFF = {
  enabled: false,
  due: false,
  dismissedAt: null,
  firstPrAt: null,
  firstPrNumber: null,
};
const ON = {
  enabled: true,
  due: true,
  dismissedAt: null,
  firstPrAt: 3 * 86_400_000,
  firstPrNumber: 7,
};

function team(prompt: unknown) {
  return { id: TEAM_ID, name: 'Team', createdAt: 0, plan: 'free', avatarStyle: null, firstPrReportPrompt: prompt };
}

async function stubWorld(page: Page, prompt: Record<string, unknown>, patches: unknown[]) {
  let current = prompt;
  await page.route('**/api/**', (route, request) => {
    if (request.method() !== 'GET' && !request.url().includes('/api/teams/')) {
      return route.fulfill({ status: 500, json: { error: 'e2e stub: not the surface under test' } });
    }
    return route.fallback();
  });
  await page.route('**/api/teams', (route) => route.fulfill({ json: [team(current)] }));
  await page.route(`**/api/teams/${TEAM_ID}`, (route) => {
    if (route.request().method() === 'PATCH') {
      const body = route.request().postDataJSON() as {
        firstPrReportPrompt?: { enabled?: boolean; dismissed?: boolean };
      };
      patches.push(body);
      const dismissed = body.firstPrReportPrompt?.dismissed === true ? 5 : current.dismissedAt;
      current = {
        ...current,
        enabled: body.firstPrReportPrompt?.enabled ?? current.enabled,
        dismissedAt: dismissed,
        due: dismissed === null && current.due,
      };
      return route.fulfill({ json: team(current) });
    }
    return route.fulfill({ json: team(current) });
  });
  await page.route('**/api/user/me', (route) => route.fulfill({ json: USER }));
  await page.route('**/api/projects?*', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/todos?*', (route) => route.fulfill({ json: [] }));
}

test('setting on + a recorded first PR shows the card; its link opens the prefilled discussion', async ({
  page,
}) => {
  const patches: unknown[] = [];
  await stubWorld(page, ON, patches);
  await page.goto('/app?view=board');

  const card = page.locator('[data-first-pr-card="true"]');
  await expect(card).toBeVisible();
  await expect(card).toContainText('首个 PR 已合并');
  await expect(card).toContainText('3');

  const href = await card.getByRole('link').getAttribute('href');
  expect(href).toBeTruthy();
  const parsed = new URL(href ?? '');
  expect(parsed.host).toBe('github.com');
  expect(parsed.pathname).toBe('/xiechimon/cairn/discussions/new');
  expect(parsed.searchParams.get('title')?.length).toBeGreaterThan(0);
  expect(parsed.searchParams.get('body')).toContain('3 days');
});

test('dismissing hides it for good', async ({ page }) => {
  const patches: unknown[] = [];
  await stubWorld(page, ON, patches);
  await page.goto('/app?view=board');
  const card = page.locator('[data-first-pr-card="true"]');
  await expect(card).toBeVisible();

  await card.getByRole('button', { name: '不再显示' }).click();
  await expect(card).toHaveCount(0);
  expect(patches).toEqual([{ firstPrReportPrompt: { dismissed: true } }]);
});

test('with the setting off nothing is shown', async ({ page }) => {
  const patches: unknown[] = [];
  await stubWorld(page, OFF, patches);
  await page.goto('/app?view=board');
  await expect(page.locator('[data-first-pr-card="true"]')).toHaveCount(0);
  expect(patches).toEqual([]);
});

test('users enable the team prompt, persist it, and permanently dismiss the card through the UI', async ({ page }) => {
  const patches: unknown[] = [];
  await stubWorld(page, { ...ON, enabled: false }, patches);
  await page.addInitScript(() => localStorage.setItem('cairn.locale', 'en'));
  await page.goto('/app/account');
  const setting = page.getByRole('switch', { name: 'First-PR community prompt' });
  await expect(setting).toHaveAttribute('aria-checked', 'false');
  await setting.click();
  await expect(setting).toHaveAttribute('aria-checked', 'true');
  await page.reload();
  await expect(setting).toHaveAttribute('aria-checked', 'true');
  await page.goto('/app?view=board');
  const card = page.locator('[data-first-pr-card="true"]');
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: 'Do not show again' }).click();
  await expect(card).toHaveCount(0);
  await page.reload();
  await expect(card).toHaveCount(0);
  expect(patches).toEqual([
    { firstPrReportPrompt: { enabled: true } },
    { firstPrReportPrompt: { dismissed: true } },
  ]);
});

test('a failed team-setting save stays off and displays an error', async ({ page }) => {
  await stubWorld(page, OFF, []);
  await page.route(`**/api/teams/${TEAM_ID}`, (route) =>
    route.fulfill({ status: 500, json: { error: 'save failed' } }),
  );
  await page.addInitScript(() => localStorage.setItem('cairn.locale', 'en'));
  await page.goto('/app/account');
  const setting = page.getByRole('switch', { name: 'First-PR community prompt' });
  await expect(setting).toHaveAttribute('aria-checked', 'false');
  await setting.click();
  await expect(page.locator('[data-sonner-toast]').first()).toContainText('Save failed. Try again.');
  await expect(setting).toHaveAttribute('aria-checked', 'false');
});
