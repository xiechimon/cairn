import { expect, type Page, test } from '@playwright/test';

// #1037 propagation contract: ?scenario= rides sidebar hops by design — the
// fixture data source must survive navigation (sidebar.tsx carries the live
// search; sidebar-nav / shell-consistency / search-result-rows pin the URL
// carry with 18+ assertions). Production builds fold the param away at
// compile time (api/mode.ts), so a stray scenario can only mute faces in
// dev/fixture builds. The contract for those builds: the mode announces
// itself. A site-wide chip names the scenario, and being pointer-events-none
// it can never become a dead control itself (the very defect class of this
// ticket). The live face renders no chip.

const TEAM = { id: 'team-1', name: 'Team', createdAt: 0, plan: 'free', avatarStyle: null };
const USER = { id: 'user-1', displayName: '我', avatarUrl: null };

async function stubLiveBoot(page: Page) {
  await page.route('**/api/**', (route, request) => {
    if (request.method() !== 'GET') return route.fallback();
    return route.fulfill({ status: 500, json: { error: 'e2e stub: not the surface under test' } });
  });
  await page.route('**/api/teams', (route) => route.fulfill({ json: [TEAM] }));
  await page.route('**/api/user/me', (route) => route.fulfill({ json: USER }));
}

test('fixture mode shows the `示例数据` chip naming the scenario, site-wide (#1037)', async ({
  page,
}) => {
  await page.goto('/app/schedules?scenario=11');
  const chip = page.locator('.fixture-mode-chip');
  await expect(chip).toBeVisible();
  await expect(chip).toContainText('示例数据');
  await expect(chip).toContainText('scenario 11');
  // Bridge-level, not page-local: the board face carries the same chip.
  await page.goto('/app?scenario=01');
  await expect(page.locator('.fixture-mode-chip')).toBeVisible();
});

test('the chip never swallows clicks — pointer-events-none (#1037)', async ({ page }) => {
  await page.goto('/app/schedules?scenario=11');
  await expect(page.locator('.fixture-mode-chip')).toHaveCSS('pointer-events', 'none');
});

test('live face renders no fixture chip (#1037)', async ({ page }) => {
  await stubLiveBoot(page);
  await page.goto('/app/schedules');
  await expect(page.locator('.fixture-mode-chip')).toHaveCount(0);
});
