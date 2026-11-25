import type {
  AntigravityLoginOutcome,
  AntigravitySubscriptionListEntry,
  ClaudeSubscriptionListEntry,
  DesktopSubscriptionInput,
  DevinLoginOutcome,
  DevinSubscriptionListEntry,
  ProviderRecord,
} from '@cairn/shared';
import { expect, type Page, test } from '@playwright/test';
import { mockLive, PROJECT, TASK, THREAD } from './chief-home-mock';

const RENEWED_EXPIRY = null;
const PAST_EXPIRY = Date.now() - 3_600_000;

interface AntigravityCalls {
  loginCalls: Array<{ input: DesktopSubscriptionInput; subscriptionId: string | undefined }>;
  resolve: ((outcome: unknown) => void) | null;
}

async function installAntigravityBridge(
  page: Page,
  onSave: (input: DesktopSubscriptionInput, subscriptionId?: string) => AntigravityLoginOutcome,
) {
  await page.exposeFunction('completeAntigravityRelogin', onSave);
  await page.addInitScript(() => {
    const w = window as Window & {
      cairnDesktop?: unknown;
      __agRelogin?: AntigravityCalls;
      completeAntigravityRelogin: (
        input: DesktopSubscriptionInput,
        subscriptionId?: string,
      ) => Promise<AntigravityLoginOutcome>;
    };
    w.__agRelogin = { loginCalls: [], resolve: null };
    w.cairnDesktop = {
      antigravity: {
        status: async () => ({ installed: true, loggedIn: false, canLogin: true }),
        import: async () => ({ ok: false, reason: 'no-key' }),
        login: (input: DesktopSubscriptionInput, subscriptionId?: string) => {
          w.__agRelogin!.loginCalls.push({ input, subscriptionId });
          return new Promise((resolve) => {
            w.__agRelogin!.resolve = (outcome) => {
              if ((outcome as { ok?: boolean }).ok === true) {
                void w.completeAntigravityRelogin(input, subscriptionId).then(resolve);
              } else {
                resolve(outcome);
              }
            };
          });
        },
        cancelLogin: async () => {
          w.__agRelogin!.resolve?.({ ok: false, reason: 'cancelled' });
        },
        onLoginProgress: () => () => {},
      },
    };
  });
}

