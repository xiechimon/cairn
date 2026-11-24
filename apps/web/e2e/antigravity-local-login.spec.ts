import type { AntigravityLoginOutcome, AntigravitySubscriptionListEntry, DesktopSubscriptionInput } from '@cairn/shared';
import { expect, type Page, test } from '@playwright/test';
import { mockLive, PROJECT, TASK, THREAD } from './chief-home-mock';

const API_KEY = 'AIzaSyAntigravityTestKey0123456789';
const OAUTH_EXPIRES_AT = Date.now() + 3_600_000;

interface AntigravityCalls {
  loginCalls: number;
  cancelCalls: number;
  resolve: ((outcome: unknown) => void) | null;
  progress: ((phase: string) => void) | null;
}

interface LocalStatus {
  installed: boolean;
  loggedIn: boolean;
  canLogin: boolean;
}

async function installBridge(
  page: Page,
  opts: { status: LocalStatus; importOk?: boolean },
  save: (input: DesktopSubscriptionInput, subscriptionId?: string) => AntigravityLoginOutcome,
) {
  await page.exposeFunction('saveAntigravityOnDesktop', save);
  await page.addInitScript(
    ({ status, importOk }) => {
      const w = window as Window & {
        cairnDesktop?: unknown;
        __antigravity?: AntigravityCalls;
        saveAntigravityOnDesktop: (input: DesktopSubscriptionInput, subscriptionId?: string) => Promise<AntigravityLoginOutcome>;
      };
      w.__antigravity = { loginCalls: 0, cancelCalls: 0, resolve: null, progress: null };
      w.cairnDesktop = {
        antigravity: {
          status: async () => status,
          import: async (input: DesktopSubscriptionInput) =>
            importOk
              ? w.saveAntigravityOnDesktop(input)
              : { ok: false, reason: 'no-key' },
          login: (input: DesktopSubscriptionInput, subscriptionId?: string) => {
            w.__antigravity!.loginCalls += 1;
            return new Promise((resolve) => {
              w.__antigravity!.resolve = (outcome) => {
                if ((outcome as { ok?: boolean }).ok === true) {
                  void w.saveAntigravityOnDesktop(input, subscriptionId).then(resolve);
                } else {
                  resolve(outcome);
                }
              };
            });
          },
          cancelLogin: async () => {
            w.__antigravity!.cancelCalls += 1;
            w.__antigravity!.resolve?.({ ok: false, reason: 'cancelled' });
          },
          onLoginProgress: (listener: (phase: string) => void) => {
            w.__antigravity!.progress = listener;
            return () => {
              w.__antigravity!.progress = null;
            };
          },
        },
      };
    },
    {
      status: opts.status,
      importOk: opts.importOk ?? true,
    },
  );
}

async function openDialog(
  page: Page,
  opts: { status: LocalStatus | null; importOk?: boolean; withSources?: boolean },
) {
  const calls = { created: [] as (string | null)[], desktopLabels: [] as string[], verified: [] as string[] };
  const subscriptions: AntigravitySubscriptionListEntry[] = [];
  if (opts.status !== null) {
    await installBridge(page, { status: opts.status, importOk: opts.importOk }, ({ teamId, label }, subscriptionId) => {
      expect(teamId).toBe('t1');
      expect(subscriptionId).toBeUndefined();
      calls.desktopLabels.push(label);
      const id = `ag-sub-${subscriptions.length + 1}`;
      subscriptions.push({
        id, kind: 'antigravity-subscription', label, hasToken: true,
        expiresAt: OAUTH_EXPIRES_AT, enabled: subscriptions.length === 0, createdAt: Date.now(),
      });
      return { ok: true, subscription: { id, label } };
    });
  }
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
          expiresAt: body.expiresAt ?? null,
          enabled: true,
          createdAt: Date.now(),
        };
        subscriptions.push(created);
        return json(created, 201);
      }
      return json(subscriptions);
    }
    const catalog = /\/antigravity-subscriptions\/(ag-sub-\d+)\/upstream-models$/.exec(path);
    if (catalog !== null) {
      const isFirst = catalog[1] === 'ag-sub-1';
      return json({ status: 'ok', models: [
        isFirst ? { id: 'gemini-personal', name: 'Gemini Personal' } : { id: 'claude-work', name: 'Claude Work' },
      ] });
    }
    const verify = /\/antigravity-subscriptions\/(ag-sub-\d+)\/verify$/.exec(path);
    if (verify !== null) {
      const id = verify[1]!;
      expect(route.request().method()).toBe('POST');
      expect(subscriptions.some((subscription) => subscription.id === id)).toBe(true);
      calls.verified.push(id);
      return json({ ok: true });
    }
    if (/\/antigravity-subscriptions\/ag-sub-\d+\/steps$/.test(path)) return json({ steps: [], hasEarlier: false });
  });
  await page.goto('/app/settings/routing');
  await page.getByTestId('routing-add-provider').click();
  await page.locator('[data-preset-id="antigravity-subscription"]').click();
  const dialog = page.getByRole('dialog', { name: '添加 Antigravity 订阅' });
  await expect(dialog).toBeVisible();
  return { dialog, calls, subscriptions };
}

