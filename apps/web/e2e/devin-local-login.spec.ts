import { expect, type Page, test } from '@playwright/test';
import type { DevinSubscriptionListEntry } from '@cairn/shared';
import { mockLive } from './chief-home-mock';

const KEY = 'wsk-local-import-0123456789abcdef';

interface DevinCalls {
  status: { loggedIn: boolean; canLogin: boolean };
  loginCalls: number;
  cancelCalls: number;
  resolve: ((outcome: unknown) => void) | null;
}

async function openDialog(page: Page, status: { loggedIn: boolean; canLogin: boolean }) {
  const calls: { created: string[] } = { created: [] };
  await page.addInitScript(
    ({ key, devinStatus }) => {
      const w = window as Window & {
        cairnDesktop?: unknown;
        __devin?: {
          loginCalls: number;
          cancelCalls: number;
          resolve: ((outcome: unknown) => void) | null;
        };
      };
      w.__devin = { loginCalls: 0, cancelCalls: 0, resolve: null };
      w.cairnDesktop = {
        devin: {
          status: async () => devinStatus,
          importKey: async () => ({ ok: true, key }),
          login: () => {
            w.__devin!.loginCalls += 1;
            return new Promise((resolve) => {
              w.__devin!.resolve = resolve;
            });
          },
          cancelLogin: async () => {
            w.__devin!.cancelCalls += 1;
            w.__devin!.resolve?.({ ok: false, reason: 'cancelled' });
          },
        },
      };
    },
    { key: KEY, devinStatus: status },
  );
  const subscriptions: DevinSubscriptionListEntry[] = [];
  await mockLive(page, { threads: [], messages: [] }, (path, route, json) => {
    if (path === '/api/teams/t1/model-sources') return json({ sources: [] });
    if (path === '/api/teams/t1/providers') return json({ presets: [], providers: [] });
    if (path === '/api/teams/t1/devin-subscriptions') {
      if (route.request().method() === 'POST') {
        const body = route.request().postDataJSON();
        calls.created.push(body.token);
        const created: DevinSubscriptionListEntry = {
          id: 'devin-sub-1',
          kind: 'devin-subscription',
          label: body.label,
          expiresAt: body.expiresAt,
          createdAt: Date.now(),
        };
        subscriptions.push(created);
        return json(created, 201);
      }
      return json(subscriptions);
    }
  });
  await page.goto('/app/settings/routing');
  await page.getByTestId('routing-add-provider').click();
  await page.locator('[data-preset-id="devin-subscription"]').click();
  const dialog = page.getByRole('dialog', { name: '添加 Devin 订阅' });
  await expect(dialog).toBeVisible();
  return { dialog, calls };
}

test('logged-in Mac offers one-click import that creates the subscription', async ({ page }) => {
  const { dialog, calls } = await openDialog(page, { loggedIn: true, canLogin: true });
  const importButton = dialog.getByTestId('devin-local-import');
  await expect(importButton).toBeVisible();
  await expect(dialog).toContainText('这台 Mac 已登录 Devin。');
  await importButton.click();
  await expect(dialog).not.toBeVisible();
  expect(calls.created).toEqual([KEY]);
  await expect(page.locator('[data-instance-id="subscription:devin-sub-1"]')).toContainText(
    'Devin 订阅',
  );
  await expect(page.locator('body')).not.toContainText(KEY);
});

test('a Mac with devin but no login runs the browser login and continues on its own', async ({
  page,
}) => {
  const { dialog, calls } = await openDialog(page, { loggedIn: false, canLogin: true });
  const loginButton = dialog.getByTestId('devin-local-login');
  await expect(loginButton).toBeVisible();
  await loginButton.click();
  await expect(dialog).toContainText('已在浏览器中打开 Devin 登录页');
  await page.evaluate(() => {
    const w = window as Window & { __devin?: DevinCalls };
    w.__devin?.resolve?.({ ok: true, key: 'wsk-browser-login-99887766' });
  });
  await expect(dialog).not.toBeVisible();
  expect(calls.created).toEqual(['wsk-browser-login-99887766']);
});

test('cancelling the browser login returns to the button and creates nothing', async ({ page }) => {
  const { dialog, calls } = await openDialog(page, { loggedIn: false, canLogin: true });
  await dialog.getByTestId('devin-local-login').click();
  await expect(dialog).toContainText('已在浏览器中打开 Devin 登录页');
  await dialog.getByTestId('devin-local-login-cancel').click();
  await expect(dialog.getByTestId('devin-local-login')).toBeVisible();
  expect(calls.created).toEqual([]);
  const cancelled = await page.evaluate(() => {
    const w = window as Window & { __devin?: DevinCalls };
    return w.__devin?.cancelCalls ?? 0;
  });
  expect(cancelled).toBe(1);
});

test('a failed login shows a mapped reason and the paste path still works', async ({ page }) => {
  const { dialog, calls } = await openDialog(page, { loggedIn: false, canLogin: true });
  await dialog.getByTestId('devin-local-login').click();
  await page.evaluate(() => {
    const w = window as Window & { __devin?: DevinCalls };
    w.__devin?.resolve?.({ ok: false, reason: 'timeout' });
  });
  await expect(dialog).toContainText('等待 Devin 登录超时');
  await expect(dialog.getByTestId('devin-local-login')).toBeVisible();
  await dialog.getByTestId('devin-paste-toggle').click();
  await dialog.getByTestId('devin-subscription-token').fill(`windsurf_api_key = "${KEY}"`);
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(calls.created).toEqual([KEY]);
});