test('expired Antigravity card shows primary Sign in again, starts Google sign-in, and returns healthy without reload', async ({
  page,
}) => {
  let renewed = false;
  await installAntigravityBridge(page, ({ label }, subscriptionId) => {
    expect(subscriptionId).toBe('ag-exp-1');
    renewed = true;
    return { ok: true, subscription: { id: subscriptionId ?? 'ag-exp-1', label } };
  });

  await mockLive(page, { threads: [], messages: [] }, (path, _route, json) => {
    if (path === '/api/teams/t1/providers') return json({ presets: [], providers: [] });
    if (path === '/api/teams/t1/model-sources') return json({ sources: [] });
    if (path === '/api/teams/t1/antigravity-subscriptions') {
      return json([
        {
          id: 'ag-exp-1',
          kind: 'antigravity-subscription',
          label: 'Antigravity 订阅',
          hasToken: true,
          oauthPersonal: true,
          expiresAt: renewed ? RENEWED_EXPIRY : PAST_EXPIRY,
          enabled: true,
          models: [{ id: 'gemini-4-carbon', name: 'Gemini 4 Carbon' }],
          createdAt: 1,
        } satisfies AntigravitySubscriptionListEntry,
      ]);
    }
    if (path === '/api/teams/t1/antigravity-subscriptions/ag-exp-1/verify') {
      return json({ ok: renewed });
    }
    if (path === '/api/teams/t1/antigravity-subscriptions/ag-exp-1/steps') {
      return json({ steps: [], hasEarlier: false });
    }
    return undefined;
  });

  await page.goto('/app/settings/routing?item=subscription:ag-exp-1');
  const detail = page.getByTestId('subscription-detail');
  await expect(detail.getByTestId('subscription-status')).toHaveText('已过期');
  const signInBtn = detail.getByTestId('subscription-sign-in-again');
  await expect(signInBtn).toBeVisible();
  await expect(signInBtn).toHaveText('重新登录');
  await expect(signInBtn).toHaveAttribute('data-variant', 'default');

  await signInBtn.click();
  const dialog = page.getByRole('dialog', { name: '重新登录 Antigravity' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('已在浏览器中打开 Antigravity 登录页');

  const calls = await page.evaluate(() => {
    const w = window as Window & { __agRelogin?: AntigravityCalls };
    return w.__agRelogin?.loginCalls ?? [];
  });
  expect(calls).toHaveLength(1);
  expect(calls[0]?.subscriptionId).toBe('ag-exp-1');

  await page.evaluate(() => {
    const w = window as Window & { __agRelogin?: AntigravityCalls };
    w.__agRelogin?.resolve?.({ ok: true });
  });

  await expect(dialog).not.toBeVisible();
  await expect(detail).toHaveAttribute('data-tone', 'ok');
  await expect(detail.getByTestId('subscription-status')).toHaveCount(0);
  await expect(detail.getByTestId('subscription-sign-in-again')).toHaveCount(0);
});

test('Coordinator Antigravity banner opens the same re-sign-in directly and clears on success without reload', async ({
  page,
}) => {
  let renewed = false;
  await installAntigravityBridge(page, ({ label }, subscriptionId) => {
    expect(subscriptionId).toBe('ag-exp-1');
    renewed = true;
    return { ok: true, subscription: { id: subscriptionId ?? 'ag-exp-1', label } };
  });

  await mockLive(
    page,
    { threads: [THREAD], messages: [], todos: [TASK], projects: [PROJECT] },
    (path, _route, json) => {
      if (path === '/api/teams/t1/antigravity-subscriptions') {
        return json([
          {
            id: 'ag-exp-1',
            kind: 'antigravity-subscription',
            label: 'Antigravity 订阅',
            hasToken: true,
            oauthPersonal: true,
            expiresAt: renewed ? RENEWED_EXPIRY : PAST_EXPIRY,
            enabled: true,
            createdAt: 1,
          } satisfies AntigravitySubscriptionListEntry,
        ]);
      }
      return undefined;
    },
  );

  await page.goto('/app');
  const banner = page.getByTestId('antigravity-login-banner');
  await expect(banner).toBeVisible();
  const reloginBtn = banner.getByTestId('antigravity-login-relogin');
  await expect(reloginBtn).toBeVisible();
  await expect(reloginBtn).toHaveText('重新登录');
  await expect(banner).not.toContainText('设置 → 模型路由');

  await reloginBtn.click();
  const dialog = page.getByRole('dialog', { name: '重新登录 Antigravity' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('已在浏览器中打开 Antigravity 登录页');

  await page.evaluate(() => {
    const w = window as Window & { __agRelogin?: AntigravityCalls };
    w.__agRelogin?.resolve?.({ ok: true });
  });

  await expect(dialog).not.toBeVisible();
  await expect(banner).toHaveCount(0);
});

test('other expired or unauthenticated subscription cards (Claude, Devin, Codex) offer one-click Sign in again', async ({
  page,
}) => {
  let codexDeviceStarted = 0;
  const claude: ClaudeSubscriptionListEntry = {
    id: 'claude-exp',
    kind: 'claude-subscription',
    label: 'Personal Claude',
    expiresAt: PAST_EXPIRY,
    createdAt: 1,
    models: [{ id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5' }],
  };
  const devin: DevinSubscriptionListEntry = {
    id: 'devin-exp',
    kind: 'devin-subscription',
    label: 'Work Devin',
    expiresAt: PAST_EXPIRY,
    createdAt: 2,
    models: [{ id: 'swe-2', name: 'SWE-2' }],
  };
  const codex: ProviderRecord = {
    id: 'prov-codex',
    label: 'ChatGPT',
    kind: 'custom',
    providerId: 'openai-codex',
    baseUrl: 'https://chatgpt.com/backend-api/codex',
    api: 'openai-responses',
    authHeader: false,
    compat: {},
    models: [{ id: 'gpt-5-codex', name: 'GPT-5 Codex' }],
    createdBy: 'owner',
    createdAt: 3,
    updatedAt: 3,
  };

  await page.exposeFunction(
    'completeDevinRelogin',
    ({ label }: DesktopSubscriptionInput): DevinLoginOutcome => ({
      ok: true,
      subscription: { id: 'devin-new', label },
    }),
  );
  await page.addInitScript(() => {
    const w = window as Window & { cairnDesktop?: unknown };
    w.cairnDesktop = {
      devin: {
        status: async () => ({ loggedIn: false, canLogin: true }),
        import: async () => ({ ok: false, reason: 'no-key' }),
        login: () => new Promise(() => {}),
        cancelLogin: async () => {},
      },
    };
  });

  await mockLive(page, { threads: [], messages: [] }, (path, _route, json) => {
    if (path === '/api/teams/t1/claude-subscriptions') return json([claude]);
    if (path === '/api/teams/t1/devin-subscriptions') return json([devin]);
    if (path === '/api/teams/t1/antigravity-subscriptions') return json([]);
    if (path === '/api/teams/t1/providers') return json({ presets: [], providers: [codex] });
    if (path === '/api/teams/t1/model-sources') return json({ sources: [] });
    if (path === '/api/teams/t1/model-routing') {
      return json({
        edges: [],
        connections: [
          {
            id: 'prov-codex',
            vendor: 'openai',
            kind: 'subscription',
            models: ['gpt-5-codex'],
            available: false,
          },
        ],
        quota: [],
      });
    }
    if (path === '/api/teams/t1/providers/oauth/openai-codex/device') {
      codexDeviceStarted += 1;
      return json({
        state: 'codex-state-1',
        userCode: 'ABCD-1234',
        verificationUri: 'https://auth.example.test/device',
        intervalSeconds: 60,
      });
    }
    return undefined;
  });

  await page.goto('/app/settings/routing?item=subscription:claude-exp');
  await page.getByTestId('subscription-sign-in-again').click();
  const claudeDialog = page.getByRole('dialog', { name: '重新登录 Claude' });
  await expect(claudeDialog).toBeVisible();
  await expect(claudeDialog.getByTestId('subscription-label')).toHaveValue('Personal Claude');
  await claudeDialog.getByRole('button', { name: '取消', exact: true }).click();
  await expect(claudeDialog).not.toBeVisible();

  await page.locator('[data-instance-id="subscription:devin-exp"]').click();
  await page.getByTestId('subscription-sign-in-again').click();
  const devinDialog = page.getByRole('dialog', { name: '重新登录 Devin' });
  await expect(devinDialog).toBeVisible();
  await expect(devinDialog).toContainText('已在浏览器中打开 Devin 登录页');
  await devinDialog.getByRole('button', { name: '取消', exact: true }).last().click();
  await expect(devinDialog).not.toBeVisible();

  await page.locator('[data-instance-id="provider:prov-codex"]').click();
  await page.getByTestId('provider-sign-in-again').click();
  await expect(page.getByTestId('codex-device-login')).toContainText('ABCD-1234');
  expect(codexDeviceStarted).toBe(1);
});
