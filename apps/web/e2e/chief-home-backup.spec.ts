import { expect, test } from '@playwright/test';
import { HISTORY, mockLive, THREAD } from './chief-home-mock';

const HOUR = 60 * 60 * 1000;
const YESTERDAY_BASE = new Date().setHours(0, 0, 0, 0) - 10 * HOUR;
const MESSAGES = HISTORY.map((row, i) => ({ ...row, createdAt: YESTERDAY_BASE + i * 60_000 }));

test('home warns when the server backup went stale', async ({ page }) => {
  const lastSuccessAt = Date.now() - 5 * HOUR - 60_000;
  await mockLive(page, {
    threads: [THREAD],
    messages: MESSAGES,
    backup: {
      state: 'recorded',
      status: {
        host: 'omarchy',
        lastRunAt: lastSuccessAt,
        lastRunResult: 'success',
        lastRunExitStatus: '0',
        lastSuccessAt,
      },
    },
  });
  await page.goto('/app');
  const warning = page.getByTestId('backup-warning');
  await expect(warning).toHaveAttribute('data-backup', 'stale');
  await expect(warning).toContainText(
    '自动备份已有 5 小时未完成，请打开设置检查并重试。',
  );
});

test('home warns when the latest server backup run failed, even before any chat', async ({ page }) => {
  await mockLive(page, {
    threads: [THREAD],
    messages: [],
    backup: {
      state: 'recorded',
      status: {
        host: 'omarchy',
        lastRunAt: Date.now() - 60_000,
        lastRunResult: 'exit-code',
        lastRunExitStatus: '255',
        lastSuccessAt: Date.now() - HOUR - 60_000,
      },
    },
  });
  await page.goto('/app');
  const warning = page.getByTestId('backup-warning');
  await expect(warning).toHaveAttribute('data-backup', 'failing');
  await expect(warning).toContainText(
    '最近一次自动备份失败（exit-code 255），上次成功备份在 1 小时前。请打开设置查看或重试。',
  );
});

test('home stays quiet for a fresh backup and for a server without one', async ({ page }) => {
  const now = Date.now();
  await mockLive(page, {
    threads: [THREAD],
    messages: MESSAGES,
    backup: {
      state: 'recorded',
      status: {
        host: 'omarchy',
        lastRunAt: now - 10 * 60_000,
        lastRunResult: 'success',
        lastRunExitStatus: '0',
        lastSuccessAt: now - 10 * 60_000,
      },
    },
  });
  const fresh = page.waitForResponse('**/api/server/backup');
  await page.goto('/app');
  await fresh;
  await expect(page.getByTestId('home-c').getByTestId('chief-stream')).toContainText('已经补给它了');
  await expect(page.getByTestId('backup-warning')).toHaveCount(0);

  await mockLive(page, { threads: [THREAD], messages: MESSAGES, backup: { state: 'none' } });
  const none = page.waitForResponse('**/api/server/backup');
  await page.goto('/app');
  await none;
  await expect(page.getByTestId('home-c').getByTestId('chief-stream')).toContainText('已经补给它了');
  await expect(page.getByTestId('backup-warning')).toHaveCount(0);
});
