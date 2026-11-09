import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { bootLiveServer, type LiveServer } from './live-server';

let server: LiveServer;

test.beforeAll(async () => {
  server = await bootLiveServer(null);
});

test.afterAll(async () => {
  await server?.dispose();
});

for (const theme of ['light', 'dark']) {
  for (const width of [1440, 390]) {
    test(`account settings without releases at ${width}px in ${theme}`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: 844 });
      await page.addInitScript((value) => localStorage.setItem('cairn-theme', value), theme);
      const flagRequests: string[] = [];
      page.on('request', (request) => {
        if (new URL(request.url()).pathname.startsWith('/api/flags')) flagRequests.push(request.url());
      });
      await page.goto(`${server.base}/app/settings/account`);
      await expect(page.getByRole('combobox', { name: '语言', exact: true })).toBeVisible();
      await expect(page.getByRole('switch', { name: '推送通知', exact: true })).toBeVisible();
      await expect(page.getByRole('heading', { name: '新功能发布', exact: true })).toHaveCount(0);
      await expect(page.getByRole('textbox', { name: '功能标识', exact: true })).toHaveCount(0);
      await expect(page.getByRole('button', { name: '发布新功能', exact: true })).toHaveCount(0);
      await expect(page.getByRole('switch', { name: '人工共同作者署名', exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const output = process.env.VERIFY_EVIDENCE_DIR;
      await page.screenshot({ path: output ? join(output, `account-${theme}-${width}.png`) : info.outputPath('account.png'), fullPage: true });
      await page.reload();
      await expect(page.getByRole('combobox', { name: '语言', exact: true })).toBeVisible();
      expect(flagRequests).toEqual([]);
      expect((await page.request.get(`${server.base}/api/flags`)).status()).toBe(404);
      expect((await page.request.post(`${server.base}/api/flags/beta/release`)).status()).toBe(404);
    });
  }
}
