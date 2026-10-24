import { expect, type Page, test } from '@playwright/test';
import { pressAndExpect } from './helpers.js';

// Issue #387 acceptance: dicebear Lorelei avatar system — name-seeded
// generative avatars via the dicebear HTTP API (same name → same image, no
// storage). avatarUrl semantics: null = dicebear (new default), non-null =
// explicit override. Failure modes pinned:
// 1. a surface still renders the pre-#387 static asset (src assertions)
// 2. rail vs expanded sidebar chips diverge (one converted, one missed)
// 3. seed ≠ displayed name, or two different names share one image
// 4. explicit avatarUrl override loses to the dicebear URL
// 5. offline/API-down renders a broken image instead of the static fallback
// 6. CreateAgentDialog preview does not track the typed name
// 7. seed not URL-encoded (the fixture user name contains a space)
// 8. a surface missed by the sweep: ⌘K agent hit rows / 项目页任务行头像位
// All dicebear requests are intercepted — the specs assert the src contract,
// never live API availability; the fallback test aborts the same route.

const DICEBEAR = /https:\/\/api\.dicebear\.com\/9\.x\/lorelei\/svg\?seed=/;
const USER_SRC = 'https://api.dicebear.com/9.x/lorelei/svg?seed=Xmon%20Dai';
const AGENT_SRC = 'https://api.dicebear.com/9.x/lorelei/svg?seed=r3-builder';

const SVG_BODY =
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><circle cx="12" cy="12" r="12"/></svg>';

/** Hermetic dicebear: every generated avatar "loads" without network. */
async function stubDicebear(page: Page) {
  await page.route('**/api.dicebear.com/**', (route) =>
    route.fulfill({ contentType: 'image/svg+xml', body: SVG_BODY }),
  );
}

test('sidebar avatar chips (expanded + rail) and user-menu head share one seeded src', async ({
  page,
}) => {
  await stubDicebear(page);
  await page.goto('/app?scenario=01');
  const expanded = page.locator('.sidebar-user img');
  await expect(expanded).toHaveAttribute('src', USER_SRC);

  // user-menu head echoes the same identity → same image (同名恒同)
  await page.locator('.sidebar-user').click();
  await expect(page.locator('.user-menu-head img')).toHaveAttribute('src', USER_SRC);
  // XMON-107：菜单头的邮件行已删——head 只剩身份名一行（无邮箱账位面）。
  await expect(page.locator('.user-menu-mail')).toHaveCount(0);
  await page.keyboard.press('Escape');

  // rail chip: collapse via the persisted key (SIDEBAR_STORAGE_KEY mirror)
  await page.evaluate(() => localStorage.setItem('cairn.sidebar-collapsed', '1'));
  await page.reload();
  await expect(page.locator('.rail-user img')).toHaveAttribute('src', USER_SRC);
});

test('team agent card seeds by agent displayName — user/agent srcs differ (不同名不同像)', async ({
  page,
}) => {
  await stubDicebear(page);
  await page.goto('/app/team?scenario=12');
  const card = page.getByTestId('team-agent-card').filter({ hasText: 'r3-builder' });
  await expect(card.locator('img')).toHaveAttribute('src', AGENT_SRC);
});

test('live members projection: two agents → two distinct seeded srcs; avatarUrl override wins', async ({
  page,
}) => {
  await stubDicebear(page);
  // live boot stubs (skills-readonly stubBoot 纪律): catch-all 500 first,
  // specific routes after (page.route matches in reverse registration order)
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
  const agent = (id: string, displayName: string, avatarUrl: string | null) => ({
    id: `m-${id}`,
    teamId: 'team-1',
    actorId: id,
    memberType: 'agent',
    actor: { id, displayName, avatarUrl, modelId: null, description: null },
  });
  // data-URI override loads without network, so no onError swap can race the assertion
  const override = `data:image/svg+xml,${encodeURIComponent(SVG_BODY)}`;
  await page.route('**/api/teams/team-1/members', (route) =>
    route.fulfill({
      json: [
        agent('a1', 'Alpha', null),
        agent('a2', 'Beta', null),
        agent('a3', 'Gamma', override),
      ],
    }),
  );
  await page.goto('/app/team');

  const alpha = page.getByTestId('team-agent-card').filter({ hasText: 'Alpha' });
  const beta = page.getByTestId('team-agent-card').filter({ hasText: 'Beta' });
  const gamma = page.getByTestId('team-agent-card').filter({ hasText: 'Gamma' });
  await expect(alpha.locator('img')).toHaveAttribute(
    'src',
    'https://api.dicebear.com/9.x/lorelei/svg?seed=Alpha',
  );
  await expect(beta.locator('img')).toHaveAttribute(
    'src',
    'https://api.dicebear.com/9.x/lorelei/svg?seed=Beta',
  );
  await expect(gamma.locator('img')).toHaveAttribute('src', override);
});

