import { expect, test } from '@playwright/test';
import { spiralAvatarSvg, spiralAvatarUrl } from '../src/lib/spiral-avatar.js';
import { pressAndExpect } from './helpers.js';


const USER_SRC = spiralAvatarUrl('Xmon Dai');
const AGENT_SRC = spiralAvatarUrl('r3-builder');

const SVG_BODY =
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><circle cx="12" cy="12" r="12"/></svg>';

test('sidebar avatar chips (expanded + rail) and user-menu head share one seeded src', async ({
  page,
}) => {
  await page.goto('/app?scenario=01');
  const expanded = page.locator('.sidebar-user img');
  await expect(expanded).toHaveAttribute('src', USER_SRC);

  await page.locator('.sidebar-user').click();
  await expect(page.locator('.user-menu-head img')).toHaveAttribute('src', USER_SRC);
  await expect(page.locator('.user-menu-mail')).toHaveCount(0);
  await page.keyboard.press('Escape');

  await page.evaluate(() => localStorage.setItem('cairn.sidebar-collapsed', '1'));
  await page.reload();
  await expect(page.locator('.rail-user img')).toHaveAttribute('src', USER_SRC);
});

test('team agent card seeds by agent displayName — user/agent srcs differ (不同名不同像)', async ({
  page,
}) => {
  await page.goto('/app/team?scenario=12');
  const card = page.getByTestId('team-agent-card').filter({ hasText: 'r3-builder' });
  await expect(card.locator('img')).toHaveAttribute('src', AGENT_SRC);
});

test('live members projection: two agents → two distinct seeded srcs; avatarUrl override wins', async ({
  page,
}) => {
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
  await expect(alpha.locator('img')).toHaveAttribute('src', spiralAvatarUrl('Alpha'));
  await expect(beta.locator('img')).toHaveAttribute('src', spiralAvatarUrl('Beta'));
  expect(spiralAvatarUrl('Alpha')).not.toBe(spiralAvatarUrl('Beta'));
  await expect(gamma.locator('img')).toHaveAttribute('src', override);
});

test('detail chip popover: user row + 执行对话 agent row both seeded', async ({ page }) => {
  await page.goto('/app/todo/7ve0iOkQ-JBpSL98zSiGc?scenario=19');
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
  await page.goto('/app/team?scenario=12');
  await page.getByRole('button', { name: '创建 Agent' }).click();
  const img = page.getByTestId('agent-avatar').locator('img');
  await expect(img).toHaveAttribute('src', '/avatar-robot-1.svg');
  await page.locator('#dlg-agent-name').fill('nova');
  await expect(img).toHaveAttribute('src', spiralAvatarUrl('nova'));
});

test('unreachable avatarUrl override → img onError falls back to the static asset (不裂图)', async ({
  page,
}) => {
  await page.route('**/avatars.invalid/**', (route) => route.abort());
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
  await page.route('**/api/teams/team-1/members', (route) =>
    route.fulfill({
      json: [
        {
          id: 'm-a1',
          teamId: 'team-1',
          actorId: 'a1',
          memberType: 'agent',
          actor: {
            id: 'a1',
            displayName: 'Alpha',
            avatarUrl: 'https://avatars.invalid/alpha.png',
            modelId: null,
            description: null,
          },
        },
      ],
    }),
  );
  await page.goto('/app/team');
  const alpha = page.getByTestId('team-agent-card').filter({ hasText: 'Alpha' });
  await expect(alpha.locator('img')).toHaveAttribute('src', '/avatar-robot-1.svg');
});

test('no avatar surface reaches a third-party avatar host', async ({ page }) => {
  const hits: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('api.dicebear.com')) hits.push(request.url());
  });
  await page.goto('/app?scenario=01');
  await expect(page.locator('.sidebar-user img')).toHaveAttribute('src', USER_SRC);
  await page.goto('/app/team?scenario=12');
  await expect(page.getByTestId('team-agent-card').first().locator('img')).toBeVisible();
  await page.goto('/app/todo/7ve0iOkQ-JBpSL98zSiGc?scenario=36');
  await expect(page.locator('.chat-row--agent .chat-avatar img').first()).toBeVisible();
  expect(hits).toEqual([]);
});

