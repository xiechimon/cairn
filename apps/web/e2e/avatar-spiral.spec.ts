import { expect, test } from '@playwright/test';
import { spiralAvatarSvg, spiralAvatarUrl } from '../src/lib/spiral-avatar.js';
import { pressAndExpect } from './helpers.js';

const USER_SRC = spiralAvatarUrl('Xmon Dai');

test('no avatar surface reaches a third-party avatar host', async ({ page }) => {
  const hits: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('api.dicebear.com')) hits.push(request.url());
  });
  await page.goto('/app/account?scenario=01');
  await expect(page.locator('.account-avatar img')).toBeVisible();
  await page.goto('/app/todo/7ve0iOkQ-JBpSL98zSiGc?scenario=36');
  await expect(page.locator('.chat-row--agent').first()).toBeVisible();
  expect(hits).toEqual([]);
});

test('search drops agent rows; project task rows stay seeded', async ({ page }) => {
  await page.goto('/app?scenario=01');
  await expect(page.locator('[data-slot="sidebar-nav-row"]').first()).toBeVisible();
  const searchPanel = page.getByRole('dialog', { name: '搜索' });
  await pressAndExpect(page, 'Meta+k', searchPanel);
  await page.keyboard.type('r3-builder');
  await expect(searchPanel.locator('[data-row-kind="agent"]')).toHaveCount(0);

  await page.goto('/app/project/ZAQczKCu0MOAzC1ZqcFlX/tasks?scenario=prj-tasks');
  await expect(page.locator('.prj-task-avatar img').first()).toHaveAttribute('src', USER_SRC);
});

test('conversation transcript: replies carry no avatar column, user rows are flat sand bubbles', async ({
  page,
}) => {
  await page.goto('/app/todo/7ve0iOkQ-JBpSL98zSiGc?scenario=36');
  await expect(page.locator('.chat-row--agent').first()).toBeVisible();
  await expect(page.locator('.chat-row--user').first()).toBeVisible();
  await expect(page.locator('.chat-avatar')).toHaveCount(0);
  await expect(page.getByTestId('msg-avatar')).toHaveCount(0);
  await expect(page.getByTestId('user-bubble').first()).toHaveCSS('border-top-left-radius', '18px');
});

test('account head shares the seeded user src (same identity as the sidebar chip)', async ({
  page,
}) => {
  await page.goto('/app/account?scenario=13');
  await expect(page.locator('.account-avatar img')).toHaveAttribute('src', USER_SRC);
});

test('a working agent shows typing dots under the last line; finished rows stay still', async ({
  page,
}) => {
  await page.goto('/app/todo/7ve0iOkQ-JBpSL98zSiGc?scenario=26');
  const live = page.locator('.side-panel').getByTestId('live-row');
  await expect(live).toHaveCount(1);
  await expect(live.getByTestId('typing-dot')).toHaveCount(3);
  await expect(live.getByTestId('typing-dot').first()).toHaveCSS('animation-name', 'typing-hop');
  await expect(page.locator('.chat-row--agent').first().getByTestId('typing-dot')).toHaveCount(0);
});

test('the unbound chief reply carries no face and no avatar column', async ({ page }) => {
  await page.goto('/app?scenario=114');
  const reply = page.getByTestId('chief-stream').getByTestId('chief-msg');
  await expect(reply.first()).toBeVisible();
  await expect(reply.locator('> svg')).toHaveCount(0);
  await expect(reply.locator('> img, > span > img')).toHaveCount(0);
});

test('the Coordinator shows three typing dots under the reply it is still typing, finished ones carry none', async ({
  page,
}) => {
  await page.goto('/app?scenario=chief-md');
  const replies = page.getByTestId('chief-stream').getByTestId('chief-msg');
  await expect(replies.last().getByTestId('typing-dot')).toHaveCount(3);
  await expect(replies.last().getByTestId('typing-dot').first()).toHaveCSS('animation-name', 'typing-hop');
  await expect(replies.first().getByTestId('typing-dots')).toHaveCount(0);
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

test('typing dots stand still when the user prefers reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/app?scenario=chief-md');
  const dot = page.getByTestId('typing-dot').first();
  await expect(dot).toBeVisible();
  await expect(dot).toHaveCSS('animation-name', 'none');
});
