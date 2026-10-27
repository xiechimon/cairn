import { expect, type Page, test } from '@playwright/test';
import { evidenceShot } from './evidence';

const TEAM_ID = 'team-1';
const USER = { id: 'user-1', displayName: '我', avatarUrl: null };
const TEAM = { id: TEAM_ID, name: 'Team', createdAt: 0, plan: 'free', avatarStyle: null };
const DRAFT_KEY = 'cairn.chief-draft';

const DRAFT = '帮我看看这个项目的进展 — reload 后逐字还在 (#1056)';

async function stubBoot(page: Page) {
  await page.route('**/api/**', (route, request) => {
    if (request.method() !== 'GET') return route.fallback();
    return route.fulfill({ status: 500, json: { error: 'e2e stub: not the surface under test' } });
  });
  await page.route('**/api/teams', (route) => route.fulfill({ json: [TEAM] }));
  await page.route('**/api/user/me', (route) => route.fulfill({ json: USER }));
  await page.route(`**/api/teams/${TEAM_ID}/notifications`, (route) =>
    route.fulfill({ json: { unreadThreadIds: [] } }),
  );
  await page.route(`**/api/teams/${TEAM_ID}/chief/threads`, (route, request) => {
    if (request.method() !== 'GET') return route.fallback();
    return route.fulfill({ json: [] });
  });
}

async function openChiefComposer(page: Page) {
  await stubBoot(page);
  await page.goto('/app?view=board');

  await page.getByRole('button', { name: '总管', exact: true }).click();
  const input = page.getByTestId('chief-composer-input');
  await expect(input).toBeVisible();
  await expect(input).toBeEditable();
  return { drawer: page.locator('.chief-drawer'), input };
}

const storedDraft = (page: Page) => page.evaluate((key) => localStorage.getItem(key), DRAFT_KEY);

test('live face: the draft survives a full-page reload', async ({ page }) => {
  const { input } = await openChiefComposer(page);
  await input.fill(DRAFT);
  await expect.poll(() => storedDraft(page)).toBe(DRAFT);
  await evidenceShot(page, 'draft-typed-before-reload.png');

  await page.reload();

  await expect(input).toBeVisible();
  await expect(input).toHaveValue(DRAFT);
  await expect.poll(() => storedDraft(page)).toBe(DRAFT);
  const focused = await page.evaluate(() =>
    document.activeElement?.getAttribute('data-testid'),
  );
  expect(focused).not.toBe('chief-composer-input');
  await evidenceShot(page, 'draft-restored-after-reload.png');
});

test('live face: an accepted send clears the persisted draft (no resurrection)', async ({
  page,
}) => {
  const { input } = await openChiefComposer(page);
  let posts = 0;
  await page.route(`**/api/teams/${TEAM_ID}/chief/threads`, (route, request) => {
    if (request.method() !== 'POST') return route.fallback();
    posts += 1;
    return route.fulfill({
      status: 200,
      json: { thread: { id: 'chief-1', teamId: TEAM_ID, title: DRAFT, createdAt: 0 } },
    });
  });

  await input.fill(DRAFT);
  await expect.poll(() => storedDraft(page)).toBe(DRAFT);
  await input.press('Enter');

  await expect.poll(() => posts).toBe(1);
  await expect(input).toHaveValue('');

  await expect.poll(() => storedDraft(page)).toBeNull();
  await evidenceShot(page, 'send-accepted-storage-cleared.png');

  await page.reload();
  await expect(input).toBeVisible();
  await expect(input).toHaveValue('');
});

test('live face: a rejected send keeps the draft in the box and in storage (#631)', async ({
  page,
}) => {
  const { input } = await openChiefComposer(page);
  await page.route(`**/api/teams/${TEAM_ID}/chief/threads`, (route, request) => {
    if (request.method() !== 'POST') return route.fallback();
    return route.fulfill({ status: 500, json: { error: 'upstream refused' } });
  });

  await input.fill(DRAFT);
  await expect.poll(() => storedDraft(page)).toBe(DRAFT);
  await input.press('Enter');

  await expect(input).toHaveValue(DRAFT);
  await expect.poll(() => storedDraft(page)).toBe(DRAFT);
  await evidenceShot(page, 'send-rejected-draft-persisted.png');

  await page.reload();
  await expect(input).toBeVisible();
  await expect(input).toHaveValue(DRAFT);
});

test('live face: minimize and SPA route switches keep the draft (D6 zero regression)', async ({
  page,
}) => {

  await page.addInitScript(() => localStorage.setItem('cairn.sidebarResourcesCollapsed', '0'));
  const { drawer, input } = await openChiefComposer(page);
  await input.fill(DRAFT);
  await expect.poll(() => storedDraft(page)).toBe(DRAFT);

  await drawer.getByRole('button', { name: '最小化' }).click();
  await expect(drawer).toBeHidden();
  await page.getByRole('button', { name: '总管', exact: true }).click();
  await expect(input).toBeVisible();
  await expect(input).toHaveValue(DRAFT);

  await page.getByRole('link', { name: '技能' }).click();
  await expect(page).toHaveURL(/\/app\/resources\/skills/);
  await expect(input).toHaveValue(DRAFT);
  await page.getByRole('link', { name: '工作台' }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(input).toHaveValue(DRAFT);
  await evidenceShot(page, 'd6-legs-draft-intact.png');
});

test('fixture face: zero writes, zero reads (A0 S11 shape)', async ({ page }) => {

  await page.addInitScript(
    ([key, value]) => localStorage.setItem(key, value),
    [DRAFT_KEY, 'SEEDED-BY-TEST'],
  );
  await page.goto('/app?view=board&scenario=111');
  const input = page.getByTestId('chief-composer-input');
  await expect(input).toBeVisible();

  await expect(input).not.toHaveValue('SEEDED-BY-TEST');
  await expect(input).toHaveValue(/我想做一个能在浏览器里直接玩的网页小游戏/);
  await expect(input).toHaveAttribute('readonly', '');
  await expect.poll(() => storedDraft(page)).toBe('SEEDED-BY-TEST');
  await evidenceShot(page, 'fixture-face-storage-untouched.png');
});