test('search agent rows + project task rows are seeded (Agent 列表 / 任务行头像位)', async ({
  page,
}) => {
  await page.goto('/app?scenario=01');
  await expect(page.locator('.sidebar-row').first()).toBeVisible();
  const searchPanel = page.getByRole('dialog', { name: '搜索' });
  await pressAndExpect(page, 'Meta+k', searchPanel);
  await page.keyboard.type('r3-builder');
  await expect(
    searchPanel.locator('[data-row-kind="agent"] img').first(),
  ).toHaveAttribute(
    'src',
    AGENT_SRC,
  );

  await page.goto('/app/project/ZAQczKCu0MOAzC1ZqcFlX?scenario=prj-tasks');
  await expect(page.locator('.prj-task-avatar img').first()).toHaveAttribute('src', USER_SRC);
});

test('conversation transcript: agent rows carry the assigned agent avatar, user rows carry none', async ({
  page,
}) => {
  await page.goto('/app/todo/7ve0iOkQ-JBpSL98zSiGc?scenario=36');
  await expect(page.locator('.chat-row--agent .chat-avatar img').first()).toHaveAttribute(
    'src',
    AGENT_SRC,
  );
  await expect(page.locator('.chat-row--user').first()).toBeVisible();
  await expect(page.locator('.chat-row--user .chat-avatar')).toHaveCount(0);
});

test('account head shares the seeded user src (same identity as the sidebar chip)', async ({
  page,
}) => {
  await page.goto('/app/account?scenario=13');
  await expect(page.locator('.account-avatar img')).toHaveAttribute('src', USER_SRC);
});

test('a working agent spins its spiral; idle rows stay still', async ({ page }) => {
  await page.goto('/app/todo/7ve0iOkQ-JBpSL98zSiGc?scenario=26');
  const rows = page.locator('.chat-row--agent');
  await expect(rows.last().getByTestId('msg-avatar').locator('img')).toHaveAttribute(
    'src',
    /%3Cg%20class%3D%22spin%22%3E/,
  );
  await expect(rows.first().getByTestId('msg-avatar').locator('img')).not.toHaveAttribute(
    'src',
    /spin/,
  );
});

test('the unbound chief wears the spiral face instead of the dashed one', async ({ page }) => {
  await page.goto('/app?scenario=114');
  const face = page.getByTestId('chief-stream').getByTestId('chief-msg').locator('> svg');
  await expect(face).toHaveCount(1);
  await expect(face.locator('circle')).toHaveAttribute('fill', 'var(--fab-surface)');
  await expect(face.locator('path')).toHaveAttribute('stroke', 'var(--fab-mark)');
});

test('the chief spiral spins on the reply it is still typing, rests on finished ones', async ({
  page,
}) => {
  await page.goto('/app?scenario=chief-md');
  const spirals = page
    .getByTestId('chief-stream')
    .getByTestId('chief-msg')
    .locator('> svg > g');
  await expect(spirals).toHaveCount(2);
  await expect(spirals.first()).toHaveCSS('animation-name', 'none');
  await expect(spirals.last()).toHaveCSS('animation-name', 'spin');
});

test('every spiral sits on the disc centre, so it turns in place', async ({ page }) => {
  const seeds = ['chief', 'coder-1', 'coder-2', 'reviewer', 'r3-builder', 'Xmon Dai', 'nova'];
  await page.setContent(
    seeds.map((seed) => `<div style="width:100px;height:100px">${spiralAvatarSvg(seed)}</div>`).join(''),
  );
  const centres = await page.locator('svg path').evaluateAll((paths) =>
    paths.map((path) => {
      const spiral = path.getBoundingClientRect();
      const disc = (path.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
      return [
        ((spiral.x + spiral.width / 2 - disc.x) / disc.width) * 100,
        ((spiral.y + spiral.height / 2 - disc.y) / disc.height) * 100,
      ];
    }),
  );
  for (const centre of centres) {
    expect(centre?.[0]).toBeCloseTo(50, 0);
    expect(centre?.[1]).toBeCloseTo(50, 0);
  }
});