test('detail chip popover: user row + 执行对话 agent row both seeded', async ({ page }) => {
  await stubDicebear(page);
  await page.goto('/app/todo/7ve0iOkQ-JBpSL98zSiGc?scenario=19');
  // #949 载体：popover = role dialog + 可及名；行族 = data-row-kind，选中
  // section = data-selected（旧 .chip-popover-row/.chip-popover-section--selected 类钉退役）
  const popover = page.getByRole('dialog', { name: '任务分配' });
  await expect(popover).toBeVisible();
  await expect(popover.locator('[data-row-kind="owner"] img')).toHaveAttribute('src', USER_SRC);
  await expect(popover.locator('[data-selected] [data-row-kind="agent"] img')).toHaveAttribute(
    'src',
    AGENT_SRC,
  );
});

test('create-agent dialog: empty name keeps the static asset; typing previews the seeded avatar', async ({
  page,
}) => {
  await stubDicebear(page);
  await page.goto('/app/team?scenario=12');
  await page.getByRole('button', { name: '创建 Agent' }).click();
  // #951/#910 重钉：.dlg-agent-avatar img → agent-avatar testid（二级载体，
  // img loaded 前 aria-hidden；overlays.css 清零）。
  const img = page.getByTestId('agent-avatar').locator('img');
  await expect(img).toHaveAttribute('src', '/avatar-robot-1.svg');
  await page.locator('#dlg-agent-name').fill('nova');
  await expect(img).toHaveAttribute(
    'src',
    'https://api.dicebear.com/9.x/lorelei/svg?seed=nova',
  );
});

test('dicebear unreachable → img onError falls back to the static asset (不裂图)', async ({
  page,
}) => {
  await page.route('**/api.dicebear.com/**', (route) => route.abort());
  await page.goto('/app?scenario=01');
  await expect(page.locator('.sidebar-user img')).toHaveAttribute('src', '/avatar-user.png');
});

test('search agent rows + project task rows are seeded (Agent 列表 / 任务行头像位)', async ({
  page,
}) => {
  await stubDicebear(page);
  // ⌘K 面板的 agent 命中行 = 搜索形态下的 Agent 列表面
  await page.goto('/app?scenario=01');
  await expect(page.locator('.sidebar-row').first()).toBeVisible();
  const searchPanel = page.getByRole('dialog', { name: '搜索' });
  await pressAndExpect(page, 'Meta+k', searchPanel);
  await page.keyboard.type('r3-builder');
  // #949：agent 行头像位 = data-row-kind 行族载体（.search-row-icon--agent 类钉退役）
  await expect(
    searchPanel.locator('[data-row-kind="agent"] img').first(),
  ).toHaveAttribute(
    'src',
    AGENT_SRC,
  );

  // 项目页任务行/卡的用户头像位(列表与网格两形共用 .prj-task-avatar)
  await page.goto('/app/project/ZAQczKCu0MOAzC1ZqcFlX?scenario=prj-tasks');
  await expect(page.locator('.prj-task-avatar img').first()).toHaveAttribute('src', USER_SRC);
});

test('conversation transcript: agent rows carry the assigned agent avatar, user rows the user avatar', async ({
  page,
}) => {
  await stubDicebear(page);
  // scenario=36 = done 详情面:同一条 todo(执行 agent = r3-builder)的对话列。
  // 对话是用户点名的面:agent 消息行必须显示该 agent 的头像(与看板卡/团队页
  // 同种子),用户消息行与侧栏用户 chip 同种子——不再落静态 Notionists 资产。
  await page.goto('/app/todo/7ve0iOkQ-JBpSL98zSiGc?scenario=36');
  await expect(page.locator('.chat-row--agent .chat-avatar img').first()).toHaveAttribute(
    'src',
    AGENT_SRC,
  );
  await expect(
    page
      .locator('.chat-row:not(.chat-row--agent):not(.chat-row--chief) .chat-avatar img')
      .first(),
  ).toHaveAttribute('src', USER_SRC);
});

test('account head shares the seeded user src (same identity as the sidebar chip)', async ({
  page,
}) => {
  await stubDicebear(page);
  await page.goto('/app/account?scenario=13');
  await expect(page.locator('.account-avatar img')).toHaveAttribute('src', USER_SRC);
});
