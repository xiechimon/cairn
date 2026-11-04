import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expect, test, type TestInfo } from '@playwright/test';
import { bootLiveServer, type LiveServer } from './live-server';

let server: LiveServer;
let db: DatabaseSync;

test.beforeAll(async () => {
  server = await bootLiveServer(null);
  db = new DatabaseSync(join(server.home, 'server', 'server.db'));
});

test.afterAll(async () => {
  db?.close();
  await server?.dispose();
});

test.beforeEach(() => {
  db.prepare('DELETE FROM feature_flag').run();
});

function registerFlag(key: string) {
  db.prepare(
    'INSERT INTO feature_flag (id, key, userId, enabled, updatedAt) SELECT ?, ?, id, 1, 1 FROM user ORDER BY rowid LIMIT 1',
  ).run(key, key);
}

function evidencePath(info: TestInfo, name: string) {
  return process.env.VERIFY_EVIDENCE_DIR
    ? join(process.env.VERIFY_EVIDENCE_DIR, name)
    : info.outputPath(name);
}

test('the owner releases a flag from account settings and the release survives reload', async ({ page }, testInfo) => {
  registerFlag('feature-beta');
  await page.goto(`${server.base}/app/settings/account`);
  const toggle = page.getByRole('switch', { name: '向所有成员发布 feature-beta', exact: true });
  await expect(toggle).not.toBeChecked();
  await page.screenshot({ path: evidencePath(testInfo, 'before.png'), fullPage: true });

  await toggle.click();

  await expect(toggle).toBeChecked();
  await expect(toggle).toBeDisabled();
  expect(db.prepare('SELECT userId, enabled FROM feature_flag WHERE key = ?').all('feature-beta'))
    .toEqual([{ userId: null, enabled: 1 }]);
  await page.reload();
  await expect(toggle).toBeChecked();
  await expect(toggle).toBeDisabled();
  await page.screenshot({ path: evidencePath(testInfo, 'after.png'), fullPage: true });
  await page.locator('.account-card').screenshot({ path: evidencePath(testInfo, 'unchanged.png') });
});

test('a failed release stays off and can be retried against the real server', async ({ page }) => {
  registerFlag('retry-feature');
  let fail = true;
  await page.route('**/api/flags/retry-feature/release', async (route) => {
    if (!fail) return route.continue();
    fail = false;
    return route.fulfill({ status: 500, json: { error: 'fixture failure' } });
  });
  await page.goto(`${server.base}/app/settings/account`);
  const toggle = page.getByRole('switch', { name: '向所有成员发布 retry-feature', exact: true });

  await toggle.click();

  await expect(page.getByText('发布失败，请重试。', { exact: true })).toBeVisible();
  await expect(toggle).not.toBeChecked();
  await expect(toggle).toBeEnabled();
  expect(db.prepare('SELECT userId FROM feature_flag WHERE key = ?').get('retry-feature')?.userId)
    .not.toBeNull();
  await toggle.click();
  await expect(toggle).toBeChecked();
  await expect(toggle).toBeDisabled();
});

test('an empty account release section and a long key fit a phone viewport', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${server.base}/app/settings/account`);
  await expect(page.getByText('还没有登记的新功能', { exact: true })).toBeVisible();
  const key = `feature-${'x'.repeat(56)}`;
  registerFlag(key);
  await page.reload();
  const toggle = page.getByRole('switch', { name: `向所有成员发布 ${key}`, exact: true });

  await expect(toggle).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true);
  const bounds = await toggle.boundingBox();
  expect(bounds).not.toBeNull();
  expect((bounds?.x ?? 0) + (bounds?.width ?? 0)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: evidencePath(testInfo, 'phone.png'), fullPage: true });
});

test('the owner can release a valid key before any per-user row exists', async ({ page }) => {
  await page.goto(`${server.base}/app/settings/account`);
  const keyInput = page.getByRole('textbox', { name: '功能标识', exact: true });
  await expect(keyInput).toBeVisible();
  await keyInput.fill('fresh-feature');

  await page.getByRole('button', { name: '发布新功能', exact: true }).click();

  const toggle = page.getByRole('switch', { name: '向所有成员发布 fresh-feature', exact: true });
  await expect(toggle).toBeChecked();
  await expect(toggle).toBeDisabled();
  expect(db.prepare('SELECT userId, enabled FROM feature_flag WHERE key = ?').all('fresh-feature'))
    .toEqual([{ userId: null, enabled: 1 }]);
  await expect(keyInput).toHaveValue('');
  await page.reload();
  await expect(toggle).toBeChecked();
});