test('logged-in Mac imports through the privileged bridge without posting a credential or showing Runner models', async ({
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
  expect(calls.desktopLabels).toEqual(['Antigravity 订阅']);
  expect(calls.created).toEqual([]);
  const row = page.locator('[data-instance-id="subscription:ag-sub-1"]');
  await expect(row).toContainText('Antigravity 订阅');
  const detail = page.getByTestId('subscription-detail');
  await expect(detail.getByTestId('provider-rename')).toHaveText('Antigravity 订阅');
  await expect(detail).toContainText('尚未勾选模型');
  await expect(detail.getByTestId('subscription-pick-upstream')).toBeVisible();
  await expect(detail.getByTestId('subscription-model')).toHaveCount(0);
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
  expect(calls.desktopLabels).toEqual(['Antigravity 订阅']);
  expect(calls.created).toEqual([]);
});

test('a second browser sign-in opens its own upstream choices while the first account stays active', async ({ page }) => {
  const { dialog, calls, subscriptions } = await openDialog(page, {
    status: { installed: true, loggedIn: false, canLogin: true },
  });
  for (const label of ['Personal', 'Work']) {
    await dialog.getByTestId('antigravity-subscription-label').fill(label);
    await dialog.getByTestId('antigravity-local-login').click();
    await expect(dialog).toContainText('已在浏览器中打开 Antigravity 登录页');
    await page.evaluate(() => {
      const w = window as Window & { __antigravity?: AntigravityCalls };
      w.__antigravity?.resolve?.({ ok: true });
    });
    await expect(dialog).not.toBeVisible();
    if (label === 'Personal') {
      await page.getByTestId('routing-add-provider').click();
      await page.locator('[data-preset-id="antigravity-subscription"]').click();
    }
  }
  expect(calls.desktopLabels).toEqual(['Personal', 'Work']);
  expect(calls.created).toEqual([]);
  expect(subscriptions.map(({ label, enabled }) => ({ label, enabled }))).toEqual([
    { label: 'Personal', enabled: true }, { label: 'Work', enabled: false },
  ]);
  const detail = page.getByTestId('subscription-detail');
  await expect(detail.getByTestId('provider-rename')).toHaveText('Work');
  await detail.getByTestId('subscription-pick-upstream').click();
  const picker = page.getByRole('dialog', { name: '从上游选择模型' });
  await expect(picker.getByTestId('upstream-model')).toHaveCount(1);
  await expect(picker.getByTestId('upstream-model')).toContainText('Claude Work');
  await expect(picker).not.toContainText('Gemini Personal');
});

test('a missing local credential offers sign-in without creating an unattributed host row', async ({ page }) => {
  const { dialog, calls } = await openDialog(page, {
    status: { installed: true, loggedIn: true, canLogin: true },
    importOk: false,
  });
  await dialog.getByTestId('antigravity-local-import').click();
  await expect(dialog).toContainText('未能导入登录凭据');
  await expect(dialog.getByTestId('antigravity-local-login')).toBeVisible();
  expect(calls.created).toEqual([]);
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

test('missing agy installs first, then opens the browser login and verifies green', async ({
  page,
}) => {
  const { dialog, calls } = await openDialog(page, {
    status: { installed: false, loggedIn: false, canLogin: true },
  });
  const loginButton = dialog.getByTestId('antigravity-local-login');
  await expect(loginButton).toHaveText('安装并登录 Antigravity');
  await loginButton.click();
  await page.evaluate(() => {
    const w = window as Window & { __antigravity?: AntigravityCalls };
    w.__antigravity?.progress?.('installing');
  });
  await expect(dialog).toContainText('正在下载安装 Antigravity');
  await page.evaluate(() => {
    const w = window as Window & { __antigravity?: AntigravityCalls };
    w.__antigravity?.progress?.('authenticating');
  });
  await expect(dialog).toContainText('已在浏览器中打开 Antigravity 登录页');
  await page.evaluate(() => {
    const w = window as Window & { __antigravity?: AntigravityCalls };
    w.__antigravity?.resolve?.({ ok: true });
  });
  await expect(dialog).not.toBeVisible();
  expect(calls.desktopLabels).toEqual(['Antigravity 订阅']);
  expect(calls.created).toEqual([]);
  await expect(page.getByTestId('subscription-detail')).toHaveAttribute('data-account-id', 'ag-sub-1');
  const feedback = page.getByTestId('subscription-verify-feedback');
  await expect(feedback).toContainText('Antigravity 接受了这个凭据');
  await expect(feedback).toHaveAttribute('data-phase', 'passed');
  expect(calls.verified).toEqual(['ag-sub-1']);
});

test('a failed install says why in plain words and offers a retry', async ({ page }) => {
  const { dialog } = await openDialog(page, {
    status: { installed: false, loggedIn: false, canLogin: true },
  });
  await dialog.getByTestId('antigravity-local-login').click();
  await page.evaluate(() => {
    const w = window as Window & { __antigravity?: AntigravityCalls };
    w.__antigravity?.resolve?.({ ok: false, reason: 'no-binary' });
  });
  await expect(dialog).toContainText('Antigravity 未能安装');
  await expect(dialog.getByTestId('antigravity-local-login')).toBeVisible();
});

test('a host-keyring subscription detail offers re-login and verifies green after it', async ({
  page,
}) => {
  test.setTimeout(60_000);
  let attached = false;
  await installBridge(page, {
    status: { installed: true, loggedIn: false, canLogin: true },
  }, ({ teamId, label }, subscriptionId) => {
    expect(teamId).toBe('t1');
    expect(subscriptionId).toBe('ag-sub-1');
    attached = true;
    return { ok: true, subscription: { id: subscriptionId, label } };
  });
  let verifyCalls = 0;
  await mockLive(page, { threads: [], messages: [] }, (path, route, json) => {
    if (path === '/api/teams/t1/antigravity-subscriptions') {
      return json([
        {
          id: 'ag-sub-1',
          kind: 'antigravity-subscription',
          label: 'Antigravity 订阅',
          hasToken: attached,
          expiresAt: attached ? OAUTH_EXPIRES_AT : null,
          enabled: true,
          createdAt: 1,
        },
      ]);
    }
    if (path === '/api/teams/t1/antigravity-subscriptions/ag-sub-1/verify') {
      verifyCalls += 1;
      return json(attached ? { ok: true } : { ok: false, reason: 'missing_local_login' });
    }
    if (path === '/api/teams/t1/antigravity-subscriptions/ag-sub-1/steps') {
      return json({ steps: [], hasEarlier: false });
    }
    return undefined;
  });
  await page.goto('/app/settings/routing');
  await page.locator('[data-instance-id="subscription:ag-sub-1"]').click();
  const detail = page.getByTestId('subscription-detail');
  const relogin = detail.getByTestId('antigravity-relogin');
  await expect(relogin).toBeVisible();
  await detail.getByTestId('antigravity-detail-login').click();
  await page.evaluate(() => {
    const w = window as Window & { __antigravity?: AntigravityCalls };
    w.__antigravity?.resolve?.({ ok: true });
  });
  await expect(relogin).not.toBeVisible();
  await expect(page.getByTestId('subscription-verify-feedback')).toContainText(
    'Antigravity 接受了这个凭据',
    { timeout: 30_000 },
  );
  expect(attached).toBe(true);
  expect(verifyCalls).toBe(1);
});

test('a signed-out runner brings the login banner back on the board', async ({ page }) => {
  await mockLive(
    page,
    {
      threads: [THREAD],
      messages: [],
      todos: [TASK],
      projects: [PROJECT],
      machines: [
        {
          id: 'm-ready',
          name: 'omarchy',
          teamId: 't1',
          online: true,
          kind: 'local',
          latestCliVersion: null,
          enabledRuntimes: ['antigravity'],
          capabilities: { antigravity: { installed: true, authenticated: false } },
        },
      ],
    },
    (path, _route, json) =>
      path === '/api/teams/t1/antigravity-subscriptions'
        ? json([
            {
              id: 'ag-sub-1',
              kind: 'antigravity-subscription',
              label: 'Antigravity 订阅',
              hasToken: false,
              expiresAt: null,
              enabled: true,
              createdAt: 1,
            },
          ])
        : undefined,
  );
  await page.goto('/app');
  const banner = page.getByTestId('antigravity-login-banner');
  await expect(banner).toBeVisible();
  await expect(banner.getByTestId('antigravity-login-warning')).toHaveAttribute(
    'data-login',
    'signed-out',
  );
  await expect(banner).toContainText('没有可用的 Antigravity 登录');
});
