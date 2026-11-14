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
  await page.route(`**/api/teams/${TEAM_ID}/chief`, (route, request) => {
    if (request.method() !== 'GET') return route.fallback();
    return route.fulfill({
      json: {
        chief: {
          id: `chief-${USER.id}-${TEAM_ID}`,
          userId: USER.id,
          teamId: TEAM_ID,
          agent: null,
          charter: '',
          lastTurnAt: null,
          createdAt: 0,
          tz: null,
        },
        agentActor: null,
        context: null,
        watches: [],
        wakes: [],
      },
    });
  });
}

interface ServerDraft {
  content: string;
  updatedAt: number | null;
  puts: string[];
}

async function stubServerDraft(page: Page, seed?: string): Promise<ServerDraft> {
  const store: ServerDraft = {
    content: seed ?? '',
    updatedAt: seed === undefined ? null : 1,
    puts: [],
  };
  await page.route(`**/api/teams/${TEAM_ID}/drafts/chief`, async (route, request) => {
    if (request.method() === 'PUT') {
      const body = request.postDataJSON() as { content: string };
      store.puts.push(body.content);
      store.content = body.content;
      store.updatedAt = body.content === '' ? null : (store.updatedAt ?? 0) + 1;
    }
    return route.fulfill({ json: { content: store.content, updatedAt: store.updatedAt } });
  });
  return store;
}

async function openChiefComposer(page: Page, server?: { seed?: string }) {
  await stubBoot(page);
  const store = server === undefined ? null : await stubServerDraft(page, server.seed);
  await page.goto('/app');
  const input = page.getByTestId('chief-composer-input');
  await expect(input).toBeVisible();
  await expect(input).toBeEditable();
  return { input, store };
}

const storedDraft = (page: Page) => page.evaluate((key) => localStorage.getItem(key), DRAFT_KEY);

async function reloadHoldingStorage(page: Page) {
  const holder = await page.context().newPage();
  await holder.goto('/icon-192.png');
  await holder.evaluate(() => localStorage.length);
  await page.reload();
  await holder.close();
}

test('live face: the draft survives a full-page reload', async ({ page }) => {
  const { input } = await openChiefComposer(page);
  await input.fill(DRAFT);
  await expect.poll(() => storedDraft(page)).toBe(DRAFT);
  await evidenceShot(page, 'draft-typed-before-reload.png');

  await reloadHoldingStorage(page);

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

  await reloadHoldingStorage(page);
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

  await expect(page.getByText('发送失败，请重试。')).toBeVisible();
  await expect(input).toHaveValue(DRAFT);
  await expect.poll(() => storedDraft(page)).toBe(DRAFT);
  await evidenceShot(page, 'send-rejected-draft-persisted.png');

  await reloadHoldingStorage(page);
  await expect(input).toBeVisible();
  await expect(input).toHaveValue(DRAFT);
});

test('live face: route switches keep the draft (D6 zero regression)', async ({ page }) => {
  const { input } = await openChiefComposer(page);
  await input.fill(DRAFT);
  await expect.poll(() => storedDraft(page)).toBe(DRAFT);

  await page.getByTestId('sidebar-settings').click();
  await page.getByRole('dialog', { name: '设置' }).getByRole('link', { name: '技能' }).click();
  await expect(page).toHaveURL(/\/app\/settings\/skills/);
  await page.getByRole('dialog', { name: '设置' }).getByRole('button', { name: '关闭设置' }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(input).toHaveValue(DRAFT);
  await page.goto('/app/schedules');
  await page.getByRole('complementary').locator('[data-slot="sidebar-nav-row"]', { hasText: 'Coordinator' }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByTestId('home-c').getByTestId('chief-composer-input')).toHaveValue(DRAFT);
  await evidenceShot(page, 'd6-legs-draft-intact.png');
});

test('fixture face: zero writes, zero reads (A0 S11 shape)', async ({ page }) => {

  await page.addInitScript(
    ([key, value]) => localStorage.setItem(key, value),
    [DRAFT_KEY, 'SEEDED-BY-TEST'],
  );
  await page.goto('/app?scenario=111');
  const input = page.getByTestId('chief-composer-input');
  await expect(input).toBeVisible();

  await expect(input).not.toHaveValue('SEEDED-BY-TEST');
  await input.fill('fixture typing');
  await expect.poll(() => storedDraft(page)).toBe('SEEDED-BY-TEST');
  await evidenceShot(page, 'fixture-face-storage-untouched.png');
});

test('live face: the draft is saved to the server and a fresh device restores it (D110)', async ({
  page,
}) => {
  const { input, store } = await openChiefComposer(page, {});
  if (store === null) throw new Error('server stub missing');
  await input.fill(DRAFT);
  await expect.poll(() => store.content).toBe(DRAFT);
  await expect
    .poll(() => page.evaluate((key) => localStorage.getItem(`${key}.sync`), DRAFT_KEY))
    .toContain('"dirty":false');

  await page.evaluate(() => localStorage.clear());
  await reloadHoldingStorage(page);
  await expect(input).toHaveValue(DRAFT);
  await evidenceShot(page, 'server-draft-restored-on-fresh-device.png');
});

test('live face: a draft stored by another device appears on open (D110)', async ({ page }) => {
  const { input } = await openChiefComposer(page, {
    seed: '![shot.png](attachment:team-1/att-1.png)\n来自另一台设备的草稿',
  });
  await expect(input).toHaveValue(/来自另一台设备的草稿/);
  await evidenceShot(page, 'server-draft-from-other-device.png');
});

test('live face: an accepted send clears the server draft; a rejected send keeps it (D110)', async ({
  page,
}) => {
  const { input, store } = await openChiefComposer(page, {});
  if (store === null) throw new Error('server stub missing');
  let accept = false;
  await page.route(`**/api/teams/${TEAM_ID}/chief/threads`, (route, request) => {
    if (request.method() !== 'POST') return route.fallback();
    if (!accept) return route.fulfill({ status: 500, json: { error: 'upstream refused' } });
    return route.fulfill({
      status: 200,
      json: { thread: { id: 'chief-1', teamId: TEAM_ID, title: DRAFT, createdAt: 0 } },
    });
  });

  await input.fill(DRAFT);
  await expect.poll(() => store.content).toBe(DRAFT);
  await input.press('Enter');
  await expect(page.getByText('发送失败，请重试。')).toBeVisible();
  await expect(input).toHaveValue(DRAFT);
  await expect.poll(() => store.content).toBe(DRAFT);

  accept = true;
  await input.press('Enter');
  await expect(input).toHaveValue('');
  await expect.poll(() => store.content).toBe('');
  expect(store.updatedAt).toBeNull();
});
