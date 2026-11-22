import { ENV_VARS } from '@cairn/shared';
import { expect, type Page, test } from '@playwright/test';
import { bootLiveServer, type LiveServer } from './live-server';

async function openPicker(page: Page, server: LiveServer) {
  await page.goto(`${server.base}/app/settings/routing`);
  await page.getByRole('dialog', { name: '设置' }).getByRole('button', { name: '添加服务商' }).click();
  const picker = page.getByRole('dialog', { name: '添加模型服务' });
  await expect(picker.locator('[data-preset-id="anthropic"]')).toBeVisible();
  return picker;
}

test.describe('a fresh install with no GitHub OAuth client', () => {
  let server: LiveServer;
  test.beforeAll(async () => {
    server = await bootLiveServer(null, {
      [ENV_VARS.githubOauthClientId]: '',
      [ENV_VARS.githubOauthClientSecret]: '',
    });
  });
  test.afterAll(async () => {
    await server?.dispose();
  });

  test('the picker hides GitHub Copilot and keeps the Codex device sign-in', async ({ page }) => {
    const picker = await openPicker(page, server);
    await expect(picker.locator('[data-preset-id="github-copilot"]')).toHaveCount(0);
    await expect(picker.locator('[data-preset-id="openai-codex"]')).toBeVisible();
    await expect(picker.locator('[data-preset-id="claude-subscription"]')).toBeVisible();
  });
});

test.describe('a server with a GitHub OAuth client', () => {
  let server: LiveServer;
  test.beforeAll(async () => {
    server = await bootLiveServer(null, {
      [ENV_VARS.githubOauthClientId]: 'e2e-client',
      [ENV_VARS.githubOauthClientSecret]: 'e2e-secret',
    });
  });
  test.afterAll(async () => {
    await server?.dispose();
  });

  test('the picker offers GitHub Copilot alongside the Codex device sign-in', async ({ page }) => {
    const picker = await openPicker(page, server);
    await expect(picker.locator('[data-preset-id="github-copilot"]')).toHaveText(
      'GitHub Copilot 订阅',
    );
    await expect(picker.locator('[data-preset-id="openai-codex"]')).toBeVisible();
  });

  test('every subscription sign-in is named "<plan> 订阅"', async ({ page }) => {
    const picker = await openPicker(page, server);
    const group = picker.getByRole('group', { name: '订阅登录' });
    const labels = await group.locator('[data-preset-id]').allInnerTexts();
    expect(labels.map((label) => label.trim()).sort()).toEqual(
      [
        'Antigravity 订阅',
        'ChatGPT 订阅',
        'Claude 订阅',
        'Devin 订阅',
        'GitHub Copilot 订阅',
      ].sort(),
    );
    for (const label of labels) expect(label.trim()).toMatch(/^\S(.*\S)? 订阅$/);
  });
});
