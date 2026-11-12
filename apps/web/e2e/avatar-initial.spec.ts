import { expect, test } from '@playwright/test';
import { avatarTint } from '../src/lib/avatar-tint.js';
import { pressAndExpect } from './helpers.js';

const USER_NAME = 'Xmon Dai';
const INITIAL = '[data-slot="avatar-initial"]';

test('no avatar surface reaches a third-party avatar host', async ({ page }) => {
  const hits: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('api.dicebear.com')) hits.push(request.url());
  });
  await page.goto('/app/account?scenario=01');
  await expect(page.locator('.account-avatar').locator(INITIAL)).toBeVisible();
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
  const rowAvatar = page.locator('.prj-task-avatar').locator(INITIAL).first();
  await expect(rowAvatar).toHaveText('X');
  await expect(rowAvatar).toHaveAttribute('style', new RegExp(avatarTint(USER_NAME)));
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

test('account head shows the initial on the same tint as the task rows', async ({ page }) => {
  await page.goto('/app/account?scenario=13');
  const head = page.locator('.account-avatar').locator(INITIAL);
  await expect(head).toHaveText('X');
  await expect(head).toHaveAttribute('style', new RegExp(avatarTint(USER_NAME)));
  await expect(head).toHaveCSS('font-size', '24px');
  await expect(page.locator('.account-avatar img')).toHaveCount(0);
});

for (const theme of ['light', 'dark'] as const) {
  test(`the tint is a pale wash of the person's colour in ${theme}`, async ({ page }) => {
    await page.addInitScript((value) => localStorage.setItem('cairn-theme', value), theme);
    await page.goto('/app/account?scenario=13');
    const head = page.locator('.account-avatar').locator(INITIAL);
    await expect(head).toBeVisible();
    const alpha = await head.evaluate((node) => {
      const parts = getComputedStyle(node).backgroundColor.match(/[\d.]+/g) ?? [];
      return Number(parts.at(-1));
    });
    expect(alpha).toBeCloseTo(theme === 'light' ? 0.15 : 0.26, 2);
  });
}

test('the 12px avatar is a colour dot with no letter', async ({ page }) => {
  await page.goto('/design.html?only=seeded-avatar');
  const dot = page.locator('[data-gallery-only]').locator(INITIAL).first();
  await expect(dot).toBeVisible();
  await expect(dot).toHaveCSS('font-size', '0px');
  expect((await dot.boundingBox())?.width).toBe(12);
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

test('typing dots stand still when the user prefers reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/app?scenario=chief-md');
  const dot = page.getByTestId('typing-dot').first();
  await expect(dot).toBeVisible();
  await expect(dot).toHaveCSS('animation-name', 'none');
});
