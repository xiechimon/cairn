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
  runnerId?: string;
}

async function installBridge(
  page: Page,
  opts: { status: LocalStatus; importOk?: boolean },
  save: (input: DesktopSubscriptionInput, subscriptionId?: string) => AntigravityLoginOutcome = (
    input,
    subscriptionId,
  ) => ({
    ok: true,
    subscription: { id: subscriptionId ?? 'ag-sub-1', label: input.label },
    ...(opts.status.runnerId === undefined ? {} : { runnerId: opts.status.runnerId }),
  }),
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
          signIn: () => {
            w.__antigravity!.loginCalls += 1;
            return new Promise((resolve) => {
              w.__antigravity!.resolve = (outcome) => {
                resolve(
                  (outcome as { ok?: boolean }).ok === true
                    ? {
                        ok: true,
                        credential: {
                          kind: 'oauth-personal',
                          token: `ya29.${'s'.repeat(64)}`,
                          expiresAt: Date.now() + 3_600_000,
                        },
                      }
                    : outcome,
                );
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
  const calls = {
    created: [] as { token: string | null; runnerId?: string }[],
    desktopLabels: [] as string[],
    verified: [] as string[],
  };
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
        if (typeof body.token === 'string' && body.token.startsWith('ya29.')) {
          expect(body.label).toEqual(expect.any(String));
          calls.desktopLabels.push(body.label);
          const id = `ag-sub-${subscriptions.length + 1}`;
          const signedIn: AntigravitySubscriptionListEntry = {
            id, kind: 'antigravity-subscription', label: body.label, hasToken: true,
            expiresAt: OAUTH_EXPIRES_AT, enabled: subscriptions.length === 0, createdAt: Date.now(),
          };
          subscriptions.push(signedIn);
          return json(signedIn, 201);
        }
        calls.created.push({ token: body.token ?? null, runnerId: body.runnerId });
        const created: AntigravitySubscriptionListEntry = {
          id: 'ag-sub-1',
          kind: 'antigravity-subscription',
          label: body.label,
          hasToken: typeof body.token === 'string' && body.token !== '',
          runnerId: body.runnerId,
          ...(opts.withSources
            ? {
                runnerLogin: 'ok' as const,
                runnerModels: [
                  { id: 'gemini-4-carbon', name: 'Gemini 4 Carbon' },
                  { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6' },
                ],
              }
            : {}),
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
    status: { installed: true, loggedIn: true, canLogin: true, runnerId: 'm-ready' },
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
  const quota = detail.getByTestId('subscription-quota');
  await expect(quota).toContainText('Cairn 记录');
  await expect(quota.getByRole('progressbar')).toHaveCount(0);
});

test('logged-out Mac runs browser login and continues automatically', async ({ page }) => {
  const { dialog, calls } = await openDialog(page, {
    status: { installed: true, loggedIn: false, canLogin: true },
  });
  await dialog.getByTestId('antigravity-local-login').click();
  await expect(dialog).toContainText('已在浏览器中打开 Antigravity 登录页');
  await page.evaluate(() => {
    const w = window as Window & { __antigravity?: AntigravityCalls };
    w.__antigravity?.resolve?.({ ok: true, runnerId: 'm-ready' });
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
  await expect(dialog.getByTestId('sign-in-view').getByRole('status')).toContainText('已在浏览器中打开 Antigravity 登录页');
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
  expect(calls.created).toEqual([{ token: API_KEY }]);
  await expect(page.locator('body')).not.toContainText(API_KEY);
});

test('when the antigravity desktop bridge is absent it offers Update Cairn and still allows saving', async ({
  page,
}) => {
  await page.addInitScript(() => {
    (window as Window & { cairnDesktop?: unknown }).cairnDesktop = {
      update: {
        state: async () => ({ status: 'idle' }),
        check: async () => {},
        install: async () => {},
        rollbackNotice: async () => null,
        subscribe: () => () => {},
      },
    };
  });
  const { dialog, calls } = await openDialog(page, { status: null });
  await expect(dialog.getByTestId('desktop-skew-update')).toHaveText('更新 Cairn');
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(calls.created).toEqual([{ token: null }]);
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
    w.__antigravity?.resolve?.({ ok: true, runnerId: 'm-ready' });
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
  });
  let verifyCalls = 0;
  await mockLive(page, { threads: [], messages: [] }, (path, route, json) => {
    if (path === '/api/teams/t1/antigravity-subscriptions/ag-sub-1/attach-oauth') {
      expect(route.request().method()).toBe('POST');
      expect(route.request().postDataJSON()).toMatchObject({ kind: 'oauth-personal' });
      attached = true;
      return json({
        id: 'ag-sub-1', kind: 'antigravity-subscription', label: 'Antigravity 订阅',
        hasToken: true, expiresAt: OAUTH_EXPIRES_AT, enabled: true, createdAt: 1,
      });
    }
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
  await expect(relogin.getByTestId('sign-in-view').getByRole('status')).toContainText(
    '已在浏览器中打开 Antigravity 登录页',
  );
  await expect(relogin.getByTestId('antigravity-relogin-cancel')).toBeVisible();
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
              runnerId: 'm-ready',
              runnerLogin: 'missing_local_login',
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

test('manual Verify reports real wall time, runs one live check, and keeps remote bound Runner clear', async ({
  page,
}) => {
  await installBridge(page, {
    status: { installed: true, loggedIn: false, canLogin: true, runnerId: 'm-mac' },
  });
  let verifyCalls = 0;
  const { promise: releaseVerify, resolve: settleVerify } = Promise.withResolvers<void>();
  await mockLive(page, { threads: [], messages: [] }, (path, _route, json) => {
    if (path === '/api/teams/t1/providers') return json({ presets: [], providers: [] });
    if (path === '/api/teams/t1/model-sources') return json({ sources: [] });
    if (path === '/api/teams/t1/antigravity-subscriptions') {
      return json([
        {
          id: 'ag-sub-1',
          kind: 'antigravity-subscription',
          label: 'Antigravity 订阅',
          hasToken: false,
          runnerId: 'm-mini',
          runnerName: 'Studio-Mac-mini',
          runnerLogin: 'missing_local_login',
          runnerModels: [],
          runnerLogins: [
            { runnerId: 'm-mini', name: 'Studio-Mac-mini', online: true, status: 'missing_local_login' },
            { runnerId: 'm-mac', name: 'studioMac', online: true, status: 'missing_local_login' },
          ],
          expiresAt: null,
          enabled: true,
          createdAt: 1,
        },
      ]);
    }
    if (path === '/api/teams/t1/antigravity-subscriptions/ag-sub-1/verify') {
      verifyCalls += 1;
      return releaseVerify.then(() =>
        json({
          ok: false,
          reason: 'missing_local_login',
          runnerName: 'Studio-Mac-mini',
          check: {
            at: Date.now(),
            ok: false,
            reason: 'missing_local_login',
            check: 'sign-in',
            command: 'agy acp · Studio-Mac-mini',
            model: null,
            durationMs: 1,
          },
        }),
      );
    }
    if (path === '/api/teams/t1/antigravity-subscriptions/ag-sub-1/steps') {
      return json({ steps: [], hasEarlier: false });
    }
    return undefined;
  });

  await page.goto('/app/settings/routing');
  await page.locator('[data-instance-id="subscription:ag-sub-1"]').click();
  const detail = page.getByTestId('subscription-detail');
  await expect(detail.getByTestId('subscription-status')).toHaveText('Studio-Mac-mini 未登录');
  await expect(detail.getByTestId('subscription-reason')).toContainText('这个订阅绑定在 Studio-Mac-mini');
  await expect(detail.getByTestId('antigravity-relogin')).toHaveCount(0);

  await detail.getByTestId('subscription-verify').click();
  const feedback = page.getByTestId('subscription-verify-feedback');
  await expect(feedback).toHaveAttribute('data-phase', 'checking');
  await expect(feedback).toContainText('正在让 Studio-Mac-mini 上的 Antigravity 检查这个凭据…');

  await page.waitForTimeout(350);
  settleVerify();
  await expect(feedback).toHaveAttribute('data-phase', 'failed');
  await expect(feedback).toContainText('Studio-Mac-mini 尚未登录 Antigravity');
  const verifyDetail = page.getByTestId('subscription-verify-detail');
  await expect(verifyDetail).toContainText('未通过 · 执行机未登录');
  await expect(verifyDetail).toContainText('agy acp · Studio-Mac-mini');
  await expect(verifyDetail).not.toContainText('0.0 秒');
  expect(verifyCalls).toBe(1);
});

test('using this Mac sign-in binds this Mac, refreshes status before showing Passed (C1), and names both runners', async ({
  page,
}) => {
  await installBridge(page, {
    status: { installed: true, loggedIn: true, canLogin: true, runnerId: 'm-mac' },
  });
  let boundRunnerId: string | null = null;
  let macSignedIn = false;
  let holdNextRefresh = false;
  const { promise: releaseRefresh, resolve: settleRefresh } = Promise.withResolvers<void>();
  const patches: object[] = [];

  await mockLive(page, { threads: [], messages: [] }, (path, route, json) => {
    if (path === '/api/teams/t1/providers') return json({ presets: [], providers: [] });
    if (path === '/api/teams/t1/model-sources') return json({ sources: [] });
    if (path === '/api/teams/t1/antigravity-subscriptions') {
      const respond = () =>
        json([
          {
            id: 'ag-sub-1',
            kind: 'antigravity-subscription',
            label: 'Antigravity 订阅',
            hasToken: false,
            runnerId: boundRunnerId,
            runnerName: boundRunnerId === 'm-mac' ? 'studioMac' : null,
            runnerLogin: boundRunnerId === 'm-mac' && macSignedIn ? 'ok' : 'unavailable',
            runnerModels:
              boundRunnerId === 'm-mac' && macSignedIn
                ? [{ id: 'gemini-4-carbon', name: 'Gemini 4 Carbon' }]
                : [],
            runnerLogins: [
              { runnerId: 'm-mini', name: 'Studio-Mac-mini', online: true, status: 'missing_local_login' },
              {
                runnerId: 'm-mac',
                name: 'studioMac',
                online: true,
                status: macSignedIn ? 'ok' : 'missing_local_login',
              },
            ],
            expiresAt: null,
            enabled: true,
            createdAt: 1,
          },
        ]);
      if (holdNextRefresh) {
        holdNextRefresh = false;
        return releaseRefresh.then(respond);
      }
      return respond();
    }
    if (
      path === '/api/teams/t1/antigravity-subscriptions/ag-sub-1' &&
      route.request().method() === 'PATCH'
    ) {
      const body = route.request().postDataJSON() as { runnerId?: string };
      patches.push(body);
      if (body.runnerId !== undefined) boundRunnerId = body.runnerId;
      return json({
        id: 'ag-sub-1',
        kind: 'antigravity-subscription',
        label: 'Antigravity 订阅',
        hasToken: false,
        runnerId: boundRunnerId,
        expiresAt: null,
        enabled: true,
        createdAt: 1,
      });
    }
    if (path === '/api/teams/t1/antigravity-subscriptions/ag-sub-1/verify') {
      macSignedIn = true;
      holdNextRefresh = true;
      return json({
        ok: true,
        runnerName: 'studioMac',
        check: {
          at: Date.now(),
          ok: true,
          reason: null,
          check: 'sign-in',
          command: 'agy acp · studioMac',
          model: null,
          durationMs: 1400,
        },
      });
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
  await expect(relogin).toContainText('绑定这台 Mac 并立即验证。');

  await detail.getByTestId('antigravity-detail-login').click();

  const feedback = page.getByTestId('subscription-verify-feedback');
  await expect(feedback).toHaveAttribute('data-phase', 'checking');
  await expect(feedback).toContainText('正在让 studioMac 上的 Antigravity 检查这个凭据…');

  settleRefresh();
  await expect(feedback).toHaveAttribute('data-phase', 'passed');
  await expect(feedback).toContainText('studioMac 上的 Antigravity 接受了这个凭据。');
  const verifyDetail = page.getByTestId('subscription-verify-detail');
  await expect(verifyDetail).toContainText('通过');
  await expect(verifyDetail).toContainText('1.4 秒');
  await expect(verifyDetail).toContainText('agy acp · studioMac');

  expect(patches).toEqual([{ runnerId: 'm-mac' }]);
  await expect(detail).toHaveAttribute('data-tone', 'ok');
  await expect(detail.getByTestId('subscription-status')).toHaveText(
    '已在 studioMac 登录，Studio-Mac-mini 未登录',
  );
  await expect(page.locator('[data-instance-id="subscription:ag-sub-1"]')).toHaveAttribute(
    'data-tone',
    'ok',
  );
  await expect(relogin).toHaveCount(0);
});

test('dismisses stale verify popover when login finishes elsewhere via SSE, refreshes model-routing, and refreshes local Mac button on focus', async ({
  page,
}) => {
  await installBridge(page, {
    status: { installed: true, loggedIn: false, canLogin: true, runnerId: 'm-mac' },
  });
  let macSignedIn = false;
  let routingFetches = 0;

  await mockLive(page, { threads: [], messages: [] }, (path, _route, json) => {
    if (path === '/api/teams/t1/providers') return json({ presets: [], providers: [] });
    if (path === '/api/teams/t1/model-sources') return json({ sources: [] });
    if (path === '/api/teams/t1/model-routing') {
      routingFetches += 1;
      return json({ edges: [], connections: [], quota: [] });
    }
    if (path === '/api/teams/t1/antigravity-subscriptions') {
      return json([
        {
          id: 'ag-sub-1',
          kind: 'antigravity-subscription',
          label: 'Antigravity 订阅',
          hasToken: false,
          runnerId: 'm-mac',
          runnerName: 'studioMac',
          runnerLogin: macSignedIn ? 'ok' : 'missing_local_login',
          runnerModels: macSignedIn
            ? [
                { id: 'gemini-4-carbon', name: 'Gemini 4 Carbon' },
                { id: 'gemini-4-argon', name: 'Gemini 4 Argon' },
              ]
            : [],
          runnerLogins: [
            {
              runnerId: 'm-mac',
              name: 'studioMac',
              online: true,
              status: macSignedIn ? 'ok' : 'missing_local_login',
            },
          ],
          expiresAt: null,
          enabled: true,
          createdAt: 1,
        },
      ]);
    }
    if (path === '/api/teams/t1/antigravity-subscriptions/ag-sub-1/verify') {
      return json({
        ok: false,
        reason: 'missing_local_login',
        runnerName: 'studioMac',
        check: {
          at: Date.now(),
          ok: false,
          reason: 'missing_local_login',
          check: 'sign-in',
          command: 'agy acp · studioMac',
          model: null,
          durationMs: 320,
        },
      });
    }
    if (path === '/api/teams/t1/antigravity-subscriptions/ag-sub-1/steps') {
      return json({ steps: [], hasEarlier: false });
    }
    return undefined;
  });

  await page.goto('/app/settings/routing');
  await page.locator('[data-instance-id="subscription:ag-sub-1"]').click();
  const detail = page.getByTestId('subscription-detail');
  const routingBefore = routingFetches;
  await detail.getByTestId('subscription-verify').click();
  const feedback = page.getByTestId('subscription-verify-feedback');
  await expect(feedback).toHaveAttribute('data-phase', 'failed');
  await expect.poll(() => routingFetches).toBeGreaterThan(routingBefore);

  macSignedIn = true;
  await page.waitForFunction(() =>
    window.__es.some((es) => es.url.includes('/api/teams/t1/stream')),
  );
  await page.evaluate(() => {
    for (const es of window.__es) {
      if (es.url.includes('/api/teams/t1/stream')) {
        es.emit({ type: 'machine_presence', machineId: 'm-mac', online: true });
      }
    }
  });
  await expect(detail).toHaveAttribute('data-tone', 'ok');
  await expect(detail.getByTestId('subscription-status')).toHaveText('已在 studioMac 登录');
  await expect(detail.getByTestId('subscription-models-summary')).toHaveText('2 个');
  await expect(feedback).toHaveCount(0);
});

test('local Mac sign-in while a manual Verify is running supersedes the stale check and attaches OAuth', async ({
  page,
}) => {
  let attached = false;
  await installBridge(page, {
    status: { installed: true, loggedIn: false, canLogin: true, runnerId: 'm-mac' },
  });
  let verifyAttempt = 0;
  const { promise: holdFirst, resolve: releaseFirst } = Promise.withResolvers<void>();

  await mockLive(page, { threads: [], messages: [] }, (path, _route, json) => {
    if (path === '/api/teams/t1/antigravity-subscriptions/ag-sub-1/attach-oauth') {
      attached = true;
      return json({
        id: 'ag-sub-1', kind: 'antigravity-subscription', label: 'Antigravity 订阅',
        hasToken: true, oauthPersonal: true, expiresAt: OAUTH_EXPIRES_AT, enabled: true, createdAt: 1,
      });
    }
    if (path === '/api/teams/t1/providers') return json({ presets: [], providers: [] });
    if (path === '/api/teams/t1/model-sources') return json({ sources: [] });
    if (path === '/api/teams/t1/antigravity-subscriptions') {
      return json([
        {
          id: 'ag-sub-1',
          kind: 'antigravity-subscription',
          label: 'Antigravity 订阅',
          hasToken: attached,
          ...(attached
            ? { oauthPersonal: true }
            : {
                runnerId: null,
                runnerName: null,
                runnerLogin: 'unavailable',
                runnerModels: [],
                runnerLogins: [
                  {
                    runnerId: 'm-mini',
                    name: 'Studio-Mac-mini',
                    online: true,
                    status: 'missing_local_login',
                  },
                  {
                    runnerId: 'm-mac',
                    name: 'studioMac',
                    online: true,
                    status: 'missing_local_login',
                  },
                ],
              }),
          expiresAt: attached ? OAUTH_EXPIRES_AT : null,
          enabled: true,
          createdAt: 1,
        },
      ]);
    }
    if (path === '/api/teams/t1/antigravity-subscriptions/ag-sub-1/verify') {
      const n = ++verifyAttempt;
      if (n === 1) {
        return holdFirst.then(() =>
          json({
            ok: false,
            reason: 'unavailable',
            check: {
              at: Date.now(),
              ok: false,
              reason: 'unavailable',
              check: 'sign-in',
              command: 'agy acp · Runner sign-in',
              model: null,
              durationMs: 20,
            },
          }),
        );
      }
      return json({
        ok: true,
        check: {
          at: Date.now(),
          ok: true,
          reason: null,
          check: 'sign-in',
          command: 'Antigravity account API',
          model: null,
          durationMs: 900,
        },
      });
    }
    if (path === '/api/teams/t1/antigravity-subscriptions/ag-sub-1/steps') {
      return json({ steps: [], hasEarlier: false });
    }
    return undefined;
  });

  await page.goto('/app/settings/routing');
  await page.locator('[data-instance-id="subscription:ag-sub-1"]').click();
  const detail = page.getByTestId('subscription-detail');

  await detail.getByTestId('subscription-verify').click();
  await expect(page.getByTestId('subscription-verify-feedback')).toHaveAttribute(
    'data-phase',
    'checking',
  );

  await detail.getByTestId('antigravity-detail-login').click();
  await page.evaluate(() => {
    const w = window as Window & { __antigravity?: AntigravityCalls };
    w.__antigravity?.resolve?.({ ok: true });
  });

  await expect(page.getByTestId('subscription-verify-feedback')).toHaveAttribute(
    'data-phase',
    'passed',
  );
  expect(attached).toBe(true);

  releaseFirst();
  await page.waitForTimeout(150);
  await expect(page.getByTestId('subscription-verify-feedback')).toHaveAttribute(
    'data-phase',
    'passed',
  );
  await expect(detail).toHaveAttribute('data-tone', 'ok');
  await expect(detail.getByTestId('subscription-status')).toHaveCount(0);
  await expect(detail).not.toContainText('未登录');
});

test('window focus updates local Mac sign-in button and creation shows checking popover immediately', async ({
  page,
}) => {
  const status = { installed: true, loggedIn: false, canLogin: true, runnerId: 'm-mac' };
  const subscriptions: AntigravitySubscriptionListEntry[] = [
    {
      id: 'ag-sub-1',
      kind: 'antigravity-subscription',
      label: 'Antigravity 订阅',
      hasToken: false,
      runnerId: null,
      runnerName: null,
      runnerLogin: 'unavailable',
      runnerModels: [],
      runnerLogins: [
        { runnerId: 'm-mini', name: 'Studio-Mac-mini', online: true, status: 'missing_local_login' },
        { runnerId: 'm-mac', name: 'studioMac', online: true, status: 'missing_local_login' },
      ],
      expiresAt: null,
      enabled: true,
      createdAt: 1,
    },
  ];
  await page.exposeFunction('importAntigravityFocusTest', ({ label }: DesktopSubscriptionInput) => {
    const created: AntigravitySubscriptionListEntry = {
      id: 'ag-sub-2',
      kind: 'antigravity-subscription',
      label,
      hasToken: true,
      oauthPersonal: true,
      expiresAt: OAUTH_EXPIRES_AT,
      enabled: false,
      createdAt: 2,
    };
    subscriptions.push(created);
    return { ok: true, subscription: { id: created.id, label } };
  });
  await page.addInitScript((initial) => {
    const w = window as Window & {
      cairnDesktop?: unknown;
      __localStatus?: typeof initial;
      importAntigravityFocusTest: (input: DesktopSubscriptionInput) => Promise<AntigravityLoginOutcome>;
    };
    w.__localStatus = { ...initial };
    w.cairnDesktop = {
      antigravity: {
        status: async () => ({ ...w.__localStatus! }),
        import: (input: DesktopSubscriptionInput) => w.importAntigravityFocusTest(input),
        signIn: async () => ({ ok: false, reason: 'cancelled' }),
        cancelLogin: async () => {},
        onLoginProgress: () => () => {},
      },
    };
  }, status);
  const { promise: holdVerify, resolve: releaseVerify } = Promise.withResolvers<void>();

  await mockLive(page, { threads: [], messages: [] }, (path, _route, json) => {
    if (path === '/api/teams/t1/providers') return json({ presets: [], providers: [] });
    if (path === '/api/teams/t1/model-sources') return json({ sources: [] });
    if (path === '/api/teams/t1/antigravity-subscriptions') {
      return json(subscriptions);
    }
    if (path === '/api/teams/t1/antigravity-subscriptions/ag-sub-2/verify') {
      return holdVerify.then(() =>
        json({
          ok: true,
          check: {
            at: Date.now(),
            ok: true,
            reason: null,
            check: 'sign-in',
            command: 'Antigravity account API',
            model: null,
            durationMs: 600,
          },
        }),
      );
    }
    if (path.endsWith('/steps')) return json({ steps: [], hasEarlier: false });
    return undefined;
  });

  await page.goto('/app/settings/routing');
  await page.locator('[data-instance-id="subscription:ag-sub-1"]').click();
  await expect(page.getByTestId('antigravity-detail-login')).toHaveText(
    '在这台 Mac 上登录 Antigravity',
  );

  await page.evaluate(() => {
    const w = window as Window & { __localStatus?: { loggedIn: boolean } };
    if (w.__localStatus) w.__localStatus.loggedIn = true;
    window.dispatchEvent(new Event('focus'));
  });
  await expect(page.getByTestId('antigravity-detail-login')).toHaveText('使用这台 Mac 的登录');

  await page.getByTestId('routing-add-provider').click();
  await page.locator('[data-preset-id="antigravity-subscription"]').click();
  const dialog = page.getByRole('dialog', { name: '添加 Antigravity 订阅' });
  await dialog.getByTestId('antigravity-local-import').click();
  await expect(dialog).not.toBeVisible();

  await expect(page.getByTestId('subscription-verify-feedback')).toHaveAttribute(
    'data-phase',
    'checking',
  );
  releaseVerify();
  await expect(page.getByTestId('subscription-verify-feedback')).toHaveAttribute(
    'data-phase',
    'passed',
  );
});

test('bound online Runner without agy reports unavailable accurately in both status and verify popover', async ({
  page,
}) => {
  await mockLive(page, { threads: [], messages: [] }, (path, _route, json) => {
    if (path === '/api/teams/t1/providers') return json({ presets: [], providers: [] });
    if (path === '/api/teams/t1/model-sources') return json({ sources: [] });
    if (path === '/api/teams/t1/antigravity-subscriptions') {
      return json([
        {
          id: 'ag-sub-unavail',
          kind: 'antigravity-subscription',
          label: 'Mini Antigravity',
          hasToken: false,
          runnerId: 'm-mini',
          runnerName: 'Studio-Mac-mini',
          runnerLogin: 'unavailable',
          runnerModels: [],
          runnerLogins: [
            { runnerId: 'm-mini', name: 'Studio-Mac-mini', online: true, status: 'unavailable' },
            { runnerId: 'm-mac', name: 'studioMac', online: true, status: 'ok' },
          ],
          expiresAt: null,
          enabled: true,
          createdAt: 1,
        },
      ]);
    }
    if (path === '/api/teams/t1/antigravity-subscriptions/ag-sub-unavail/verify') {
      return json({
        ok: false,
        reason: 'unavailable',
        runnerName: 'Studio-Mac-mini',
        check: {
          at: Date.now(),
          ok: false,
          reason: 'unavailable',
          check: 'sign-in',
          command: 'agy acp · Studio-Mac-mini',
          model: null,
          durationMs: 120,
        },
      });
    }
    if (path.endsWith('/steps')) return json({ steps: [], hasEarlier: false });
    return undefined;
  });

  await page.goto('/app/settings/routing');
  await page.locator('[data-instance-id="subscription:ag-sub-unavail"]').click();
  const detail = page.getByTestId('subscription-detail');
  await expect(detail.getByTestId('subscription-status')).toHaveText(
    'Studio-Mac-mini 无法验证 · 已在 studioMac 登录',
  );
  await expect(detail.getByTestId('subscription-reason')).toContainText('Studio-Mac-mini');
  await expect(detail.getByTestId('subscription-reason')).not.toContainText('登录已失效');

  await detail.getByTestId('subscription-verify').click();
  const feedback = page.getByTestId('subscription-verify-feedback');
  await expect(feedback).toHaveAttribute('data-phase', 'failed');
  await expect(feedback).toContainText('无法在 Studio-Mac-mini 上运行 Antigravity 检查');
  await expect(feedback).not.toContainText('登录已失效');
});
