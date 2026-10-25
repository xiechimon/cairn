import { expect, type Page, test } from '@playwright/test';

// Issue #133 acceptance, re-pinned for the Paper page shell (PR 6): every
// non-board route shares one top bar. Its title sits in flow, but the
// hit-test law stays: the back chevron and the right-side actions own their
// own centers. Sidebar destinations have no parent and render no back arrow;
// detail pages keep one that navigates to their real parent in-SPA (the
// no-reload mechanism is pinned in resource-back-spa.spec.ts, #1157).

/** The element must own the hit-test at its own center — nothing may sit
 *  above it. Same law as the expectMenuOnTop precedent in
 *  user-menu-trigger.spec.ts. */
async function expectOwnsCenter(
  page: Page,
  selector: string,
) {
  const owned = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return top != null && top.closest(sel) != null;
  }, selector);
  expect(owned).toBe(true);
}

for (const [route, scenario] of [
  ['/app/team', '12'],
  ['/app/account', '13'],
  ['/app/api-keys', 'api-keys'],
  ['/app/schedules', '11'],
  ['/app/resources/skills', '06'],
  ['/app/resources/mcp-servers', '07'],
  ['/app/resources/secrets', '08'],
  ['/app/resources/machines', '09'],
  ['/app/resources/providers', '10'],
  ['/app/project/ZAQczKCu0MOAzC1ZqcFlX', 'r2-24'],
] as const) {
  test(`sidebar destination renders no back arrow — ${route}`, async ({ page }) => {
    await page.goto(`${route}?scenario=${scenario}`);
    await expect(page.getByTestId('page-topbar')).toBeVisible();
    await expect(page.locator('[aria-label="返回"]')).toHaveCount(0);
  });
}

test('team right-slot action owns its hit area (`设置` in the top bar)', async ({ page }) => {
  await page.goto('/app/team?scenario=12');
  const right = page.locator('[aria-label="设置"]');
  expect(await right.count()).toBeGreaterThan(0);
  await expectOwnsCenter(page, '[aria-label="设置"]');
});

// resource-new testid: the hit-test probe claims the element by CSS selector,
// which a role locator cannot express (secondary carrier, #910).
for (const [route, scenario] of [
  ['/app/resources/skills', '06'],
  ['/app/resources/secrets', '08'],
  ['/app/resources/providers', '10'],
] as const) {
  test(`resources \`新建\` owns its hit area — ${route}`, async ({ page }) => {
    await page.goto(`${route}?scenario=${scenario}`);
    await expectOwnsCenter(page, '[data-testid="resource-new"]');
  });
}

for (const [route, backTo] of [
  ['/app/resources/machines/Kd8fG2hJ4mN9pQ1rStUvWx3?scenario=06', '/app/resources/machines'],
  ['/app/resources/agents/r3-builder?scenario=agent-detail', '/app/team'],
  [
    '/app/project/ZAQczKCu0MOAzC1ZqcFlX/settings?scenario=r2-24c',
    '/app/project/ZAQczKCu0MOAzC1ZqcFlX?scenario=r2-24c',
  ],
] as const) {
  test(`detail back owns its hit area and navigates to the parent — ${route}`, async ({ page }) => {
    await page.goto(route);
    await expectOwnsCenter(page, '[aria-label="返回"]');
    await page.locator('[aria-label="返回"]').click();
    await expect(page).toHaveURL(backTo);
  });
}
