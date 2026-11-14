import { expect, test } from '@playwright/test';
import { stubNotification } from './helpers.js';

for (const width of [1440, 390]) {
  for (const theme of ['light', 'dark']) {
    test(`retired bot stays absent and Cairn notifications work at ${width}px in ${theme}`, async ({ page }) => {
      const botRequests: string[] = [];
      await page.setViewportSize({ width, height: 900 });
      await page.addInitScript((value) => localStorage.setItem('cairn-theme', value), theme);
      await stubNotification(page, 'granted', 'granted');
      page.on('request', (request) => {
        if (new URL(request.url()).pathname.includes('/feishu')) botRequests.push(request.method());
      });
      await page.route('**/api/**', (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path === '/api/teams') return route.fulfill({ json: [{ id: 'team-1', name: 'Team', plan: 'free', createdAt: 0 }] });
        if (path === '/api/user/me' || path === '/api/auth/session') return route.fulfill({ json: { id: 'user-1', displayName: 'Owner', avatarUrl: null, type: 'user' } });
        if (path.endsWith('/chief')) return route.fulfill({ status: 404, json: { error: 'Coordinator not configured' } });
        return route.fulfill({ json: [] });
      });
      await page.goto('/app/account');
      const notifications = page.getByRole('switch', { name: '推送通知', exact: true });
      await expect(notifications).toBeVisible();
      await expect(page.getByRole('combobox', { name: '语言', exact: true })).toBeVisible();
      await expect(page.getByRole('form', { name: '飞书 Runner 人' })).toHaveCount(0);
      await expect(page.getByText('正在加载飞书配置', { exact: true })).toHaveCount(0);
      expect(botRequests).toEqual([]);
      await notifications.click();
      await expect(notifications).not.toBeChecked();
      await page.reload();
      await expect(notifications).not.toBeChecked();
      expect(botRequests).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    });
  }
}
