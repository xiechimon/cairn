import { expect, test } from '@playwright/test';
import type { FeishuBotBody, FeishuBotStatus } from '@cairn/shared';

test('Feishu settings configure, reload, update and unbind without disclosing the secret', async ({ page }) => {
  let status: FeishuBotStatus = { configured: false, appId: null, openId: null, cairnOrigin: null };
  const saves: FeishuBotBody[] = [];
  let failSave = false;
  let unbindCalls = 0;
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/teams') return route.fulfill({ json: [{ id: 'team-1', name: 'Team', plan: 'free', createdAt: 0 }] });
    if (path === '/api/user/me' || path === '/api/auth/session') return route.fulfill({ json: { id: 'user-1', displayName: 'Owner', avatarUrl: null, type: 'user' } });
    if (path === '/api/teams/team-1/chief') return route.fulfill({ status: 404, json: { error: 'Chief not configured' } });
    if (path === '/api/teams/team-1/feishu') {
      if (route.request().method() === 'PUT') {
        if (failSave) return route.fulfill({ status: 500, json: { error: 'Save unavailable' } });
        const body = route.request().postDataJSON() as FeishuBotBody;
        saves.push(body);
        status = { configured: true, appId: body.appId, openId: body.openId, cairnOrigin: body.cairnOrigin };
      }
      if (route.request().method() === 'DELETE') {
        unbindCalls += 1;
        status = { configured: false, appId: null, openId: null, cairnOrigin: null };
        return route.fulfill({ status: 204 });
      }
      return route.fulfill({ json: status });
    }
    return route.fulfill({ json: [] });
  });
  await page.goto('/app/account');
  await expect(page.getByRole('heading', { name: 'Unexpected Application Error!' })).toHaveCount(0);
  const form = page.getByRole('form', { name: '飞书机器人' });
  await expect(form.getByRole('status')).toHaveText('未配置');
  await form.getByLabel('App ID', { exact: true }).fill('cli_example123');
  await form.getByLabel('App Secret', { exact: true }).fill('test-secret-one');
  await form.getByLabel('接收者 Open ID').fill('ou_owner123');
  await form.getByLabel('Cairn 地址').fill('https://cairn.example.com');
  await form.getByRole('button', { name: '保存配置' }).click();
  await expect(form.getByRole('status')).toHaveText('已配置');
  expect(saves).toEqual([{ appId: 'cli_example123', appSecret: 'test-secret-one', openId: 'ou_owner123', cairnOrigin: 'https://cairn.example.com' }]);
  await expect(form.getByLabel('App Secret', { exact: true })).toHaveValue('');
  await page.reload();
  await expect(form.getByRole('status')).toHaveText('已配置');
  await expect(form.getByLabel('App ID', { exact: true })).toHaveValue('cli_example123');
  await expect(form.getByLabel('App Secret', { exact: true })).toHaveValue('');
  await form.getByLabel('接收者 Open ID').fill('ou_updated');
  await form.getByRole('button', { name: '保存配置' }).click();
  await expect.poll(() => saves.length).toBe(2);
  expect(saves[1]?.appSecret).toBe('');
  await form.getByLabel('App Secret', { exact: true }).fill('test-secret-two');
  await form.getByRole('button', { name: '保存配置' }).click();
  await expect.poll(() => saves.length).toBe(3);
  expect(saves[2]?.appSecret).toBe('test-secret-two');
  await expect(form.getByLabel('App Secret', { exact: true })).toHaveValue('');
  failSave = true;
  await form.getByRole('button', { name: '保存配置' }).click();
  await expect(page.locator('[data-sonner-toast]').first()).toContainText('保存失败，请重试。');
  await expect(form.getByRole('status')).toHaveText('已配置');
  await form.getByRole('button', { name: '解除绑定' }).click();
  const dialog = page.getByRole('alertdialog', { name: '解除飞书绑定确认' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: '取消' }).click();
  await expect(dialog).toHaveCount(0);
  expect(unbindCalls).toBe(0);
  await expect(form.getByRole('status')).toHaveText('已配置');
  await expect(form.getByLabel('App ID', { exact: true })).toHaveValue('cli_example123');
  await form.getByRole('button', { name: '解除绑定' }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: '解除绑定' }).click();
  await expect.poll(() => unbindCalls).toBe(1);
  await expect(form.getByRole('status')).toHaveText('未配置');
  await expect(form.getByLabel('App ID', { exact: true })).toHaveValue('');
  await page.reload();
  await expect(form.getByRole('status')).toHaveText('未配置');
  await expect(form.getByRole('button', { name: '解除绑定' })).toBeDisabled();
});