import type { AntigravitySubscriptionListEntry } from '@cairn/shared';
import { expect, type Page, test } from '@playwright/test';
import { mockLive } from './chief-home-mock';

const API_KEY = 'AIzaSyAntigravityTestKey0123456789';

interface AntigravityCalls {
  loginCalls: number;
  cancelCalls: number;
  resolve: ((outcome: unknown) => void) | null;
}

interface LocalStatus {
  installed: boolean;
  loggedIn: boolean;
  canLogin: boolean;
}

async function openDialog(
  page: Page,
  opts: { status: LocalStatus | null; importOk?: boolean; withSources?: boolean },
) {
  const calls: { created: (string | null)[] } = { created: [] };
  if (opts.status !== null) {
    await page.addInitScript(
      ({ status, importOk, apiKey }) => {
        const w = window as Window & {
          cairnDesktop?: unknown;
          __antigravity?: AntigravityCalls;
        };
        w.__antigravity = { loginCalls: 0, cancelCalls: 0, resolve: null };
        w.cairnDesktop = {
          antigravity: {
            status: async () => status,
            importKey: async () =>
              importOk ? { ok: true, key: apiKey } : { ok: false, reason: 'no-key' },
            login: () => {
              w.__antigravity!.loginCalls += 1;
              return new Promise((resolve) => {
                w.__antigravity!.resolve = resolve;
              });
            },
            cancelLogin: async () => {
              w.__antigravity!.cancelCalls += 1;
              w.__antigravity!.resolve?.({ ok: false, reason: 'cancelled' });
            },
          },
        };
      },
      { status: opts.status, importOk: opts.importOk ?? false, apiKey: API_KEY },
    );
  }
  const subscriptions: AntigravitySubscriptionListEntry[] = [];
  await mockLive(page, { threads: [], messages: [] }, (path, route, json) => {
    if (path === '/api/teams/t1/model-sources') {
      return json({
        sources: opts.withSources
          ? [
              {
                runtime: 'antigravity',
                installed: true,
                hostname: 'macbook',
                machineId: 'm-ready',
                models: [
                  { id: 'gemini-4-carbon', name: 'Gemini 4 Carbon' },
                  { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6' },
                ],
              },
            ]
          : [],
      });
    }
    if (path === '/api/teams/t1/providers') return json({ presets: [], providers: [] });
    if (path === '/api/teams/t1/antigravity-subscriptions') {
      if (route.request().method() === 'POST') {
        const body = route.request().postDataJSON();
        calls.created.push(body.token ?? null);
        const created: AntigravitySubscriptionListEntry = {
          id: 'ag-sub-1',
          kind: 'antigravity-subscription',
          label: body.label,
          hasToken: typeof body.token === 'string' && body.token !== '',
          expiresAt: null,
          enabled: true,
          createdAt: Date.now(),
        };
        subscriptions.push(created);
        return json(created, 201);
      }
      return json(subscriptions);
    }
    if (path === '/api/teams/t1/antigravity-subscriptions/ag-sub-1/verify') {
      return json({ ok: true });
    }
    if (path === '/api/teams/t1/antigravity-subscriptions/ag-sub-1/steps') {
      return json({ steps: [], hasEarlier: false });
    }
  });
  await page.goto('/app/settings/routing');
  await page.getByTestId('routing-add-provider').click();
  await page.locator('[data-preset-id="antigravity-subscription"]').click();
  const dialog = page.getByRole('dialog', { name: '添加 Antigravity 订阅' });
  await expect(dialog).toBeVisible();
  return { dialog, calls };
}

test('logged-in Mac creates a host-keyring subscription with no token and shows models without quota', async ({
  page,
}) => {
  const { dialog, calls } = await openDialog(page, {
    status: { installed: true, loggedIn: true, canLogin: true },
    withSources: true,
  });
  const importButton = dialog.getByTestId('antigravity-local-import');
  await expect(importButton).toBeVisible();
  await expect(dialog).toContainText('这台 Mac 已登录 Antigravity。');
  await importButton.click();
  await expect(dialog).not.toBeVisible();
  expect(calls.created).toEqual([null]);
  const row = page.locator('[data-instance-id="subscription:ag-sub-1"]');
  await expect(row).toContainText('Antigravity 订阅');
  const detail = page.getByTestId('subscription-detail');
  await expect(detail.getByLabel('名称')).toBeVisible();
  await expect(detail).not.toContainText('还没勾选模型，订阅按执行机上报的名单兜底。');
  await expect(detail.getByTestId('subscription-pick-upstream')).toBeVisible();
  await expect(row).toContainText('2 个模型');
  await expect(detail).not.toContainText('额度');
});

test('logged-out Mac runs browser login and continues automatically', async ({ page }) => {
  const { dialog, calls } = await openDialog(page, {
    status: { installed: true, loggedIn: false, canLogin: true },
  });
  await dialog.getByTestId('antigravity-local-login').click();
  await expect(dialog).toContainText('已在浏览器中打开 Antigravity 登录页');
  await page.evaluate(() => {
    const w = window as Window & { __antigravity?: AntigravityCalls };
    w.__antigravity?.resolve?.({ ok: true });
  });
  await expect(dialog).not.toBeVisible();
  expect(calls.created).toEqual([null]);
});

test('cancelling browser login returns to the login button without creating anything', async ({
  page,
}) => {
  const { dialog, calls } = await openDialog(page, {
    status: { installed: true, loggedIn: false, canLogin: true },
  });
  await dialog.getByTestId('antigravity-local-login').click();
  await expect(dialog).toContainText('已在浏览器中打开 Antigravity 登录页');
  await dialog.getByTestId('antigravity-local-login-cancel').click();
  await expect(dialog.getByTestId('antigravity-local-login')).toBeVisible();
  expect(calls.created).toEqual([]);
  const cancelled = await page.evaluate(() => {
    const w = window as Window & { __antigravity?: AntigravityCalls };
    return w.__antigravity?.cancelCalls ?? 0;
  });
  expect(cancelled).toBe(1);
});

test('timed-out login falls back to pasting GEMINI_API_KEY', async ({ page }) => {
  const { dialog, calls } = await openDialog(page, {
    status: { installed: true, loggedIn: false, canLogin: true },
  });
  await dialog.getByTestId('antigravity-local-login').click();
  await page.evaluate(() => {
    const w = window as Window & { __antigravity?: AntigravityCalls };
    w.__antigravity?.resolve?.({ ok: false, reason: 'timeout' });
  });
  await expect(dialog).toContainText('等待 Antigravity 登录超时');
  await dialog.getByTestId('antigravity-paste-toggle').click();
  await dialog.getByTestId('antigravity-subscription-token').fill(`GEMINI_API_KEY="${API_KEY}"`);
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(calls.created).toEqual([API_KEY]);
  await expect(page.locator('body')).not.toContainText(API_KEY);
});

test('web-only mode saves host-keyring subscription directly with null token', async ({
  page,
}) => {
  const { dialog, calls } = await openDialog(page, { status: null });
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(calls.created).toEqual([null]);
});
